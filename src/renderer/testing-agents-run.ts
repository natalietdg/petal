// The test loop's handoffs to main: start, stop, bugs for the fixer, questions for the tester, agent logs, round estimate.
import { isIpcError } from './dom';
import type { AgentContext, Shown } from './testing-agents-shown';
import { buildFixerBrief, buildLoopBrief, isActive, ticketInText, type LoopStatus } from '../shared/test-loop';
import type { SentBug } from '../shared/bug-queue';
import { ROLES, agentOf, finishedRounds, isRunning } from '../shared/agent-loop';
import { estimateRoundTokens, roundEstimate, type RoundEstimate } from '../shared/token-usage';
import { routeMessage, sentNote } from '../shared/agent-chat';

export function createRun(ctx: AgentContext, shown: Shown, tick: () => Promise<void>) {
  const { nameOf } = shown;

  // The scenario names she approved for the shown task, carried from its last loop or draft into the next.
  const approvedSoFar = (): string[] | undefined => shown.record()?.approvedScenarios;

  function briefs(focus: string, rounds: number): { tester: string; fixer: string } | null {
    const task = ctx.task();
    const suite = ctx.suite();
    if (!task || !suite) return null;
    const names = { tester: nameOf('tester'), fixer: nameOf('fixer') };
    const review = !approvedSoFar()?.length; // none approved yet: round 1 stops for her review
    return {
      tester: buildLoopBrief({ focus, rounds, stages: suite.stages, stack: ctx.stack(), taskId: task.id, agent: true, names, sources: { notes: task.notes, prd: ctx.prd() }, review, suiteDir: ctx.suiteDir(), ticket: ticketInText(task.title) }),
      fixer: buildFixerBrief({ taskId: task.id, taskTitle: task.title, stages: suite.stages, names }),
    };
  }

  // Tokens per round: this task's finished rounds averaged once it has some, else a rough figure from the two briefs
  // and the size of the task's last run output.
  function estimate(status: LoopStatus): RoundEstimate | null {
    const b = briefs('', 5);
    if (!b) return null;
    const last = ctx.taskRuns()[0];
    const output = last ? last.stages.reduce((n, s) => n + s.output.length + s.tests.reduce((m, t) => m + t.name.length + (t.failure?.length ?? 0), 0), 0) : 0;
    const rough = estimateRoundTokens({ briefChars: [b.tester.length, b.fixer.length], suiteOutputChars: output });
    const r = shown.shownLoop();
    const over = Boolean(r?.stoppedAt) || status === 'done' || status === 'stopped';
    return roundEstimate(r ? finishedRounds(r.actions.tester, r.actions.fixer, r.startedAt, over) : [], rough);
  }

  // Start: each role's open agent gets its brief as a message (the drafting agent is reused), else main starts one.
  async function start(focus: string, rounds: number): Promise<void> {
    const from = ctx.tabId();
    const task = ctx.task();
    const b = briefs(focus, rounds);
    if (!from || !task || !b || isActive(shown.facts().status)) return;
    const loop = shown.shownLoop();
    const joining = loop && isRunning(loop) && loop.fixer && !loop.tester ? loop : null; // her bug fix agent already runs: only the testing agent starts
    const reply = await window.pastel.testing.loopStart({ tabId: from, root: ctx.picked(), taskId: task.id, testerBrief: b.tester, fixerBrief: joining ? null : b.fixer });
    if (isIpcError(reply) || 'note' in reply) { ctx.say(isIpcError(reply) ? `Couldn’t start the loop: ${reply.error}` : reply.note); return; }
    ctx.say(joining ? `${nameOf('tester')} is starting. ${nameOf('fixer')} keeps fixing.` : `${nameOf('tester')} and ${nameOf('fixer')} are starting.`);
    await tick();
  }

  // Her "Send to bug fix agent": the failure joins the task's bug queue, else the bug fix agent starts on it. Its fix
  // waits in "Awaiting verify" until a newer run of that test or stage passes. Returns the note to show.
  async function sendToFixer(bug: SentBug): Promise<string> {
    const from = ctx.tabId();
    const task = ctx.task();
    if (!from || !task) return 'Pick a task first.';
    const fixer = nameOf('fixer');
    const reply = await window.pastel.testing.sendBug({ tabId: from, root: ctx.picked(), taskId: task.id, bug });
    if (isIpcError(reply)) return `Couldn’t send it: ${reply.error}`;
    if ('note' in reply) return reply.note;
    await tick();
    if (reply.outcome === 'already') return `${fixer} already has "${bug.name}" in its queue.`;
    if (reply.outcome === 'started') return `Started ${fixer} on "${bug.name}". Run the suite again once it says done, to verify.`;
    return `Sent "${bug.name}" to ${fixer}'s queue. Run the suite again once it says done, to verify.`;
  }

  // Stop halts both, from any window: main stops the queue, then sends Esc to each and the stop message once each is idle.
  async function stop(): Promise<void> {
    const r = shown.shownLoop();
    if (!r || r.stopping) return;
    r.stopping = true;
    ctx.say('Interrupting both agents, then asking them to stop and summarise.');
    ctx.redraw();
    const reply = await window.pastel.testing.loopStop({ root: r.root, taskId: r.taskId });
    r.stopping = false;
    ctx.say(isIpcError(reply) ? `Couldn’t stop the loop: ${reply.error}` : 'note' in reply ? reply.note : 'Asked both agents to stop. Their summaries show in their lanes.');
    await tick();
    ctx.redraw();
  }

  // An open thread's card from the loop panel: a question to the testing agent, through main like her lane messages.
  async function askTester(prompt: string): Promise<string> {
    const r = shown.shownLoop();
    const route = routeMessage(r?.tester ?? null, prompt);
    if ('note' in route || !r) return 'note' in route ? route.note : '';
    const reply = await window.pastel.testing.agentSend({ root: r.root, sessionId: route.sessionId, text: prompt });
    return isIpcError(reply) ? `Couldn’t send it: ${reply.error}` : 'note' in reply ? reply.note : sentNote(nameOf('tester'), reply.outcome);
  }

  // The shown task's agents: their action logs, tokens and replies, from each session's transcript or live terminal.
  async function refreshLogs(): Promise<void> {
    const r = shown.record();
    const from = ctx.tabId();
    if (!r || !from) return;
    for (const role of ROLES) {
      const agent = agentOf(r, role);
      if (!agent) continue;
      const reply = await window.pastel.testing.agentLog({ tabId: from, root: ctx.picked(), sessionId: agent.sessionId });
      if (isIpcError(reply) || 'note' in reply) continue;
      r.actions[role] = reply.actions;
      r.tokens[role] = reply.tokens;
      r.replies[role] = reply.replies;
    }
  }

  return { estimate, refreshLogs, start, sendToFixer, stop, askTester };
}
