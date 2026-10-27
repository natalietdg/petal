// The suite draft: the testing agent writes the repo's suite and scenarios, and she reviews them before any tests.
import { isIpcError } from './dom';
import { keyOf, type AgentLoop } from './testing-agents-loops';
import type { AgentContext, LaneNotes, Shown } from './testing-agents-shown';
import { askAgainText, draftEnded, suiteProblemText } from '../shared/suite-draft';

export function createDraft(ctx: AgentContext, shown: Shown, notes: LaneNotes, tick: () => Promise<void>) {
  const askedAt = new Map<string, number>(); // `${root}:${taskId}` -> when Petal last sent a follow-up to its drafting agent
  const pastedProblems = new Set<string>(); // `${key}:${problem}` sent back once each

  // The shown task's draft, and whether it ended with no suite.
  function draft(): { ended: boolean } | null {
    const r = shown.drafting();
    if (!r?.tester) return null;
    const since = Math.max(r.startedAt, askedAt.get(keyOf(r.root, r.taskId)) ?? 0);
    const worked = shown.repliesOf(r, 'tester').some((reply) => Date.parse(reply.timestamp ?? '') >= since);
    return { ended: draftEnded({ suite: Boolean(ctx.suite()), state: r.tester.state, worked, reviewing: shown.awaiting().length > 0 }) };
  }

  // Looks right: main sends the go-ahead to the testing agent (resumed if needed) and saves the names she approved.
  async function approveScenarios(): Promise<void> {
    const r = shown.record();
    const scenarios = shown.awaiting();
    if (!r || !scenarios.length) return;
    const reply = await window.pastel.testing.approveScenarios({ root: r.root, taskId: r.taskId, names: scenarios.map((s) => s.name) });
    notes.tester = isIpcError(reply) ? `Couldn’t send it: ${reply.error}` : 'note' in reply ? reply.note : `Sent. ${shown.nameOf('tester')} is writing the tests.`;
    await tick();
    ctx.redraw();
  }

  // Edit scenarios: the repo's criteria file in her editor; Petal reads it again on its next refresh.
  async function editScenarios(): Promise<void> {
    const from = ctx.tabId();
    if (!from) return;
    const reply = await window.pastel.testing.openCriteria({ tabId: from, root: ctx.picked() });
    notes.tester = isIpcError(reply) ? `Couldn’t open the file: ${reply.error}` : 'note' in reply ? reply.note : 'Opened in your editor. Save it, then come back here.';
    ctx.redraw(); // the note shows under the review, in Scenarios & bugs
  }

  // A follow-up to the testing agent, through main (which resumes it if needed); a draft's worked counts again from now.
  async function sendToTester(r: AgentLoop, text: string, event: string): Promise<boolean> {
    if (!r.tester) return false;
    const reply = await window.pastel.testing.agentSend({ root: r.root, sessionId: r.tester.sessionId, text, event });
    if (isIpcError(reply) || 'note' in reply) return false;
    askedAt.set(keyOf(r.root, r.taskId), Date.now());
    return true;
  }

  // Ask again: the drafting agent gets a follow-up, resumed if it ended; 'start' when there is none to ask.
  async function askAgain(): Promise<'pasted' | 'start' | 'failed'> {
    const r = shown.drafting();
    const task = ctx.task();
    if (!r || !task || !r.tester || r.tester.state === 'closed') return 'start';
    return (await sendToTester(r, askAgainText(ctx.suiteDir()), `You → ${shown.nameOf('tester')} · asked again for the suite`)) ? 'pasted' : 'failed';
  }

  // After each refresh: a suite file the drafting agent wrote but Petal couldn't use goes back to it once, with a fix request.
  async function checkDraft(problem: string | null): Promise<void> {
    const r = shown.drafting();
    const task = ctx.task();
    if (!r?.tester || !task || !problem || r.tester.state === 'closed' || r.tester.state === 'working') return;
    const k = `${keyOf(r.root, r.taskId)}:${problem}`;
    if (pastedProblems.has(k)) return;
    pastedProblems.add(k);
    if (!(await sendToTester(r, suiteProblemText(ctx.suiteDir(), problem), `Petal → ${shown.nameOf('tester')} · the suite file can’t be used`))) pastedProblems.delete(k);
    else ctx.redraw();
  }

  return { draft, approveScenarios, editScenarios, askAgain, checkDraft };
}
