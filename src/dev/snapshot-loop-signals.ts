// Loop signals (PASTEL_SNAPSHOT_MODE=loop-signals): fixture project and fixture agent tabs only, never a real claude.
// 1. A loop started with Testing closed: main steps its bug queue and saves it. (Reload and restart are the journey's.)
// 2. One bug fix agent per task: a second is refused, a bug she sends joins the saved queue once and survives main's
//    next saves, and no new agent starts for it.
// 3. A prompt on the bug fix agent's screen: Needs you on its lane with Show terminal (its terminal mounts in the lane),
//    a dot on the dock's Testing button, a recorded notification (never shown); a fix landing records one too.
// 4. Two tasks in one repo run at once; the same task stays one at a time.
// 5. A stage log over 2 MB is read from its tail and says so.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { FIXER_SESSION, FIXTURE_TASK, endLoop, seedTestingProject, useAgentFixtures } from './snapshot-testing';
import { CRITERIA_FIXTURE } from './snapshot-test-loop';
import { resizeOffscreen } from '../main/snapshot-window';
import { pasteWrites, testingFixture } from '../main/snapshot-mode';
import { syncSuites } from '../main/task-suites';
import { loadTasks } from '../main/tasks-store';
import { LOG_TAIL_BYTES, trimmedNote } from '../main/testing-runner';
import * as store from '../main/testing-store';
import * as configStore from '../main/config-store';
import type { StoredLoop } from '../shared/testing';

