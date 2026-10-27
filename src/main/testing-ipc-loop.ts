// Testing IPC for a task's test loop: drafting its suite, starting and stopping the loop, sending it bugs.
import { handle } from './ipc';
import { allowedClaudeHome, claudeFolderAllowed } from './claude-folder';
import { isSnapshotRun, testingFixture } from './snapshot-mode';
import { projectRootOf } from './testing-project';
import { loopsOf, saveLoop, testAgentsOf } from './task-suites';
import { suiteDir, suiteHome } from './repo-suite-store';
import { draftWithSkill } from './testing-skill';
import { prepareCriteria } from './criteria-store';
import * as store from './testing-store';
import { agentView, claimAgent, closeTaskAgents, listedLoops, loopView, sendToAgent, stopTaskLoop, watchRoot, windowReady, type Claim } from './test-agents';
import { agentName, type AgentRole } from '../shared/agent-names';
import { cleanSentBug, isRunning, loopForFixer, noEvents, openAgent, withEvent } from '../shared/agent-loop';
import { addSent } from '../shared/bug-queue';
import { buildSentFixerBrief, ITEMS_CAP, NAME_CAP } from '../shared/test-loop';
import { scenariosApprovedText } from '../shared/suite-draft';
import { isTaskId } from '../shared/repo-suite';
import type { LoopFacts, StoredLoop } from '../shared/testing';
import type { Task } from '../shared/tasks';
import { agentAt, BRIEF_CAP, type TestingIpcContext } from './testing-ipc-context';

const KNOWN_CAP = 50; // loops one window asks about per tick
const NAMES_CAP = 200; // scenario names approved in one go

// A role's brief: its open agent gets it as a message, else that agent starts with it. The registry decides which.
async function briefRole(contentsId: number, root: string, task: Task, role: AgentRole, brief: string): Promise<Claim | { note: string }> {
  const claim = await claimAgent(root, { taskId: task.id, taskTitle: task.title, role, brief, preferred: contentsId });
  if ('note' in claim || claim.created) return claim;
  const sent = await sendToAgent(root, claim.agent, brief, null, contentsId);
  return 'note' in sent ? sent : claim;
}

const startedWords = (claim: Claim, name: string): string => (claim.created ? `Started ${name} in its own terminal` : `${name} moves on to the test loop`);

