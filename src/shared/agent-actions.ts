// An agent's action log, read from its Claude Code transcript: every tool call in order with its time, what it changed,
// a command's exit and output tail, refusals, and the tokens each step used. Pure: entries in, actions out.
import { parseLoop } from './loop-line';
import { cachedTokens, usageOf, totalTokens } from './token-usage';

export type ActionKind = 'edit' | 'write' | 'bash' | 'read' | 'refused' | 'other';

export interface AgentAction {
  id: string;
  at: number;
  kind: ActionKind;
  text: string; // "Edited src/cart.ts (+4 −1)"
  path: string | null;
  detail: string; // a diff, a command's output tail, the files read, or the refusal's reason
  tokens: number; // the message's tokens, on its first action only
  cached?: number; // of those, the cache reads
  round: number | null; // the Loop round it happened in
}

const OUTPUT_TAIL = 1500;
const COMMAND_CHARS = 80;
const TEST_PATH = /(^|\/)(tests?|__tests__|e2e|spec|\.maestro)\/|\.(test|spec)\.[a-z0-9]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/;
const REFUSED = /Tests belong to|only changes tests|hook.*(denied|blocked)|PreToolUse.*(deny|denied)/i;

interface ToolUse { id: string; name: string; input: Record<string, unknown>; at: number; tokens: number; cached: number; round: number | null }
type Item = { type?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean; text?: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const textOf = (content: unknown): string => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.map((p: Item) => (p?.type === 'text' ? p.text ?? '' : '')).join('\n') : '');
const lines = (text: unknown): string[] => (typeof text === 'string' && text ? text.split('\n') : []);
const tail = (text: string): string => (text.length > OUTPUT_TAIL ? `…${text.slice(-OUTPUT_TAIL)}` : text);

export function relTo(file: unknown, root: string | null): string {
  const name = typeof file === 'string' ? file : '';
  return root && name.startsWith(`${root.replace(/\/+$/, '')}/`) ? name.slice(root.replace(/\/+$/, '').length + 1) : name;
}

function diff(oldText: unknown, newText: unknown): { added: number; removed: number; detail: string } {
  const before = lines(oldText);
  const after = lines(newText);
  return { added: after.length, removed: before.length, detail: [...before.map((l) => `- ${l}`), ...after.map((l) => `+ ${l}`)].join('\n') };
}

function finish(use: ToolUse, result: Item, root: string | null): AgentAction {
  const base = { id: use.id, at: use.at, tokens: use.tokens, cached: use.cached, round: use.round };
  const output = textOf(result.content);
  const file = relTo(use.input.file_path ?? use.input.notebook_path, root);
  if (result.is_error && REFUSED.test(output)) {
    const target = file || String(use.input.command ?? '').slice(0, COMMAND_CHARS);
    return { ...base, kind: 'refused', text: `Refused: tried to ${use.name === 'Bash' ? 'run' : 'edit'} ${target}`, path: file || null, detail: output.trim() };
  }
  switch (use.name) {
    case 'Edit': {
      const d = diff(use.input.old_string, use.input.new_string);
      return { ...base, kind: 'edit', text: `Edited ${file} (+${d.added} −${d.removed})`, path: file, detail: d.detail };
    }
    case 'MultiEdit': {
      const edits = Array.isArray(use.input.edits) ? use.input.edits.filter(isRecord) : [];
      const parts = edits.map((e) => diff(e.old_string, e.new_string));
      const added = parts.reduce((n, p) => n + p.added, 0);
      const removed = parts.reduce((n, p) => n + p.removed, 0);
      return { ...base, kind: 'edit', text: `Edited ${file} (+${added} −${removed})`, path: file, detail: parts.map((p) => p.detail).join('\n…\n') };
    }
    case 'Write':
    case 'NotebookEdit':
      return { ...base, kind: 'write', text: `Wrote ${TEST_PATH.test(file) ? 'test ' : ''}${file} (${lines(use.input.content).length} lines)`, path: file, detail: tail(String(use.input.content ?? '')) };
    case 'Bash': {
      const command = String(use.input.command ?? '').replace(/\s+/g, ' ').trim();
      const exit = Number(/^Exit code (\d+)/m.exec(output)?.[1] ?? (result.is_error ? 1 : 0));
      return { ...base, kind: 'bash', text: `Ran ${command.length > COMMAND_CHARS ? `${command.slice(0, COMMAND_CHARS - 1)}…` : command} · exit ${exit}`, path: null, detail: tail(output.trim()) };
    }
    case 'Read':
      return { ...base, kind: 'read', text: `Read ${file}`, path: file, detail: file };
    default:
      return { ...base, kind: 'other', text: `Used ${use.name}`, path: null, detail: tail(output.trim()) };
  }
}

