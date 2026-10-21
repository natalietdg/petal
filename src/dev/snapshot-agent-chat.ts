// Agent chat: a bug fix agent whose loop still runs is resumed at launch into an agent terminal nobody mounted. Her
// lane message shows at once as Working…, the agent's reply replaces it when it lands, and the newest turn stays in
// view below a long earlier turn across redraws. Fixture sessions only, never a real claude.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { FIXTURE_TASK, closeExtraTabs, hostOf, seedTestingProject } from './snapshot-testing';
import { assertFixtureOutsideClaude } from './snapshot-views';
import { extraTabFixtures, historyFixture, pasteWrites, testingFixture } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { saveLoop, saveTestAgents, testingData } from '../main/task-suites';
import { watchRoot } from '../main/test-agents';
import { noEvents } from '../shared/agent-loop';

const FIXER = 'c0ffee00-0000-4000-8000-0000000000c1';
const SENT = 'dso can u fix?';
const ANSWER = 'No. The last failing test needs a change to the test itself.';

// Where the fixer lane's conversation is scrolled, and what its newest turn says.
const LIST_PROBE = `(() => {
  const list = document.querySelector('#testing .tst-agent-turns[data-role="fixer"]');
  const last = list?.lastElementChild;
  if (!list || !last) return null;
  const box = list.getBoundingClientRect(), item = last.getBoundingClientRect();
  return { scrollable: list.scrollHeight > list.clientHeight + 8, newestInView: item.bottom <= box.bottom + 1 && item.bottom > box.top, working: Boolean(last.querySelector('.tst-agent-working')), text: last.textContent.slice(0, 160) };
})()`;

type Lane = { role: string; sessionId: string | null; hostTabId: string | null; mounted: string | null; state: string | null; turns: number; lastTurn: { prompt: string; markdown: string; working?: boolean } | null };
type ListView = { scrollable: boolean; newestInView: boolean; working: boolean; text: string };

