// Testing journey (PASTEL_SNAPSHOT_MODE=testing-journey): her real path with the agents, fixture sessions only, never a
// real claude. Ask Claude starts the drafting agent in a terminal with no tab-bar entry, shown in its lane on Terminal;
// its terminal closes and the lane keeps its conversation and box; the window reloads and the lane comes back from the
// transcript; an unrelated tab reusing the old terminal id gets nothing; her message resumes the same session once (no
// second agent); bugs she sends go to the bug fix agent's terminal, never her session; a second window messages it
// through the first; Close agents closes both records and terminals.
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, Menu, type MenuItem } from 'electron';
import type { Kit } from './snapshot';
import { agentTerminals, closeExtraTabs, hostOf, petalFileOf, seedTestingProject } from './snapshot-testing';
import { assertFixtureOutsideClaude } from './snapshot-views';
import { extraTabFixtures, historyFixture, pasteWrites, testingFixture, type FixtureSession } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { testAgentsOf } from '../main/task-suites';
import * as store from '../main/testing-store';

const TASK = 't-journey';
const TESTER = 'c0ffee00-0000-4000-8000-0000000000a1';
const FIXER = 'c0ffee00-0000-4000-8000-0000000000f1';
const UNRELATED = 'c0ffee00-0000-4000-8000-0000000000e1'; // her own session in a tab that reuses an old terminal id
const SCENARIO = 'the settings page saves a new email';
const BUG = 'email field drops a plus sign';
const BUG_TWO = 'save button stays disabled';