// Reads run back to back fold into one "Read 3 files" line.
function foldReads(actions: AgentAction[]): AgentAction[] {
  const out: AgentAction[] = [];
  for (const action of actions) {
    const last = out[out.length - 1];
    if (action.kind === 'read' && last?.kind === 'read' && last.round === action.round) {
      const files = [...last.detail.split('\n'), action.path ?? ''].filter(Boolean);
      out[out.length - 1] = { ...last, text: `Read ${files.length} files`, detail: files.join('\n'), tokens: last.tokens + action.tokens, cached: (last.cached ?? 0) + (action.cached ?? 0) };
    } else out.push(action);
  }
  return out;
}

// Oldest first. Entries are transcript lines already parsed; a tool call with no result yet is left out until it has one.
export function actionsFrom(entries: readonly unknown[], root: string | null = null): AgentAction[] {
  const pending = new Map<string, ToolUse>();
  const seenMessages = new Set<string>();
  const done: AgentAction[] = [];
  let round: number | null = null;
  for (const raw of entries) {
    const entry = raw as { type?: string; timestamp?: string; isSidechain?: boolean; message?: { content?: unknown } };
    if (!isRecord(entry) || entry.isSidechain) continue;
    const at = Date.parse(entry.timestamp ?? '') || 0;
    const items: Item[] = Array.isArray(entry.message?.content) ? entry.message.content as Item[] : [];
    if (entry.type === 'assistant') {
      const usage = usageOf(entry);
      const fresh = usage && (!usage.id || !seenMessages.has(usage.id));
      let tokens = fresh ? totalTokens(usage.usage) : 0;
      let cached = fresh ? cachedTokens(usage.usage) : 0;
      if (usage?.id) seenMessages.add(usage.id);
      for (const item of items) {
        if (item.type === 'text' && item.text) round = parseLoop(item.text)?.round ?? round;
        if (item.type === 'tool_use' && item.id && item.name) {
          pending.set(item.id, { id: item.id, name: item.name, input: isRecord(item.input) ? item.input : {}, at, tokens, cached, round });
          tokens = 0;
          cached = 0;
        }
      }
    }
    if (entry.type === 'user') {
      for (const item of items) {
        const use = item.type === 'tool_result' && item.tool_use_id ? pending.get(item.tool_use_id) : undefined;
        if (!use) continue;
        pending.delete(use.id);
        done.push(finish(use, item, root));
      }
    }
  }
  return foldReads(done.sort((a, b) => a.at - b.at));
}

export interface RoundSummary { round: number | null; edits: number; commands: number; refusals: number; text: string }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// "Round 2 · 5 edits · 3 commands · 1 refusal", newest round first.
export function roundSummaries(actions: readonly AgentAction[]): RoundSummary[] {
  const rounds = new Map<number | null, RoundSummary>();
  for (const a of actions) {
    const r = rounds.get(a.round) ?? { round: a.round, edits: 0, commands: 0, refusals: 0, text: '' };
    if (a.kind === 'edit' || a.kind === 'write') r.edits += 1;
    if (a.kind === 'bash') r.commands += 1;
    if (a.kind === 'refused') r.refusals += 1;
    rounds.set(a.round, r);
  }
  return [...rounds.values()].map((r) => ({ ...r, text: [r.round === null ? 'So far' : `Round ${r.round}`, plural(r.edits, 'edit'), plural(r.commands, 'command'), plural(r.refusals, 'refusal')].join(' · ') })).reverse();
}
