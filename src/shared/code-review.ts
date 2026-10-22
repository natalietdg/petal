// Code review: the functions each Claude turn changed, and a reviewer's answer to "why is it written like this".
// Pure shapes and checks shared by main and the renderer; main/code-review-*.ts reads logs and runs the reviewer.

export type CardKind = 'function' | 'module' | 'hunk';

// One function (or the module's top level, or a raw hunk) as one turn left it.
export interface FunctionCard {
  key: string; // unique in its turn: file + name
  file: string; // as Claude's tool wrote it
  display: string; // relative to the session's folder when inside it
  name: string;
  kind: CardKind;
  before: string; // '' when the turn added it
  after: string; // '' when the turn removed it
  note: string | null; // an honest label, e.g. why a change stayed a hunk
  reasoning: number; // how many of the turn's reasoning excerpts were written before this change
}

export interface ReasoningExcerpt {
  id: number; // R<id> in the reviewer's prompt
  kind: 'text' | 'thinking';
  text: string;
}

export type AnswerBasis = 'recorded' | 'inferred';

export interface WhyAnswer {
  shape: string; // the shape chosen
  driver: string; // the constraint or requirement behind it
  alternatives: string; // what else was possible, and why not
  risk: string;
  basis: AnswerBasis;
  quote: string | null; // verbatim from a reasoning excerpt when recorded
}

// Where a session comes from: a tab here (the reader), a log on disk (History, the Board), or one of a session's subagents.
export type ReviewSource = { tabId: string } | { sessionId: string } | { sessionId: string; agentId: string };

export const isAgentSource = (source: ReviewSource): source is { sessionId: string; agentId: string } => 'agentId' in source;

// A subagent a turn launched, with the code it changed; its turns are read from { sessionId, agentId }.
export interface SubagentChanges {
  agentId: string;
  description: string;
  turnIds: string[];
  functions: number;
}

export interface TurnSummary {
  turnId: string;
  replyId: string | null; // the reader's reply id for this turn
  historyIndex: number; // History's turn index for this turn
  at: string | null;
  functions: number;
  agents: SubagentChanges[]; // subagents launched in this turn that changed code
}

export interface SessionSummary {
  sessionId: string;
  turns: TurnSummary[];
}

export interface TurnReview {
  sessionId: string;
  turnId: string;
  cards: FunctionCard[];
  reasoning: ReasoningExcerpt[];
  answers: Record<string, WhyAnswer>; // by card key; cached for this exact content
  explained: boolean; // a run finished for this content, so a missing answer is really missing
  skipped: string[]; // files left out as likely secrets
  estimate: number; // tokens, read and write
  running: boolean;
}

export interface TaskChange {
  sessionId: string;
  turnId: string;
  at: string | null;
  card: FunctionCard;
  answer: WhyAnswer | null;
  explained: boolean;
}

export interface TaskFunction { name: string; changes: TaskChange[] }
export interface TaskFile { file: string; display: string; functions: TaskFunction[] }

export interface TaskReview {
  title: string;
  sessions: number;
  files: TaskFile[];
  targets: ExplainTarget[]; // turns with a function still unexplained
  skipped: string[];
  estimate: number;
  running: boolean;
}

export interface ExplainTarget {
  source: ReviewSource;
  turnId: string;
  only?: string[]; // card keys to (re)ask; all when absent
}

export type ExplainResult = { explained: number; missing: number } | { canceled: true } | { error: string };

export const cacheKey = (sessionId: string, turnId: string, hash: string): string => `${sessionId}:${turnId}:${hash}`;

// ---- What never goes to the reviewer.
const SECRET_NAMES = [
  /^\.env(\..*)?$/i, /^\.envrc$/i, /\.(pem|key|p12|pfx|keystore|jks)$/i, /^id_(rsa|ed25519|ecdsa|dsa)/i,
  /^\.(npmrc|netrc|pypirc|git-credentials)$/i, /service[-_]?account.*\.json$/i,
  /(credential|secret|password|token)s?([-_.][\w-]*)?(\.(json|ya?ml|txt|ini|conf|cfg|toml|xml|properties|plist))?$/i, // data files, not code
];