const OTHER_TASK = 't-checkout';
// A permission prompt on the agent's screen, as Claude Code draws it.
const ASK_SCREEN = ['─'.repeat(40), ' Bash command', '', '   npm test', '', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', '', ' Esc to cancel · Tab to amend'];
const put = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// A second task in the fixture repo, with its own one-stage suite.
function seedOtherTask(project: string): void {
  const file = path.join(project, '.petal', 'tasks.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { tasks: unknown[] };
  const task = { id: OTHER_TASK, title: 'Checkout totals', notes: '', status: 'working', owner: null, createdAt: Date.now() - 86_400_000, claimedAt: null, doneAt: null, doneBy: null, prdId: null, parentId: null };
  put(file, JSON.stringify({ ...data, tasks: [...data.tasks, task] }, null, 2));
  put(path.join(project, '.petal', 'suites', `${OTHER_TASK}.json`), JSON.stringify({ stages: [{ name: 'Unit', command: 'npm test' }], keepGoing: false, autoRun: false }, null, 2));
}

export async function loopSignalsCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} loop signals: ${what}`);
  const { project, claudeDir } = seedTestingProject(outDir);
  seedOtherTask(project);
  syncSuites(project, loadTasks(project).tasks); // Petal sees both suite files before any agent exists, as her first open of Testing would
  testingFixture.project = project;
  testingFixture.claudeDir = claudeDir;
  testingFixture.loopStarts.length = 0;
  testingFixture.runs.length = 0;
  testingFixture.notices.length = 0;
  const { fixerLog } = useAgentFixtures(outDir);
  await js('PastelTerm.getStarted.close()');
  await js('PastelTerm.overlays.hideCurrent()');
  const [startWidth, startHeight] = win.getContentSize();
  const startTabs = await js('PastelTerm.tabs.ids()') as string[];
  const fixtureTab = startTabs[0];
  const savedLoop = (taskId = FIXTURE_TASK): StoredLoop | undefined => store.load(project).loops?.[taskId];
  try {
    resizeOffscreen(win, 1280, 900);
    check(await waitFor(async () => (await js(`PastelTerm.tabs.get(${JSON.stringify(fixtureTab)})?.update?.state`)) === 'live' || null, 15000), 'the fixture tab follows its Claude session');

    // 1. Start both agents; main hands the bug out with Testing closed.
    const started = await js(`window.pastel.testing.loopStart({ tabId: ${JSON.stringify(fixtureTab)}, root: null, taskId: ${JSON.stringify(FIXTURE_TASK)}, testerBrief: 'Snapshot testing agent brief.', fixerBrief: 'Snapshot bug fix agent brief.' })`) as { tester?: { hostTabId: string | null }; fixer?: { hostTabId: string | null }; note?: string };
    const fixerTab = started.fixer?.hostTabId ?? null;
    check(fixerTab && started.tester?.hostTabId && testingFixture.loopStarts.length === 2, `both agents start in fixture tabs: ${JSON.stringify(started)}`);
    check(await waitFor(async () => (await js(`PastelTerm.tabs.get(${JSON.stringify(fixerTab)})?.update?.sessionId`)) === FIXER_SESSION || null, 10000), 'the bug fix agent tab follows its fixture session');
    const pastesBefore = pasteWrites.length;
    put(path.join(project, '.petal', 'test-criteria.md'), CRITERIA_FIXTURE);
    const handed = await waitFor(() => pasteWrites.slice(pastesBefore).find((w) => w.tabId === fixerTab && w.data.includes('Bug: ')) ?? null, 25000);
    check(handed, `main hands a bug to the bug fix agent with Testing closed: ${JSON.stringify(handed?.data.slice(0, 80))}`);
    const fixing = await waitFor(() => savedLoop()?.queue.find((b) => b.state === 'fixing') ?? null, 6000);
    check(fixing, `and saves the queue: ${JSON.stringify(savedLoop()?.queue.map((b) => [b.name, b.state]))}`);

    // 2. One bug fix agent per task; a bug she sends joins the saved queue.
    const startsBefore = testingFixture.loopStarts.length;
    const second = await js(`window.pastel.testing.loopStart({ tabId: ${JSON.stringify(fixtureTab)}, root: null, taskId: ${JSON.stringify(FIXTURE_TASK)}, fixerBrief: 'Another bug fix agent.' })`) as { note?: string };
    check(/already running for this task/.test(second.note ?? '') && testingFixture.loopStarts.length === startsBefore, `a second bug fix agent is refused: ${JSON.stringify(second)}`);
    const sent = { name: 'cart badge shows a stale count', test: null, sent: { stage: 'Unit', failure: 'expected 2, got 3' } };
    const added = await js(`window.pastel.testing.sendBug({ tabId: ${JSON.stringify(fixtureTab)}, root: null, taskId: ${JSON.stringify(FIXTURE_TASK)}, bug: ${JSON.stringify(sent)} })`) as { outcome?: string };
    check(added.outcome === 'queued' && testingFixture.loopStarts.length === startsBefore, `a bug she sends joins the saved queue, no new agent: ${JSON.stringify(added)}`);
    await wait(4000); // a few of main's steps and saves
    check(savedLoop()?.queue.some((b) => b.name === sent.name), `main's next saves keep it: ${JSON.stringify(savedLoop()?.queue.map((b) => [b.name, b.state]))}`);
    const again = await js(`window.pastel.testing.sendBug({ tabId: ${JSON.stringify(fixtureTab)}, root: null, taskId: ${JSON.stringify(FIXTURE_TASK)}, bug: ${JSON.stringify(sent)} })`) as { outcome?: string };
    check(again.outcome === 'already', `sent twice, it is added once: ${JSON.stringify(again)}`);

    // 3. A permission prompt on the bug fix agent's screen: badge, notification, Needs you with Show terminal.
    const drawIn = (tabId: string | null, text: string) => js(`new Promise((done) => PastelTerm.tabs.get(${JSON.stringify(tabId)}).term.write(${JSON.stringify(text)}, done))`);
    await drawIn(fixerTab, `\x1b[2J\x1b[H${ASK_SCREEN.join('\r\n')}`);
    const badge = await waitFor(async () => (await js("(() => { const d = document.querySelector('#testing-button .dock-badge'); return d && !d.hidden ? document.getElementById('testing-button').dataset.needsYou : null; })()")) as string | null, 5000);
    check(badge === '1', `the dock's Testing button shows a dot while the agent waits: ${JSON.stringify(badge)}`);
    const asked = await waitFor(() => testingFixture.notices.find((n) => n.title === 'Bug fix agent needs you') ?? null, 4000);
    check(asked && asked.tabId === fixerTab && testingFixture.notices.filter((n) => n.title === asked.title).length === 1, `one needs-you notification, recorded not shown: ${JSON.stringify(testingFixture.notices)}`);
    await js(`PastelTerm.tabs.activate(${JSON.stringify(fixtureTab)})`);
    await js("document.getElementById('testing-button').click()");
    const lanes = await waitFor(async () => {
      const l = await js("PastelTerm.testing.state().agents.lanes.map((x) => [x.role, x.status])") as string[][];
      return l.some(([role, status]) => role === 'fixer' && status === 'Needs you') ? l : null;
    }, 8000);
    const show = await waitFor(() => js("document.querySelector('#testing .tst-agent-lane.is-fixer.is-needs-you .tst-agent-show')?.textContent ?? null"), 4000);
    check(lanes && show === 'Show terminal', `the bug fix agent's lane reads Needs you with Show terminal: ${JSON.stringify({ lanes, show })}`);
    await capture('loop-signals-needs-you');
    await js("document.querySelector('#testing .tst-agent-lane.is-fixer .tst-agent-show')?.click()");
    const mounted = await waitFor(() => js(`(() => { const lane = PastelTerm.testing.state().agents.lanes.find((l) => l.role === 'fixer'); const box = document.querySelector('#testing .tst-agent-lane.is-fixer .tst-agent-term'); return lane?.mounted === ${JSON.stringify(fixerTab)} && box?.querySelector('.term-host') ? lane.mounted : null; })()`), 3000);
    check(mounted && !((await js('PastelTerm.tabs.ids()')) as string[]).includes(fixerTab ?? ''), `Show terminal mounts its terminal in the lane, with no tab-bar entry: ${JSON.stringify(mounted)}`);
    await drawIn(fixerTab, '\x1b[2J\x1b[H');
    check(await waitFor(async () => ((await js("document.querySelector('#testing-button .dock-badge')?.hidden")) ? true : null), 5000), 'the dot goes once the prompt leaves the screen');

    // A fix lands: recorded as a notification once.
    const name = await waitFor(() => savedLoop()?.queue.find((b) => b.state === 'fixing')?.name ?? null, 6000) ?? '';
    const line = (fields: Record<string, unknown>) => `${JSON.stringify({ isSidechain: false, timestamp: new Date().toISOString(), sessionId: FIXER_SESSION, ...fields })}\n`;
    fs.appendFileSync(fixerLog, line({ type: 'user', uuid: 'sig-u1', message: { role: 'user', content: `Bug: ${name}.` } })
      + line({ type: 'assistant', uuid: 'sig-a1', message: { role: 'assistant', content: [{ type: 'text', text: `Fixed it.\n\n**Fix:** ${name} · done` }] } }));
    const fixed = await waitFor(() => testingFixture.notices.find((n) => n.title === 'Bug fix agent fixed a bug') ?? null, 10000);
    check(name && fixed && fixed.body === `${name} · awaiting verify`, `a fix landing records a notification: ${JSON.stringify(fixed)}`);
    await js('PastelTerm.overlays.hideCurrent()');

    // 4. Two tasks in one repo run at once; the same task stays one at a time.
    const run = (taskId: string) => js(`window.pastel.testing.run({ tabId: ${JSON.stringify(fixtureTab)}, root: null, taskId: ${JSON.stringify(taskId)}, confirmed: true })`) as Promise<{ started?: string; note?: string }>;
    const first = await run(FIXTURE_TASK);
    const twice = await run(FIXTURE_TASK);
    const beside = await run(OTHER_TASK);
    check(first.started && twice.note === 'A run is still going for this task.' && beside.started, `another task runs beside it, the same task waits: ${JSON.stringify({ first, twice, beside })}`);
    const history = await js(`window.pastel.testing.history(${JSON.stringify(fixtureTab)})`) as { running?: string[] };
    check(JSON.stringify([...(history.running ?? [])].sort()) === JSON.stringify([first.started, beside.started].sort()), `both runs show as going: ${JSON.stringify(history.running)}`);

    // 5. The other task's Unit stage writes over 2 MB and fails: only the tail is read, and the output says so.
    const big = testingFixture.runs.find((r) => r.runId === beside.started);
    const mine = testingFixture.runs.find((r) => r.runId === first.started);
    if (big) {
      const filler = `${'x'.repeat(99)}\n`.repeat(Math.ceil((LOG_TAIL_BYTES * 1.25) / 100));
      put(big.stages[0].log, `${filler} FAIL src/cart.test.ts > totals > rounds per line\n Test Files  1 failed (1)\n      Tests  1 failed | 3 passed (4)\n`);
      put(big.stages[0].exit, '1\n');
      put(path.join(big.dir, 'done'), '1\n');
    }
    if (mine) { for (const s of mine.stages) put(s.exit, '0\n'); put(path.join(mine.dir, 'done'), '0\n'); }
    const trimmed = await waitFor(() => store.load(project).runs.find((r) => r.id === beside.started && r.state !== 'running') ?? null, 8000);
    const unit = trimmed?.stages[0];
    check(unit?.status === 'failed' && unit.output.startsWith(trimmedNote()) && unit.output.length < 6000, `a huge log is read from its last 2 MB: ${JSON.stringify(unit && { status: unit.status, head: unit.output.slice(0, 60), length: unit.output.length })}`);

    // The Notifications switch in Customize › Sessions: on by default; off, testing:notify records nothing.
    await js("PastelTerm.customize.open('sessions')");
    const toggle = await waitFor(() => js("(() => { const b = document.querySelector('#customize-body .cz-testing-notify'); return b ? { checked: b.checked, label: b.closest('label')?.textContent ?? '' } : null; })()"), 5000) as { checked: boolean; label: string } | null;
    check(toggle?.checked === true && toggle.label.includes('Notify me when a testing agent needs me, a fix lands or a loop finishes') && configStore.load().testing.notify, `the notifications switch shows, on by default: ${JSON.stringify(toggle)}`);
    await js("document.querySelector('#customize-body .cz-testing-notify').click()");
    const off = await waitFor(() => (configStore.load().testing.notify ? null : true), 4000);
    testingFixture.notices.length = 0;
    await js("window.pastel.testing.notify({ title: 'Test loop finished', body: '1 verified · 0 still open', tabId: null })");
    check(off && testingFixture.notices.length === 0, `switched off, no notification is recorded: ${JSON.stringify(testingFixture.notices)}`);
    configStore.save({ testing: { notify: true } });
    await js("window.pastel.testing.notify({ title: 'Test loop finished', body: '1 verified · 0 still open', tabId: null })");
    check(testingFixture.notices.length === 1, `switched back on, it is recorded again: ${testingFixture.notices.length}`);
  } finally {
    configStore.save({ testing: { notify: true } });
    testingFixture.project = null;
    testingFixture.claudeDir = null;
    testingFixture.agentIds.length = 0;
    testingFixture.notices.length = 0;
    await js('PastelTerm.overlays.hideCurrent()');
    await js(`PastelTerm.tabs.activate(${JSON.stringify(fixtureTab)})`);
    check(await endLoop(kit, startTabs), `the agent and run tabs close again: ${JSON.stringify(await js('PastelTerm.tabs.ids()'))}`);
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