// Starting a task's agents (the loop, or a suite draft) and the lanes' read model.
export function registerLoopStartIpc({ taskTarget }: TestingIpcContext): void {
  // The loop for a task: its testing agent and its bug fix agent, working at once. Each role's open agent is reused
  // (the drafting agent moves on to the loop this way), else one starts. One brief joins a running bug fix agent.
  handle('testing:loop-start', async (event, { tabId, root: picked, taskId, testerBrief, fixerBrief }) => {
    const target = await taskTarget(event.sender.id, tabId, picked, taskId);
    if ('note' in target) return target;
    const briefs = [testerBrief, fixerBrief].filter((brief) => brief !== null && brief !== undefined);
    if (!briefs.length || briefs.some((brief) => typeof brief !== 'string' || !brief.trim() || brief.length > BRIEF_CAP)) return { note: 'A loop brief is empty or too long.' };
    const { root, task } = target;
    const prior = loopsOf(root)[task.id];
    const running = isRunning(prior) ? prior : null;
    const names = store.load(root).agentNames ?? {};
    if (!fixerBrief && !running?.fixerSessionId) return { note: 'Start the loop to start its testing agent.' };
    if (fixerBrief && running) return { note: `${agentName(names, 'fixer')} is already running for this task, maybe in another window.` };
    prepareCriteria(root);
    const tester = typeof testerBrief === 'string' ? await briefRole(event.sender.id, root, task, 'tester', testerBrief) : null;
    if (tester && 'note' in tester) return tester;
    const fixer = typeof fixerBrief === 'string' ? await briefRole(event.sender.id, root, task, 'fixer', fixerBrief) : null;
    if (fixer && 'note' in fixer) return fixer;
    const now = Date.now();
    const carried = prior?.approvedScenarios ? { approvedScenarios: prior.approvedScenarios } : {};
    const base: StoredLoop = running ?? { kind: 'loop', testerSessionId: null, fixerSessionId: null, startedAt: now, stoppedAt: null, queue: [], events: prior?.kind === 'draft' ? prior.events : noEvents(), ...carried };
    let events = base.events;
    if (tester) events = withEvent(events, 'tester', startedWords(tester, agentName(names, 'tester')), now);
    if (fixer) events = withEvent(events, 'fixer', startedWords(fixer, agentName(names, 'fixer')), now);
    const loop: StoredLoop = { ...base, testerSessionId: tester?.agent.sessionId ?? base.testerSessionId, fixerSessionId: fixer?.agent.sessionId ?? base.fixerSessionId, events };
    saveLoop(root, task.id, loop);
    watchRoot(root);
    const view = loopView(root, loop, event.sender.id);
    return { tester: view.tester, fixer: view.fixer };
  });

  // Ask Claude to draw one up: the task's testing agent (its open one if any) on the testing-suite skill, checked first.
  handle('testing:agent-start', async (event, { tabId, root: picked, taskId, prompt }) => {
    const target = await taskTarget(event.sender.id, tabId, picked, taskId);
    if ('note' in target) return target;
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > BRIEF_CAP) return { note: 'The request is empty or too long.' };
    const { root, task } = target;
    const prior = loopsOf(root)[task.id];
    const tester = openAgent(testAgentsOf(root), task.id, 'tester');
    if (prior?.stoppedAt === null && prior.kind === 'loop') return { note: 'The test loop is running for this task. Stop it first.' };
    if (prior?.stoppedAt === null && tester && prior.testerSessionId === tester.sessionId) return { note: 'This task’s testing agent is already drawing up its suite.' };
    const skill = draftWithSkill(isSnapshotRun() ? testingFixture.claudeDir : allowedClaudeHome(), prompt.trim());
    prepareCriteria(root); // its scenarios and the bugs it finds go in the repo's criteria file
    const claim = await briefRole(event.sender.id, root, task, 'tester', skill.brief);
    if ('note' in claim) return claim;
    const name = agentName(store.load(root).agentNames ?? {}, 'tester');
    const now = Date.now();
    const words = claim.created ? `Started ${name} to draw up the suite` : `You → ${name} · draw up the suite`;
    saveLoop(root, task.id, {
      kind: 'draft', testerSessionId: claim.agent.sessionId, fixerSessionId: null, startedAt: now, stoppedAt: null, queue: [],
      events: withEvent(prior?.events ?? noEvents(), 'tester', words, now), ...(prior?.approvedScenarios ? { approvedScenarios: prior.approvedScenarios } : {}),
    });
    return { agent: agentView(root, claim.agent, event.sender.id), reused: !claim.created, updatedSkill: skill.updated };
  });

  // The lanes' read model. Main steps every queue itself, so a window only reads.
  handle('testing:loops', (event, { known }) => {
    if (!claudeFolderAllowed()) return { loops: [] };
    windowReady(event.sender.id);
    const asked = (Array.isArray(known) ? known.slice(0, KNOWN_CAP) : []).filter((k) => typeof k?.root === 'string' && projectRootOf(k.root) === k.root && isTaskId(k.taskId));
    const loops: LoopFacts[] = listedLoops(asked, event.sender.id).map((listed) => ({ ...listed, names: store.load(listed.root).agentNames ?? {} }));
    return { loops };
  });
}

