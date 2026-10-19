// The test loop as two agents working at once, joined by a per-task bug queue. The testing agent keeps writing and running
// tests and files bugs as [fail] lines in the criteria file; the bug fix agent takes the oldest open bug whenever it is
// idle; the testing agent verifies each fix on its next run. Pure: Petal's loop timer calls stepQueue and sends
// the messages it returns.
import type { CriteriaItem } from './test-loop';
import type { LoopPhase } from './loop-line';
import type { TestCase } from './testing';

// recheck: failed while the fixer was mid-edit, so it is run once more before it counts.
export type BugState = 'recheck' | 'open' | 'fixing' | 'verify' | 'verified';
export const BUG_STATES: BugState[] = ['recheck', 'open', 'fixing', 'verify', 'verified'];
export const BUG_STATE_WORDS: Record<BugState, string> = { recheck: 'Rechecking', open: 'Open', fixing: 'Fixing', verify: 'Awaiting verify', verified: 'Verified' };

export interface QueuedBug {
  key: string;
  name: string;
  test: string | null; // "path::test name"
  state: BugState;
  since: number; // when it entered this state
  asked: boolean; // Petal sent this state's message (recheck, fix or verify)
  testerRound: number; // the testing agent's round when it entered this state
  rechecked: boolean;
  sent?: SentFrom; // she sent it from a failed run; no criteria line needed, the next run verifies it
}

// Her "Send to bug fix agent": the stage it failed in and the fix prompt built from its failures.
export interface SentFrom { stage: string; failure: string }
export type RunResult = 'passed' | 'failed' | null;

export interface QueueFacts {
  bugs: readonly CriteriaItem[]; // this task's bug lines
  testerRound: number;
  fixerBusy: boolean;
  fixesDone: readonly { name: string; at: number }[]; // the fixer's "**Fix:** name · done" lines
  now: number;
  rerun?: (bug: QueuedBug) => RunResult; // a sent bug's test or stage in a run since it entered its state
}

export type QueueMessage = { to: 'tester' | 'fixer'; key: string; text: string };
export interface QueueStep { queue: QueuedBug[]; send: QueueMessage[]; moves: { key: string; name: string; from: BugState | null; to: BugState }[] }