export const isSecretPath = (file: string): boolean => {
  const name = file.split(/[\\/]/).pop() ?? '';
  return SECRET_NAMES.some((pattern) => pattern.test(name)) && !/\.(m?[jt]sx?|cjs|py|go|rb|java|kt|swift|rs|cs|css|scss|less|html|md|vue|svelte)$/i.test(name.replace(/^\.env.*/i, ''));
};

const SECRET_TEXT: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[private key removed]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\b(sk|pk|rk)[-_](live|test|ant|proj)?[-_]?[A-Za-z0-9_-]{16,}/g, '[secret]'],
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '[secret]'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, '[secret]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, '[secret]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[token]'],
  [/((?:password|passwd|secret|token|api[_-]?key|client[_-]?secret)["']?\s*[:=]\s*)(["'])[^"'\n]{4,}\2/gi, '$1$2[secret]$2'],
];

// Emails and secret-looking values out of any text bound for the reviewer.
export const redactSecrets = (text: string): string => SECRET_TEXT.reduce((out, [pattern, swap]) => out.replace(pattern, swap), text);

// ---- The reviewer's JSON.
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const words = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const squash = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

// A quote counts only if it really is in one of the excerpts.
export const quoteIsRecorded = (quote: string, reasoning: readonly ReasoningExcerpt[]): boolean =>
  squash(quote).length >= 8 && reasoning.some((r) => squash(r.text).includes(squash(quote)));

export interface AnswerCheck {
  answers: Record<string, WhyAnswer>; // by card key
  missing: string[]; // card keys with no usable answer
  extra: string[]; // ids the reviewer made up
}

// ids maps the prompt's F1, F2… to card keys. Unknown or repeated ids are extra; a "recorded" claim without a real quote is inferred.
export function checkAnswers(raw: unknown, ids: ReadonlyMap<string, string>, reasoning: readonly ReasoningExcerpt[]): AnswerCheck {
  const list = isRecord(raw) && Array.isArray(raw.answers) ? raw.answers : [];
  const answers: Record<string, WhyAnswer> = {};
  const extra: string[] = [];
  for (const item of list) {
    const id = isRecord(item) ? words(item.id) : '';
    const key = ids.get(id);
    if (!key || answers[key] || !isRecord(item)) {
      extra.push(id || '(no id)');
      continue;
    }
    const answer = { shape: words(item.shape), driver: words(item.driver), alternatives: words(item.alternatives), risk: words(item.risk) };
    if (!answer.shape && !answer.driver) continue; // empty: counts as missing
    const quote = words(item.quote);
    const recorded = item.basis === 'recorded' && quoteIsRecorded(quote, reasoning);
    answers[key] = { ...answer, basis: recorded ? 'recorded' : 'inferred', quote: recorded ? quote : null };
  }
  const missing = [...ids.values()].filter((key) => !answers[key]);
  return { answers, missing, extra };
}

// ---- The Board's roll-up: by file, then function, newest change first.
const newest = (changes: readonly TaskChange[]): number => Math.max(...changes.map((c) => Date.parse(c.at ?? '') || 0));

export function groupTaskChanges(changes: readonly TaskChange[]): TaskFile[] {
  const files = new Map<string, { display: string; functions: Map<string, TaskChange[]> }>();
  for (const change of changes) {
    const file = files.get(change.card.file) ?? { display: change.card.display, functions: new Map() };
    file.functions.set(change.card.name, [...(file.functions.get(change.card.name) ?? []), change]);
    files.set(change.card.file, file);
  }
  const byNewest = <T extends { changes: TaskChange[] }>(a: T, b: T) => newest(b.changes) - newest(a.changes);
  return [...files].map(([file, { display, functions }]) => {
    const fns = [...functions].map(([name, list]) => ({ name, changes: [...list].sort((a, b) => newest([b]) - newest([a])) })).sort(byNewest);
    return { file, display, functions: fns, changes: fns.flatMap((f) => f.changes) };
  }).sort(byNewest).map(({ file, display, functions }) => ({ file, display, functions }));
}

// ---- Words.
export const KIND_WORDS: Record<CardKind, string> = { function: 'Function', module: 'Module level', hunk: 'Hunk level' };
export const TOKENS_PER_ANSWER = 220; // a typical answer's four fields