const put = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// A task in the fixture repo, and no repo suite yet, for the drafting agent. Both kept in Petal's folder for the repo.
function seedJourneyTask(project: string): void {
  fs.rmSync(petalFileOf(project, 'suite.json'), { force: true });
  const file = petalFileOf(project, 'tasks.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { tasks: unknown[] };
  const task = { id: TASK, title: 'Account email', notes: 'Emails keep their plus signs.', status: 'working', owner: null, createdAt: Date.now() - 86_400_000, claimedAt: null, doneAt: null, doneBy: null, prdId: null, parentId: null };
  put(file, JSON.stringify({ ...data, tasks: [...data.tasks, task] }, null, 2));
}

const findMenuItem = (items: MenuItem[], label: string): MenuItem | null => {
  for (const item of items) {
    if (item.label === label) return item;
    const inner = item.submenu ? findMenuItem(item.submenu.items, label) : null;
    if (inner) return inner;
  }
  return null;
};

export async function testingJourneyCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} testing journey: ${what}`);
  const safeJs = async <T>(code: string): Promise<T | null> => { try { return await js(code) as T; } catch { return null; } }; // mid-reload a call can fail
  const { project, claudeDir } = seedTestingProject(outDir);
  seedJourneyTask(project);
  const dir = path.join(outDir, 'testing-fixture', 'journey');
  const logOf = (sessionId: string) => path.join(dir, `${sessionId}.jsonl`);
  const entry = (sessionId: string, fields: Record<string, unknown>) => `${JSON.stringify({ isSidechain: false, cwd: project, sessionId, timestamp: new Date().toISOString(), ...fields })}\n`;
  const say = (sessionId: string, uuid: string, prompt: string, text: string) => entry(sessionId, { type: 'user', uuid: `${uuid}-u`, message: { role: 'user', content: prompt } })
    + entry(sessionId, { type: 'assistant', uuid, message: { id: `msg-${uuid}`, role: 'assistant', content: [{ type: 'text', text }] } });
  const fixtureOf = (sessionId: string): FixtureSession => ({ sessionId, transcript: logOf(sessionId), status: 'idle', cwd: project });
  for (const id of [TESTER, FIXER, UNRELATED]) { assertFixtureOutsideClaude(logOf(id)); put(logOf(id), ''); }
  const record = (sessionId: string, title: string) => ({ sessionId, file: logOf(sessionId), cwd: project, title, firstPrompt: title, lastAt: Date.now(), messages: 2, messagesExact: true });
  const savedRecords = [...historyFixture.records];
  historyFixture.records.push(record(TESTER, 'Testing agent · Account email'), record(FIXER, 'Bug fix agent · Account email'));
  testingFixture.project = project;
  testingFixture.claudeDir = claudeDir;
  testingFixture.resumes.length = 0;
  const [startWidth, startHeight] = win.getContentSize();
  const startTabs: string[] = await js('PastelTerm.tabs.ids()');
  const stripCount = (): Promise<number> => js("document.querySelectorAll('#tab-strip [data-tab-id]').length");
  type Lane = { role: string; status: string; state: string | null; sessionId: string | null; hostTabId: string | null; terminal: string; mounted: string | null; canSend: boolean; placeholder: string; turns: number };
  const laneOf = async (role: string): Promise<Lane | null> => ((await safeJs<{ lanes: Lane[] }>('PastelTerm.testing.isOpen() ? PastelTerm.testing.state().agents : null'))?.lanes ?? []).find((l) => l.role === role) ?? null;
  const waitLane = (role: string, want: (l: Lane) => boolean, ms = 10000) => waitFor(async () => { const l = await laneOf(role); return l && want(l) ? l : null; }, ms);
  const openOnTask = async () => {
    await js("PastelTerm.testing.isOpen() || document.getElementById('testing-button').click()");
    await waitFor(() => safeJs<boolean>("Boolean(document.querySelector('#testing .tst-pickerbox .tst-task-select'))"), 8000);
    await js(`(() => { const s = document.querySelector('#testing .tst-pickerbox .tst-task-select'); s.value = 'task:${TASK}'; s.dispatchEvent(new Event('change')); })()`);
  };
  const message = (role: string, text: string) => js(`(() => { const lane = '#testing .tst-agent-lane[data-role="${role}"]'; const i = document.querySelector(lane + ' .tst-agent-input'); if (i) i.value = ${JSON.stringify(text)}; i?.dispatchEvent(new Event('input')); const form = document.querySelector(lane + ' .tst-agent-send'); form?.requestSubmit(); return Boolean(i && form); })()`) as Promise<boolean>;
  let second: BrowserWindow | null = null;
  let collisionTab: string | null = null;

  try {
    resizeOffscreen(win, 1280, 900);
    await js('PastelTerm.getStarted.close()');
    await js('PastelTerm.overlays.hideCurrent()');

    // 1 Ask Claude: the drafting agent starts in an agent terminal with no tab-bar entry; Terminal shows it in its lane.
    testingFixture.agentIds.splice(0, Infinity, TESTER);
    extraTabFixtures.push(fixtureOf(TESTER));
    const stripBefore = await stripCount();
    const startsBefore = testingFixture.loopStarts.length;
    await openOnTask();
    await waitFor(() => safeJs<boolean>("Boolean(document.querySelector('#testing .tst-ask-suite'))"), 8000);
    await js("document.querySelector('#testing .tst-ask-suite').click()");
    const started = await waitFor(() => testingFixture.loopStarts[startsBefore] ?? null, 6000);
    const firstHost = await waitFor(() => hostOf(win.webContents.id, project, TESTER), 10000);
    await waitFor(() => (firstHost && agentTerminals().includes(firstHost) ? true : null), 10000); // main counts it once its shell starts
    check(started?.command.includes(`--session-id ${TESTER} --`) && firstHost && agentTerminals().includes(firstHost) && (await stripCount()) === stripBefore, `the drafting agent starts in an agent terminal, no tab-bar entry: ${JSON.stringify({ host: firstHost, strip: [stripBefore, await stripCount()], started: started?.command.match(/&& .{0,80}/)?.[0] ?? null, starts: testingFixture.loopStarts.length - startsBefore, terminals: agentTerminals() })}`);
    fs.appendFileSync(logOf(TESTER), say(TESTER, 'j1', 'draw up the suite', 'Wrote the first scenario for **Account email**. It waits for your review.'));
    put(petalFileOf(project, 'criteria.md'), ['# Test criteria', '', '## Scenarios', `- [todo] ${SCENARIO} · task: ${TASK}`, '', '## Bugs', ''].join('\n'));
    const ready = await waitLane('tester', (l) => l.status === 'Scenarios ready' && l.turns > 0);
    check(ready && await js("Boolean(document.querySelector('#testing .tst-approve-scenarios'))"), `its lane shows the conversation and the scenario review: ${JSON.stringify(ready)}`);
    await js("document.querySelector('#testing .tst-agent-lane[data-role=\"tester\"] .tst-agent-terminal')?.click()");
    const mounted = await waitLane('tester', (l) => l.mounted === firstHost, 4000);
    check(mounted && await js("Boolean(document.querySelector('#testing .tst-agent-lane[data-role=\"tester\"] .tst-agent-term .term-host'))"), `Terminal mounts its live terminal in the lane: ${JSON.stringify(mounted)}`);
    await capture('testing-journey-terminal');

    // 1b Pop out puts its terminal in the tab bar; Back to lane returns it, off the tab bar, an agent terminal again in main.
    await js("document.querySelector('#testing .tst-agent-lane[data-role=\"tester\"] .tst-agent-popout')?.click()");
    const popped = await waitLane('tester', (l) => l.terminal === 'tab-bar', 4000);
    check(popped && (await stripCount()) === stripBefore + 1 && !agentTerminals().includes(firstHost ?? ''), `Pop out moves its terminal to the tab bar: ${JSON.stringify({ lane: popped?.terminal, strip: await stripCount() })}`);
    await openOnTask();
    await waitFor(() => safeJs<boolean>("Boolean(document.querySelector('#testing .tst-agent-lane[data-role=\"tester\"] .tst-agent-popin')) || null"), 4000);
    await js("document.querySelector('#testing .tst-agent-lane[data-role=\"tester\"] .tst-agent-popin')?.click()");
    const returned = await waitLane('tester', (l) => l.terminal === 'here' && l.mounted === firstHost, 4000);
    const counted = await waitFor(() => (agentTerminals().includes(firstHost ?? '') ? true : null), 4000);
    check(returned && counted && (await stripCount()) === stripBefore && await js("Boolean(document.querySelector('#testing .tst-agent-lane[data-role=\"tester\"] .tst-agent-term .term-host'))"), `Back to lane returns it to the lane, off the tab bar: ${JSON.stringify({ lane: returned?.terminal, mounted: returned?.mounted, strip: await stripCount(), agent: counted })}`);

    // 2 Its terminal closes: the agent reads ended, the lane keeps its conversation, and the box stays on.
    await js(`PastelTerm.tabs.requestClose(${JSON.stringify(firstHost)})`);
    const ended = await waitLane('tester', (l) => l.state === 'ended' && !agentTerminals().includes(firstHost ?? ''));
    check(ended && ended.canSend && ended.placeholder === 'Message Testing agent. Resumes its session' && ended.turns > 0 && ended.status === 'Scenarios ready', `closed, the lane is intact and its box on: ${JSON.stringify(ended)}`);
    check(testingFixture.resumes.length === 0, `closing its terminal resumes nothing by itself: ${JSON.stringify(testingFixture.resumes)}`);

    // 3 Reload, as a restart would: the lane comes back from main and the transcript, never blank.
    const loaded = new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()));
    win.webContents.reload();
    await loaded;
    check(await waitFor(() => safeJs<boolean>("typeof PastelTerm === 'object' && Boolean(PastelTerm.testing)"), 15000), 'the window reloads');
    await wait(1500); // the reloaded window's first tab and tick
    await js('PastelTerm.getStarted.close()');
    await js('PastelTerm.overlays.hideCurrent()');
    await openOnTask();
    const back = await waitLane('tester', (l) => l.state === 'ended' && l.turns > 0 && l.canSend, 15000);
    check(back && back.status === 'Scenarios ready' && back.sessionId === TESTER, `after the reload the lane has its conversation, its scenarios and its box: ${JSON.stringify(back)}`);
    await capture('testing-journey-reloaded');

    // 4 An unrelated tab reuses the old terminal id (as ids restart after a quit). Her message resumes the same session
    // once, in a new agent terminal, and nothing reaches the unrelated tab.
    extraTabFixtures.push(fixtureOf(UNRELATED));
    collisionTab = firstHost;
    await js(`void PastelTerm.tabs.create({ background: true, id: ${JSON.stringify(collisionTab)} })`); // a Tab can't cross IPC
    check(await waitFor(() => safeJs<boolean>(`PastelTerm.tabs.get(${JSON.stringify(collisionTab)})?.update?.sessionId === ${JSON.stringify(UNRELATED)} || null`), 10000), `an unrelated session's tab now has the old id ${collisionTab}`);
    extraTabFixtures.push(fixtureOf(TESTER));
    const pastesBefore = pasteWrites.length;
    const startsBeforeMessage = testingFixture.loopStarts.length;
    check(await message('tester', 'ping from the lane'), `the tester lane has its message box: ${JSON.stringify(await js("({ open: PastelTerm.testing.isOpen(), lanes: [...document.querySelectorAll('#testing .tst-agent-lane')].map((l) => l.dataset.role + ':' + l.querySelectorAll('textarea, form').length) })"))}`);
    const pinged = await waitFor(() => pasteWrites.slice(pastesBefore).find((w) => w.data.includes('ping from the lane')) ?? null, 15000);
    const newHost = hostOf(win.webContents.id, project, TESTER);
    await wait(1500);
    const resumes = testingFixture.resumes.filter((r) => r.sessionId === TESTER);
    check(resumes.length === 1 && resumes[0]?.command.includes(`--resume '${TESTER}'`) && testingFixture.loopStarts.length === startsBeforeMessage, `one resume of the same session, no new --session-id: ${JSON.stringify({ resumes, starts: testingFixture.loopStarts.length - startsBeforeMessage })}`);
    check(pinged && newHost && pinged.tabId === newHost && newHost !== collisionTab, `her message lands in the resumed terminal: ${JSON.stringify({ pasted: pinged?.tabId, newHost })}`);
    check(!pasteWrites.slice(pastesBefore).some((w) => w.tabId === collisionTab), 'nothing is pasted into the unrelated tab with the old id');
    const testers = testAgentsOf(project).filter((a) => a.taskId === TASK && a.role === 'tester');
    check(testers.length === 1 && testers[0]?.sessionId === TESTER, `still one testing agent for the task: ${JSON.stringify(testers.map((a) => a.sessionId))}`);

    // 5 A failing test sent to the bug fix agent (the results' Send to bug fix agent call): it starts on it in its own
    // terminal, and the next bug goes there once the first is fixed. Nothing reaches her session.
    testingFixture.agentIds.splice(0, Infinity, FIXER);
    extraTabFixtures.push(fixtureOf(FIXER));
    const fixPastes = pasteWrites.length;
    const send = (name: string) => js(`window.pastel.testing.sendBug({ tabId: ${JSON.stringify(startTabs[0])}, root: null, taskId: ${JSON.stringify(TASK)}, bug: ${JSON.stringify({ name, test: null, sent: { stage: 'Unit', failure: `${name}: expected true, got false` } })} })`) as Promise<{ outcome?: string; note?: string }>;
    const first = await send(BUG);
    const fixerStart = testingFixture.loopStarts.find((l) => l.command.includes(`--session-id ${FIXER} --`));
    const fixerHost = await waitFor(() => hostOf(win.webContents.id, project, FIXER), 10000);
    check(first.outcome === 'started' && fixerStart?.brief?.includes(BUG) && fixerHost && agentTerminals().includes(fixerHost), `the bug fix agent starts on the failure in its own terminal: ${JSON.stringify({ first, host: fixerHost })}`);
    const kept = store.load(project).loops?.[TASK];
    const testerLane = await waitLane('tester', (l) => l.sessionId === TESTER && l.turns > 0);
    check(kept?.kind === 'loop' && kept.testerSessionId === TESTER && testerLane, `the drafting agent stays on as the loop's testing agent, its lane intact: ${JSON.stringify({ tester: kept?.testerSessionId, lane: testerLane?.sessionId })}`);
    const next = await send(BUG_TWO);
    fs.appendFileSync(logOf(FIXER), say(FIXER, 'f1', `Bug: ${BUG}.`, `Kept the plus sign.\n\n**Fix:** ${BUG} · done`));
    const handed = await waitFor(() => pasteWrites.slice(fixPastes).find((w) => w.data.includes(`Bug: ${BUG_TWO}.`)) ?? null, 15000);
    check(next.outcome === 'queued' && handed?.tabId === fixerHost, `the next bug lands in the bug fix agent's terminal: ${JSON.stringify({ next, to: handed?.tabId })}`);
    check(!pasteWrites.slice(fixPastes).some((w) => (w.tabId === startTabs[0] || w.tabId === collisionTab) && (w.data.includes(BUG) || w.data.includes(BUG_TWO))), 'no bug reaches her session or the unrelated tab');

    // 6 A second window messages the bug fix agent: main pastes it in the first window's terminal, no "other window" note.
    const newWindow = findMenuItem(Menu.getApplicationMenu()?.items ?? [], 'New Window');
    const before = new Set(BrowserWindow.getAllWindows());
    newWindow?.click();
    second = await waitFor(() => BrowserWindow.getAllWindows().find((w) => !before.has(w)) ?? null, 8000);
    const jsIn = (target: BrowserWindow, code: string) => target.webContents.executeJavaScript(code).catch(() => null);
    check(second && await waitFor(async () => (second ? jsIn(second, "typeof PastelTerm === 'object' || null") : null), 15000), 'a second window opens');
    const elsewhere = second ? await jsIn(second, `window.pastel.testing.loops({ known: [{ root: ${JSON.stringify(project)}, taskId: ${JSON.stringify(TASK)} }] })`) as { loops?: { loop: { fixer: { hostElsewhere: boolean; hostTabId: string | null; note: string | null } | null } }[] } | null : null;
    const seen = elsewhere?.loops?.[0]?.loop.fixer ?? null;
    check(seen?.hostElsewhere && seen.hostTabId === null && seen.note === null, `the second window sees the agent running in the first: ${JSON.stringify(seen)}`);
    const fromB = pasteWrites.length;
    const sent = second ? await jsIn(second, `window.pastel.testing.agentSend({ root: ${JSON.stringify(project)}, sessionId: ${JSON.stringify(FIXER)}, text: 'from the second window' })`) as { outcome?: string; note?: string } | null : null;
    const landed = await waitFor(() => pasteWrites.slice(fromB).find((w) => w.data.includes('from the second window')) ?? null, 10000);
    check(sent && !sent.note && landed?.tabId === fixerHost, `its message lands in the first window's terminal: ${JSON.stringify({ sent, to: landed?.tabId })}`);
    second?.close();
    check(await waitFor(() => (second?.isDestroyed() ? true : null), 8000), 'the second window closes');

    // 7 Close agents: both records closed, both terminals gone, the tab bar as it was.
    await js(`PastelTerm.tabs.requestClose(${JSON.stringify(collisionTab)})`);
    await openOnTask();
    const offered = await waitFor(() => safeJs<boolean>("Boolean(document.querySelector('#testing .tst-close-agents-button')) || null"), 10000);
    await js("document.querySelector('#testing .tst-close-agents-button')?.click()");
    await waitFor(() => safeJs<boolean>("Boolean(document.querySelector('#testing .tst-close-yes')) || null"), 3000);
    await js("document.querySelector('#testing .tst-close-yes')?.click()");
    const closed = await waitFor(() => { const open = testAgentsOf(project).filter((a) => a.taskId === TASK && a.closedAt === null); return open.length === 0 && !agentTerminals().length ? true : null; }, 10000);
    check(offered && closed && (await stripCount()) === stripBefore, `Close agents closes both records and terminals: ${JSON.stringify({ open: testAgentsOf(project).filter((a) => a.closedAt === null).map((a) => a.role), terminals: agentTerminals() })}`);
    const lanes = await waitLane('fixer', (l) => l.status === 'Closed' && !l.canSend, 6000);
    check(lanes && store.load(project).loops?.[TASK]?.stoppedAt, `the lanes read Closed and the loop is saved stopped: ${JSON.stringify(lanes)}`);
    await capture('testing-journey-closed');
  } finally {
    if (second && !second.isDestroyed()) second.close();
    await js('PastelTerm.testing.close()').catch(() => null);
    extraTabFixtures.length = 0;
    testingFixture.agentIds.length = 0;
    testingFixture.resumes.length = 0;
    historyFixture.records.splice(0, Infinity, ...savedRecords);
    check(await closeExtraTabs(kit, startTabs), `the journey's terminals and tabs close again: ${JSON.stringify(await js('PastelTerm.tabs.ids()'))}`);
    await js(`PastelTerm.tabs.activate(${JSON.stringify(startTabs[0])})`);
    testingFixture.project = null;
    testingFixture.claudeDir = null;
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