const RECHECKED = /[\s·(,-]*\brechecked\b[)\s]*$/i;
// A bug's identity: its name, ignoring case, punctuation and a "rechecked" note at the end.
export const bugKey = (name: string): string => name.replace(RECHECKED, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const testOf = (item: CriteriaItem): string | null => (item.test ? `${item.test.path}${item.test.name ? `::${item.test.name}` : ''}` : null);

export interface QueueWords { tester: string; fixer: string; failure: (bug: QueuedBug) => string }

const ACTIVE: BugState[] = ['recheck', 'open', 'fixing', 'verify'];
export const activeBugs = (queue: readonly QueuedBug[]): QueuedBug[] => queue.filter((b) => ACTIVE.includes(b.state));

// One refresh: new bugs join, the criteria file and the fixer's Fix lines move them, and each state sends its message once.
export function stepQueue(queue: readonly QueuedBug[], facts: QueueFacts, words: QueueWords): QueueStep {
  const send: QueueMessage[] = [];
  const moves: QueueStep['moves'] = [];
  const lines = new Map(facts.bugs.map((b) => [bugKey(b.name), b]));
  const move = (bug: QueuedBug, to: BugState): QueuedBug => {
    moves.push({ key: bug.key, name: bug.name, from: bug.state, to });
    return { ...bug, state: to, since: facts.now, asked: false, testerRound: facts.testerRound };
  };
  let next: QueuedBug[] = [];
  const fixDone = (b: QueuedBug) => b.state === 'fixing' && facts.fixesDone.some((f) => bugKey(f.name) === b.key && f.at >= b.since);
  // A sent bug with no criteria line: its Fix line moves it to verify, then a newer run passes or reopens it.
  const stepSent = (bug: QueuedBug): QueuedBug => {
    if (fixDone(bug)) return move(bug, 'verify');
    if (bug.state !== 'verify') return bug;
    const result = facts.rerun?.(bug) ?? null;
    return result === 'passed' ? move(bug, 'verified') : result === 'failed' ? move(bug, 'open') : bug;
  };
  for (const bug of queue) {
    const line = lines.get(bug.key);
    if (!line && bug.sent) { next.push(stepSent(bug)); continue; }
    if (!line) { if (bug.state === 'verified') next.push(bug); continue; } // a recheck that passed: the line is gone
    let b: QueuedBug = { ...bug, test: testOf(line) ?? bug.test };
    if (line.status === 'fixed' && b.state !== 'verified') b = move(b, 'verified');
    else if (line.status === 'fail' && b.state === 'recheck' && b.asked && (RECHECKED.test(line.name) || facts.testerRound > b.testerRound)) b = { ...move(b, 'open'), rechecked: true };
    else if (line.status === 'fail' && b.state === 'verify' && facts.testerRound > b.testerRound) b = move(b, 'open');
    else if (fixDone(b)) b = move(b, 'verify');
    next.push(b);
  }
  for (const [key, line] of lines) {
    if (line.status !== 'fail' || next.some((b) => b.key === key)) continue;
    const state: BugState = facts.fixerBusy ? 'recheck' : 'open';
    moves.push({ key, name: line.name, from: null, to: state });
    next.push({ key, name: line.name.replace(RECHECKED, ''), test: testOf(line), state, since: facts.now, asked: false, testerRound: facts.testerRound, rechecked: RECHECKED.test(line.name) });
  }
  next = next.map((b) => {
    if (b.asked) return b;
    if (b.state === 'recheck' && !facts.fixerBusy) {
      send.push({ to: 'tester', key: b.key, text: `Recheck "${b.name}": ${words.fixer} was mid-edit when it failed. Rerun ${b.test ?? 'its test'} once now. If it passes, remove its line under Bugs. If it still fails, keep the line and add "rechecked" to its name.` });
      return { ...b, asked: true };
    }
    if (b.state === 'verify' && !(b.sent && !lines.has(b.key))) { // a sent bug waits for a run instead
      send.push({ to: 'tester', key: b.key, text: `Verify "${b.name}": ${words.fixer} says it is fixed. Rerun ${b.test ?? 'its test'} on your next run. Mark it [fixed] if it passes; if not, keep it [fail] with the new output.` });
      return { ...b, asked: true };
    }
    return b;
  });
  if (!facts.fixerBusy && !next.some((b) => b.state === 'fixing')) {
    const oldest = next.filter((b) => b.state === 'open').sort((a, b) => a.since - b.since)[0];
    if (oldest) {
      const fixing = { ...move(oldest, 'fixing'), asked: true };
      next = next.map((b) => (b.key === oldest.key ? fixing : b));
      send.push({ to: 'fixer', key: oldest.key, text: [`Bug: ${oldest.name}${oldest.rechecked ? ' (rechecked)' : ''}.`, oldest.test ? `Failing test: ${oldest.test}.` : '', words.failure(oldest), `Fix the app code, run that test to confirm, then end with **Fix:** ${oldest.name} · done`].filter(Boolean).join('\n') });
    }
  }
  return { queue: next, send, moves };
}

// Done: nothing left in the queue and the testing agent's latest round found nothing new.
export const queueDone = (queue: readonly QueuedBug[], testerPhase: LoopPhase | null): boolean => testerPhase === 'done' && !activeBugs(queue).length;

export const queueCounts = (queue: readonly QueuedBug[]): Record<BugState, number> =>
  Object.fromEntries(BUG_STATES.map((s) => [s, queue.filter((b) => b.state === s).length])) as Record<BugState, number>;

// The fixer's "**Fix:** name · done" lines in its replies, with when they were written.
const FIX_LINE = /^\s*(?:\*\*|__)?fix(?:\s*:\s*(?:\*\*|__)|(?:\*\*|__)\s*:|\s*:)\s*(.+?)\s*[·•]\s*(done|blocked)\b/i;
export function fixLines(replies: readonly { markdown: string; timestamp?: string }[], since = 0): { name: string; at: number; outcome: 'done' | 'blocked' }[] {
  const found: { name: string; at: number; outcome: 'done' | 'blocked' }[] = [];
  for (const reply of replies) {
    const at = Date.parse(reply.timestamp ?? '') || 0;
    if (at && at < since) continue;
    for (const line of reply.markdown.split('\n')) {
      const match = FIX_LINE.exec(line);
      if (match?.[1]) found.push({ name: match[1], at, outcome: match[2]?.toLowerCase() === 'blocked' ? 'blocked' : 'done' });
    }
  }
  return found;
}

// ---- Her "Send to bug fix agent" from a failed run: one bug per click, the test she picked or the whole stage.
export const SENT_FAILURE_CAP = 3200;
export interface SentBug { name: string; test: string | null; sent: SentFrom }

export const sentBug = (stage: string, test: Pick<TestCase, 'name' | 'file'> | null, prompt: string): SentBug => ({
  name: test ? test.name : `${stage} stage fails`,
  test: test ? `${test.file}::${test.name}` : null,
  sent: { stage, failure: prompt.slice(0, SENT_FAILURE_CAP) },
});

const WAITING: BugState[] = ['recheck', 'open', 'fixing'];

// Joins the queue unless the same test or name is already waiting or being fixed; one awaiting verify starts over.
export function addSent(queue: readonly QueuedBug[], bug: SentBug, now: number, state: 'open' | 'fixing' = 'open'): { queue: QueuedBug[]; added: boolean } {
  const key = bugKey(bug.name);
  const same = (b: QueuedBug) => b.key === key || (bug.test !== null && b.test === bug.test);
  if (queue.some((b) => same(b) && WAITING.includes(b.state))) return { queue: [...queue], added: false };
  const fresh: QueuedBug = { key, name: bug.name, test: bug.test, state, since: now, asked: state === 'fixing', testerRound: 0, rechecked: false, sent: bug.sent };
  return { queue: [...queue.filter((b) => !same(b)), fresh], added: true };
}