export async function agentChatCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} agent chat: ${what}`);
  const { project, claudeDir } = seedTestingProject(outDir);
  const transcript = path.join(outDir, 'testing-fixture', 'agent-chat', `${FIXER}.jsonl`);
  assertFixtureOutsideClaude(transcript);
  const entry = (fields: Record<string, unknown>, at = Date.now()) => `${JSON.stringify({ isSidechain: false, cwd: project, sessionId: FIXER, timestamp: new Date(at).toISOString(), ...fields })}\n`;
  const say = (uuid: string, prompt: string, text: string, at = Date.now()) => entry({ type: 'user', uuid: `${uuid}-u`, message: { role: 'user', content: prompt } }, at)
    + entry({ type: 'assistant', uuid, message: { id: `msg-${uuid}`, role: 'assistant', content: [{ type: 'text', text }] } }, at + 1000);
  const startedAt = Date.now() - 2 * 86_400_000;
  const longReply = Array.from({ length: 47 }, (_, i) => `Line ${i + 1} of the status the agent gave two days ago.`).join('\n\n');
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  fs.writeFileSync(transcript, say('brief', `You are Bug fix agent, the bug fix agent for the task "Settings screen". ${'Fix what fails. '.repeat(40)}`, longReply, startedAt + 60_000));
  const savedRecords = [...historyFixture.records];
  historyFixture.records.push({ sessionId: FIXER, file: transcript, cwd: project, title: 'Bug fix agent · Settings screen', firstPrompt: 'You are Bug fix agent', lastAt: Date.now(), messages: 2, messagesExact: true });
  testingFixture.project = project;
  testingFixture.claudeDir = claudeDir;
  testingFixture.resumes.length = 0;
  extraTabFixtures.push({ sessionId: FIXER, transcript, status: 'idle', cwd: project });
  const earlier = (testingData(project).testAgents ?? []).map((a) => (a.taskId === FIXTURE_TASK && a.closedAt === null ? { ...a, closedAt: Date.now() } : a)); // an earlier step's agents
  saveTestAgents(project, [...earlier, { sessionId: FIXER, taskId: FIXTURE_TASK, role: 'fixer', cwd: project, startedAt, closedAt: null }]);
  saveLoop(project, FIXTURE_TASK, { kind: 'loop', testerSessionId: null, fixerSessionId: FIXER, startedAt, stoppedAt: null, queue: [], events: noEvents() });
  const [startWidth, startHeight] = win.getContentSize();
  const startTabs = await js('PastelTerm.tabs.ids()') as string[];
  const fixerLane = async (): Promise<Lane | null> => ((await js("PastelTerm.testing.isOpen() ? PastelTerm.testing.state().agents.lanes : []")) as Lane[]).find((l) => l.role === 'fixer') ?? null;
  const waitLane = (want: (l: Lane) => boolean, ms = 10000) => waitFor(async () => { const l = await fixerLane(); return l && want(l) ? l : null; }, ms);
  const listView = (): Promise<ListView | null> => js(LIST_PROBE);

  try {
    resizeOffscreen(win, 1280, 900);
    await js('PastelTerm.getStarted.close()');
    await js('PastelTerm.overlays.hideCurrent()');
    await js(`PastelTerm.tabs.activate(${JSON.stringify(startTabs[0])})`); // the fixture session's tab holds the task

    // Launch: main resumes the running loop's bug fix agent by itself, into an agent terminal no lane mounted.
    watchRoot(project);
    const resumed = await waitFor(() => testingFixture.resumes.find((r) => r.sessionId === FIXER) ?? null, 15000);
    const host = await waitFor(() => hostOf(win.webContents.id, project, FIXER), 10000);
    check(resumed?.command.includes(`--resume '${FIXER}'`) && host, `the running loop's bug fix agent is resumed at launch: ${JSON.stringify({ resumed: resumed?.command.slice(-80), host })}`);
    await js("PastelTerm.testing.isOpen() || document.getElementById('testing-button').click()");
    const shown = await waitLane((l) => l.sessionId === FIXER && l.hostTabId === host && l.mounted === null && l.turns > 0);
    check(shown, `its lane shows its conversation with the terminal unmounted: ${JSON.stringify(shown ?? await fixerLane())}`);
    const before = await waitFor(async () => { const v = await listView(); return v?.scrollable && v.newestInView ? v : null; }, 4000);
    check(before, `a long earlier turn leaves the newest one in view: ${JSON.stringify(before ?? await listView())}`);

    // Send: her message shows at once as Working…, before the transcript has it.
    const pastes = pasteWrites.length;
    await js(`(() => { const lane = '#testing .tst-agent-lane[data-role="fixer"]'; const i = document.querySelector(lane + ' .tst-agent-input'); i.value = ${JSON.stringify(SENT)}; i.dispatchEvent(new Event('input')); document.querySelector(lane + ' .tst-agent-send').requestSubmit(); })()`);
    const pending = await waitLane((l) => l.lastTurn?.prompt === SENT && l.lastTurn.working === true, 1000);
    const pendingView = await listView();
    check(pending && pendingView?.working && pendingView.newestInView && pendingView.text.includes(SENT), `her message shows at once, Working…, in view: ${JSON.stringify({ lane: pending?.lastTurn ?? null, view: pendingView })}`);
    const pasted = await waitFor(() => pasteWrites.slice(pastes).find((w) => w.data.includes(SENT)) ?? null, 10000);
    check(pasted?.tabId === host, `it is pasted into the agent's own terminal: ${JSON.stringify({ to: pasted?.tabId, host })}`);
    await wait(4500); // a Testing poll redraws the lane; the pending turn and the scroll survive it
    const held = await listView();
    check(held?.working && held.newestInView, `a redraw keeps it Working… and in view: ${JSON.stringify(held)}`);
    await capture('agent-chat-pending');

    // The agent's reply lands in its transcript: the Working… turn becomes her message with the reply, still in view.
    fs.appendFileSync(transcript, say('answer', SENT, ANSWER));
    const answered = await waitLane((l) => Boolean(l.lastTurn?.markdown.includes(ANSWER) && !l.lastTurn.working && l.lastTurn.prompt === SENT));
    const answeredView = await waitFor(async () => { const v = await listView(); return v?.newestInView && !v.working && v.text.includes(ANSWER) ? v : null; }, 6000);
    check(answered && answeredView, `the reply replaces Working… and stays in view: ${JSON.stringify({ lane: answered?.lastTurn ?? (await fixerLane())?.lastTurn, view: answeredView ?? await listView() })}`);
    await capture('agent-chat-answered');
  } finally {
    const loop = testingData(project).loops?.[FIXTURE_TASK];
    if (loop) saveLoop(project, FIXTURE_TASK, { ...loop, stoppedAt: Date.now() }); // main stops stepping it
    await js('PastelTerm.testing.close()').catch(() => null);
    extraTabFixtures.length = 0;
    testingFixture.resumes.length = 0;
    historyFixture.records.splice(0, Infinity, ...savedRecords);
    check(await closeExtraTabs(kit, startTabs), `its agent terminal closes again: ${JSON.stringify(await js('PastelTerm.tabs.ids()'))}`);
    await js(`PastelTerm.tabs.activate(${JSON.stringify(startTabs[0])})`);
    testingFixture.project = null;
    testingFixture.claudeDir = null;
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