// Acting on a task's agents once started: its bugs, its approved scenarios, stopping and closing.
export function registerLoopControlIpc({ taskTarget }: TestingIpcContext): void {
  // Send to bug fix agent: the failure joins the queue of the task's open bug fix agent (a stopped loop starts again
  // around it), else a bug fix agent starts on it. A running loop keeps its testing agent; a draft's becomes the loop's.
  handle('testing:send-bug', async (event, { tabId, root: picked, taskId, bug }) => {
    const target = await taskTarget(event.sender.id, tabId, picked, taskId);
    if ('note' in target) return target;
    const clean = cleanSentBug(bug);
    if (!clean) return { note: 'That failure can’t be sent.' };
    const { root, task } = target;
    const names = store.load(root).agentNames ?? {};
    const fixerName = agentName(names, 'fixer');
    const prior = loopsOf(root)[task.id];
    const running = isRunning(prior) ? prior : null;
    const now = Date.now();
    const agents = testAgentsOf(root);
    const fresh = (fixerSessionId: string): StoredLoop => loopForFixer(prior, agents, task.id, fixerSessionId, now);
    const open = openAgent(agents, task.id, 'fixer');
    if (open) {
      const base = running?.fixerSessionId === open.sessionId ? running : fresh(open.sessionId);
      const { queue, added } = addSent(base.queue, clean, now);
      const fixer = agentView(root, open, event.sender.id, names);
      if (!added) return { outcome: 'already' as const, fixer };
      saveLoop(root, task.id, { ...base, queue, events: withEvent(base.events, 'fixer', `You → ${fixerName} · ${clean.name}`, now) });
      watchRoot(root);
      return { outcome: 'queued' as const, fixer };
    }
    const brief = buildSentFixerBrief({ taskId: task.id, taskTitle: task.title, bugName: clean.name, prompt: clean.sent.failure, names: { tester: agentName(names, 'tester'), fixer: fixerName } });
    const claim = await claimAgent(root, { taskId: task.id, taskTitle: task.title, role: 'fixer', brief, preferred: event.sender.id });
    if ('note' in claim) return claim;
    const base = running ? { ...running, fixerSessionId: claim.agent.sessionId, queue: running.queue.map((b) => (b.state === 'fixing' ? { ...b, state: 'open' as const, asked: false } : b)) } : fresh(claim.agent.sessionId);
    const queue = addSent(base.queue, clean, now, 'fixing').queue; // its brief carries this bug
    saveLoop(root, task.id, { ...base, queue, events: withEvent(base.events, 'fixer', `Started ${fixerName} on ${clean.name}`, now) });
    watchRoot(root);
    return { outcome: 'started' as const, fixer: agentView(root, claim.agent, event.sender.id, names) };
  });

  // Looks right: the go-ahead goes to the task's testing agent, and the names she approved are saved with its loop.
  handle('testing:scenarios-approve', async (event, { root, taskId, names }) => {
    const loop = typeof root === 'string' && isTaskId(taskId) ? loopsOf(root)[taskId] : undefined;
    const found = agentAt(root, loop?.testerSessionId);
    if ('note' in found || !loop || typeof taskId !== 'string') return { note: 'Start the testing agent first.' };
    const approved = (Array.isArray(names) ? names : []).filter((n): n is string => typeof n === 'string' && n.length > 0).map((n) => n.slice(0, NAME_CAP)).slice(0, NAMES_CAP);
    if (!approved.length) return { note: 'There are no scenarios to approve.' };
    const name = agentName(store.load(found.root).agentNames ?? {}, 'tester');
    const sent = await sendToAgent(found.root, found.agent, scenariosApprovedText(suiteDir(suiteHome(found.root))), `You → ${name} · scenarios look right, write the tests`, event.sender.id);
    if ('note' in sent) return sent;
    const latest = loopsOf(found.root)[taskId] ?? loop;
    saveLoop(found.root, taskId, { ...latest, approvedScenarios: [...(latest.approvedScenarios ?? []), ...approved].slice(-ITEMS_CAP) });
    return sent;
  });

  // Stop: the queue stops stepping now; each running agent gets Esc, then the stop message once idle.
  handle('testing:loop-stop', (_event, { root, taskId }) => {
    if (!claudeFolderAllowed() || typeof root !== 'string' || projectRootOf(root) !== root || !isTaskId(taskId)) return { note: 'That loop isn’t one of this project’s.' };
    const problem = stopTaskLoop(root, taskId);
    return problem ? { note: problem } : { ok: true as const };
  });

  // Close agents: each open agent's claude through the Sessions panel's Close, its terminal closed, the loop stopped.
  handle('testing:close-agents', async (event, { tabId, root: picked, taskId }) => {
    const target = await taskTarget(event.sender.id, tabId, picked, taskId);
    if ('note' in target) return target;
    return closeTaskAgents(target.root, target.task.id);
  });
}
