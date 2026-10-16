// The test loop's progress line Claude ends each round with: "**Loop:** round 2/5 · fixing · 3 open".

export const LOOP_PHASES = ['scenarios', 'testing', 'fixing', 'verifying', 'done', 'stopped'] as const;
export type LoopPhase = typeof LOOP_PHASES[number];

export interface LoopProgress {
  round: number; // 1-based
  total: number;
  phase: LoopPhase;
  open: number | null; // null when the line leaves the count out
}

// Label as Station's, then "round n/N · phase", then an optional "· k open", then an optional period.
const LINE = /^\s*(?:\*\*|__)?loop(?:\s*:\s*(?:\*\*|__)|(?:\*\*|__)\s*:|\s*:)\s*round\s+(\d{1,3})\s*\/\s*(\d{1,3})\s*[·•]\s*([a-z]+)\s*(?:[·•]\s*(\d{1,4})\s+open\s*)?\.?\s*$/i;
const FENCE = /^\s*(```|~~~)/;

export const isTerminal = (phase: LoopPhase): boolean => phase === 'done' || phase === 'stopped';

// Null for anything malformed (round above total, zero, an unknown phase); the line then stays in the body as text.
export function parseLoopLine(line: string): LoopProgress | null {
  const match = LINE.exec(line);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const round = Number(match[1]);
  const total = Number(match[2]);
  const phase = match[3].toLowerCase() as LoopPhase;
  if (round < 1 || round > total || !LOOP_PHASES.includes(phase)) return null;
  return { round, total, phase, open: match[4] === undefined ? null : Number(match[4]) };
}

// One reply's Loop line outside code fences; the last one wins, since a round ends with it.
export function parseLoop(markdown: string): LoopProgress | null {
  let fenced = false;
  let found: LoopProgress | null = null;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    if (fenced) continue;
    found = parseLoopLine(line) ?? found;
  }
  return found;
}

// Replies newest first; only those at or after `since` (ms) count, so an older loop's "done" never shows as the new one's.
export function latestLoop(newestFirst: readonly { markdown: string; timestamp?: string }[], since = 0): LoopProgress | null {
  for (const reply of newestFirst) {
    const at = Date.parse(reply.timestamp ?? '');
    if (since && Number.isFinite(at) && at < since) return null;
    const progress = parseLoop(reply.markdown);
    if (progress) return progress;
  }
  return null;
}

const PHASE_WORD: Record<LoopPhase, string> = { scenarios: 'Writing scenarios', testing: 'Testing', fixing: 'Fixing', verifying: 'Verifying', done: 'Done', stopped: 'Stopped' };
export const phaseWord = (phase: LoopPhase): string => PHASE_WORD[phase];

export const loopCaption = (p: LoopProgress): string =>
  `${phaseWord(p.phase)} · round ${p.round}/${p.total}${p.open === null ? '' : ` · ${p.open} open`}`;

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Station's segmented bar, one segment per round: earlier rounds filled, the current one filled once the loop is done.
export function loopBarHtml(p: LoopProgress): string {
  const segments = Array.from({ length: p.total }, (_, i) => {
    const round = i + 1;
    const kind = round < p.round ? 'done' : round === p.round ? `current ${isTerminal(p.phase) ? 'met' : 'pending'}` : 'todo';
    return `<span class="station-seg ${kind}"></span>`;
  }).join('');
  const caption = escapeHtml(loopCaption(p));
  return `<span class="station-progress loop-progress" role="progressbar" aria-label="Test loop" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.round}" aria-valuetext="Round ${p.round} of ${p.total}, ${escapeHtml(phaseWord(p.phase).toLowerCase())}${p.open === null ? '' : `, ${p.open} open`}">`
    + `<span class="station-segs" aria-hidden="true">${segments}</span><span class="station-caption">${caption}</span></span>`;
}
