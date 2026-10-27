// A task's two Testing agents as lanes: mirrors main's loops, pastes what main asks into its agent terminals, reports prompts.
import { atWork, createLoopStore } from './testing-agents-loops';
import { createShown, type AgentContext, type LaneNotes } from './testing-agents-shown';
import { createDraft } from './testing-agents-draft';
import { createRun } from './testing-agents-run';
import { createTerminals } from './testing-agents-terminals';
import { createChat } from './testing-agents-chat';
import { createLanes } from './testing-agents-lanes';
import { createWaitingScan } from './testing-agents-waiting';
import { listenToMain } from './testing-agents-listen';

export type { AgentLoop } from './testing-agents-loops';
export type { AgentContext } from './testing-agents-shown';

const TICK_MS = 1500; // main's loops are read this often, Testing open or not
const FIND_EVERY = 10; // with nothing at work, ask main for loops every 10th tick

export function createAgents(ctx: AgentContext) {
  const element = document.createElement('div');
  element.className = 'tst-agentsbox';
  const notes: LaneNotes = {};
  const store = createLoopStore(ctx.redraw);
  const shown = createShown(ctx, store.loops);
  const scanWaiting = createWaitingScan(store.loops, shown.nameOf, ctx.redraw);
  const draft = createDraft(ctx, shown, notes, tick);
  const run = createRun(ctx, shown, tick);
  const terminals = createTerminals(ctx, shown, { element, notes, draw, tick });
  const chat = createChat(shown, { notes, draw, tick });
  const lanes = createLanes(ctx, shown, { element, notes, terminals, chat, draft: draft.draft, estimate: run.estimate, tick });

  function draw(): void { lanes.draw(); }

  // Every tick: Needs you is read from this window's screens, then main's loops are read while one is at work.
  let ticks = 0;
  async function tick(): Promise<void> {
    ticks += 1;
    scanWaiting();
    if (ticks > 1 && ![...store.loops.values()].some(atWork) && ticks % FIND_EVERY) return;
    await store.read();
  }
  setInterval(() => void tick(), TICK_MS);
  listenToMain(ctx, { loops: store.loops, wantTerminal: terminals.want, readLoops: store.read });

  return {
    element, facts: shown.facts, refreshLogs: run.refreshLogs, adoptAll: store.adoptAll, start: run.start, stop: run.stop, sendToFixer: run.sendToFixer, draw,
    testerHost: (): string | null => shown.facts().record?.tester?.hostTabId ?? null,
    testerReplies: () => shown.repliesOf(shown.shownLoop(), 'tester'),
    draft: draft.draft, awaiting: shown.awaiting, editScenarios: draft.editScenarios, approveScenarios: draft.approveScenarios,
    testerNote: (): string => notes.tester ?? '',
    askAgain: draft.askAgain, askTester: run.askTester, checkDraft: draft.checkDraft, showTerminal: terminals.showTerminal, state: lanes.state,
  };
}

export type Agents = ReturnType<typeof createAgents>;
