// PRDs and per-task suites (PASTEL_SNAPSHOT_MODE=prd-tasks): a version 1 tasks.json read and written back as 2,
// a PRD made on the Board grouping two tasks, one task split into subtasks, then Testing opened from the session that
// holds a task: that task's own suite, another task's different stages a pick away, a subtask running its task's suite,
// the PRD's overview of both, the coding session's suite write refused, and a task with no suite starting its testing
// agent, whose write is taken with Undo. Never runs a command.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit, TabsDeps } from './snapshot';
import { extraTabFixtures, folderFixture, panelFixture, testingFixture } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import * as store from '../main/testing-store';
import { assertFixtureOutsideClaude } from './snapshot-views';
import type { PipelineRun, RunState } from '../shared/testing';

const SESSION = '7a5c0000-0000-4000-8000-0000000000d1';
const HOUR = 60 * 60_000;

const put = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

function writeTranscript(file: string, cwd: string, sessionId = SESSION): void {
  assertFixtureOutsideClaude(file);
  const at = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const entry = (fields: Record<string, unknown>) => JSON.stringify({ isSidechain: false, cwd, sessionId, ...fields });
  put(file, `${entry({ type: 'user', uuid: 'prd-u0', timestamp: at(10), message: { role: 'user', content: 'fix the cart total rounding' } })}\n${entry({ type: 'assistant', uuid: 'prd-a0', timestamp: at(9), message: { role: 'assistant', content: [{ type: 'text', text: '**Looking at the cart.**' }] } })}\n`);
}

// A version 1 file: the fixture session holds "Fix the cart total".
function writeTasksV1(repo: string): void {
  const owner = { sessionId: SESSION, name: 'Cart work', branch: 'main' };
  const task = (id: string, title: string, held = false) => ({ id, title, notes: '', status: held ? 'claimed' : 'open', owner: held ? owner : null, createdAt: Date.now() - 3 * HOUR, claimedAt: held ? Date.now() - 2 * HOUR : null, doneAt: null, doneBy: null });
  put(path.join(repo, '.petal', '.gitignore'), '*\n');
  put(path.join(repo, '.petal', 'tasks.json'), JSON.stringify({ version: 1, tasks: [task('t-cart', 'Fix the cart total', true), task('t-coupon', 'Coupons'), task('t-docs', 'Document the cart API')] }, null, 2));
}

// Each PRD task's own suite, as Petal writes the file.
function writeSuite(repo: string, taskId: string, stages: [string, string][]): void {
  put(path.join(repo, '.petal', 'suites', `${taskId}.json`), `${JSON.stringify({ stages: stages.map(([name, command]) => ({ name, command })), keepGoing: false, autoRun: false }, null, 2)}\n`);
}

// A session writing a file (a task's suite, a test), as its log records it.
function appendSuiteWrite(file: string, sessionId: string, uuid: string, cwd: string, target: string): void {
  assertFixtureOutsideClaude(file);
  const at = new Date().toISOString();
  fs.appendFileSync(file, `${JSON.stringify({ isSidechain: false, cwd, sessionId, type: 'assistant', uuid, timestamp: at, message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${uuid}`, name: 'Write', input: { file_path: target, content: '{}' } }] } })}\n`);
}

function run(id: string, minutesAgo: number, state: RunState, taskId: string | null): PipelineRun {
  const failed = state === 'failed' ? 1 : 0;
  const counts = { passed: 4, failed, skipped: 0 };
  const startedAt = Date.now() - minutesAgo * 60_000;
  return {
    id, by: 'you', trigger: 'click', startedAt, finishedAt: startedAt + 5000, state, totals: counts,
    stages: [{ stageId: 'unit', name: 'Unit', command: 'npm test', status: state === 'passed' ? 'passed' : 'failed', exitCode: failed, durationMs: 5000, counts, tests: [], output: '', runner: 'vitest' }],
    ...(taskId ? { taskId } : {}),
  };
}

export async function prdTasksCheck(kit: Kit, { win, openTab }: Pick<TabsDeps, 'openTab'> & { win: BrowserWindow }): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} prd tasks: ${what}`);
  const dir = path.join(outDir, 'prd-tasks');
  const repo = path.join(dir, 'repos', 'shop');
  const tasksJson = path.join(repo, '.petal', 'tasks.json');
  const transcript = path.join(dir, 'tabs', `${SESSION}.jsonl`);
  const saved = { panel: panelFixture.sessions, home: folderFixture.home, project: testingFixture.project, claudeDir: testingFixture.claudeDir };
  const [startWidth, startHeight] = win.getContentSize();
  const startTabs: string[] = await js('PastelTerm.tabs.ids()');
  const settle = () => wait(250);
  const type = (selector: string, value: string) => js(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const submit = async (selector: string) => { await js(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`); await settle(); };
  const pickPrd = (taskId: string, prdId: string) => js(`(() => { const s = document.querySelector('#board .task-row[data-task-id="${taskId}"] .task-prd'); s.value = ${JSON.stringify(prdId)}; s.dispatchEvent(new Event('change')); })()`);
  const groups = (): Promise<{ prd: string | null; rows: string[]; subtasks: string[] }[]> => js(`[...document.querySelectorAll('#board .prd-group')].map((g) => ({
    prd: g.querySelector('.prd-title')?.textContent ?? null,
    rows: [...g.querySelectorAll('.task-row:not(.is-subtask) .task-title')].map((t) => t.textContent),
    subtasks: [...g.querySelectorAll('.task-row.is-subtask .task-title')].map((t) => t.textContent),
  }))`);
  type TestingState = { task: string | null; head: string; stages: string[]; taskRuns: number; target: { kind: string; id: string } | null; suiteChange: boolean; suiteProblem: string | null };
  const testing = (): Promise<TestingState | null> => js("PastelTerm.testing.isOpen() ? PastelTerm.testing.state() : null");
  const pickTarget = (value: string) => js(`(() => { const s = document.querySelector('#testing .tst-pickerbox .tst-task-select'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change')); })()`);
  const picker = (): Promise<{ groups: string[]; options: string[]; value: string }> => js(`(() => { const s = document.querySelector('#testing .tst-pickerbox .tst-task-select'); return s ? {
    groups: [...s.querySelectorAll('optgroup')].map((g) => g.label),
    options: [...s.options].map((o) => o.textContent.trim()),
    value: s.value,
  } : { groups: [], options: [], value: '' }; })()`);
  const waitTesting = (want: (s: TestingState) => boolean, ms = 6000) => waitFor(async () => { const s = await testing(); return s && want(s) ? s : null; }, ms);

  try {
    applyTheme('paleSky', { persist: false });
    resizeOffscreen(win, 1280, 900);
    fs.rmSync(dir, { recursive: true, force: true });
    put(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    put(path.join(repo, 'package.json'), JSON.stringify({ name: 'shop', scripts: { test: 'vitest run' }, devDependencies: { vitest: '^5.0.0' } }, null, 2));
    writeTasksV1(repo);
    writeTranscript(transcript, repo);
    folderFixture.home = path.join(dir, 'claude-home');
    panelFixture.sessions = null;
    extraTabFixtures.push({ sessionId: SESSION, transcript, status: 'idle', cwd: repo });
    openTab(win.webContents);
    const tab = await waitFor<string | null>(() => js(`PastelTerm.tabs.ids().find((t) => PastelTerm.tabs.get(t).update?.sessionId === ${JSON.stringify(SESSION)}) ?? null`), 15000);
    check(tab, `a tab follows the fixture session: ${tab}`);
    await js(`PastelTerm.tabs.activate(${JSON.stringify(tab)})`);

    // 1 The Board reads the v1 file: three tasks, no PRD groups yet.
    await js('PastelTerm.sessionsBoard.open()');
    const first = await waitFor(async () => { const g = await groups(); return g.length === 1 && g[0]?.rows.length === 3 ? g : null; }, 5000);
    check(first?.[0]?.prd === null, `v1 tasks show ungrouped: ${JSON.stringify(first ?? await groups())}`);

    // 2 New PRD, then two tasks picked into it from their PRD menus.
    await type('#board .prd-add .prd-title-input', 'Checkout');
    await type('#board .prd-add .task-notes-input', 'Cart to payment');
    await submit('#board .prd-add');
    const prdId = await waitFor<string | null>(() => js("document.querySelector('#board .prd-group[data-prd-id]')?.dataset.prdId ?? null"), 4000);
    check(prdId, `the PRD is made: ${prdId}`);
    await pickPrd('t-cart', prdId ?? '');
    await settle();
    await pickPrd('t-coupon', prdId ?? '');
    const grouped = await waitFor(async () => { const g = await groups(); return g[0]?.rows.length === 2 ? g : null; }, 4000);
    check(JSON.stringify(grouped) === JSON.stringify([{ prd: 'Checkout', rows: ['Fix the cart total', 'Coupons'], subtasks: [] }, { prd: null, rows: ['Document the cart API'], subtasks: [] }]), `Checkout groups two tasks, the third is under No PRD: ${JSON.stringify(grouped ?? await groups())}`);

    // 3 Split Coupons into two subtasks, nested under it inside the PRD.
    await js(`document.querySelector('#board .task-row[data-task-id="t-coupon"] .task-split').click()`);
    await settle();
    await js(`document.querySelector('#board .task-split .task-split-input').value = 'Coupon API\\nCoupon UI'`);
    await submit('#board form.task-split');
    const split = await waitFor(async () => { const g = await groups(); return g[0]?.subtasks.length === 2 ? g : null; }, 4000);
    check(JSON.stringify(split?.[0]?.subtasks) === JSON.stringify(['Coupon API', 'Coupon UI']), `the split task shows two subtasks: ${JSON.stringify(split ?? await groups())}`);
    const stored = JSON.parse(fs.readFileSync(tasksJson, 'utf8')) as { version: number; prds: { id: string }[]; tasks: { id: string; title: string; prdId: string | null; parentId: string | null }[] };
    const subtask = stored.tasks.find((t) => t.title === 'Coupon API');
    check(stored.version === 2 && stored.prds.length === 1 && subtask?.parentId === 't-coupon' && subtask.prdId === prdId, `written back as version 2 with the PRD and subtasks: ${JSON.stringify(stored.tasks.map((t) => [t.title, t.prdId, t.parentId]))}`);
    await capture('prd-board');
    await js('PastelTerm.sessionsBoard.close()');

    // 4 Testing from the session holding "Fix the cart total": its own suite, runs and criteria. Coupons has different stages.
    testingFixture.project = repo;
    testingFixture.claudeDir = path.join(dir, 'claude');
    fs.mkdirSync(testingFixture.claudeDir, { recursive: true });
    writeSuite(repo, 't-cart', [['Unit', 'npm test'], ['Lint', 'npm run lint']]);
    writeSuite(repo, 't-coupon', [['Typecheck', 'npx tsc --noEmit'], ['E2E', 'npx playwright test']]);
    for (const r of [run('prd-run-old', 300, 'passed', null), run('prd-run-sub', 90, 'failed', subtask?.id ?? null), run('prd-run-c', 80, 'passed', 't-coupon'), run('prd-run-a1', 60, 'failed', 't-cart'), run('prd-run-a2', 20, 'passed', 't-cart')]) store.putRun(repo, r);
    put(path.join(repo, '.petal', 'test-criteria.md'), `# Test criteria\n\n## Scenarios\n- [pass] cart total rounds to the cent · test: src/cart.test.ts::rounds · round 1 · task: t-cart\n- [fail] two coupons stack · round 1 · task: ${subtask?.id ?? 'none'}\n- [pass] an old scenario · round 1\n\n## Bugs\n- [fixed] total off by a cent · test: src/cart.test.ts::cent · round 1 · task: t-cart\n- [fail] coupon API 500s · round 1 · task: ${subtask?.id ?? 'none'}\n`);
    await js('document.getElementById("testing-button").click()');
    const cart = await waitTesting((s) => s.task === 'Fix the cart total' && s.taskRuns === 2, 8000);
    check(cart && JSON.stringify(cart.stages) === JSON.stringify(['Unit', 'Lint']), `opens on the session's task with its own 2 stages and 2 runs: ${JSON.stringify(cart ?? await testing())}`);
    check(cart?.head === 'Fix the cart total · PRD Checkout · 2 stages' && !/shop/.test(cart.head), `the header names the task and its PRD, never the project: ${cart?.head}`);
    const listed = await picker();
    check(JSON.stringify(listed.groups) === JSON.stringify(['PRD · Checkout', 'No PRD']) && JSON.stringify(listed.options) === JSON.stringify(['All tasks in Checkout', 'Fix the cart total', 'Coupons', '↳ Coupon API', '↳ Coupon UI', 'Document the cart API']), `the picker groups tasks by PRD, subtasks nested: ${JSON.stringify(listed)}`);
    const crit: string[] = await js("[...document.querySelectorAll('#testing .tst-crit-name')].map((n) => n.textContent)");
    check(JSON.stringify(crit) === JSON.stringify(['cart total rounds to the cent', 'total off by a cent']), `criteria show this task's scenario and bug only: ${JSON.stringify(crit)}`);
    const projectWords: string = await js("[...document.querySelectorAll('#testing .tst-head, #testing .tst-pickerbox, #testing .tst-editor')].map((n) => n.textContent).join(' ')");
    check(!/Whole project|project’s commands|pipeline/i.test(projectWords) && !(await js("document.querySelector('#testing .tst-scope-option')")), `no Whole project switch and no project pipeline wording: ${projectWords.slice(0, 120)}`);
    await capture('testing-task-suite');

    // 5 Another task: its own stages and runs. A subtask without a suite runs its task's.
    await pickTarget('task:t-coupon');
    const coupon = await waitTesting((s) => s.task === 'Coupons');
    check(coupon && JSON.stringify(coupon.stages) === JSON.stringify(['Typecheck', 'E2E']) && coupon.taskRuns === 1 && coupon.head === 'Coupons · PRD Checkout · 2 stages', `switching tasks switches the stages and runs: ${JSON.stringify(coupon ?? await testing())}`);
    const chips: string[] = await js("[...document.querySelectorAll('#testing .tst-stage-name')].map((n) => n.textContent)");
    check(JSON.stringify(chips) === JSON.stringify(['Typecheck', 'E2E']), `the strip shows Coupons' stages: ${JSON.stringify(chips)}`);
    await capture('testing-other-task');
    await pickTarget(`task:${subtask?.id ?? ''}`);
    const sub = await waitTesting((s) => s.task === 'Coupon API');
    check(sub && JSON.stringify(sub.stages) === JSON.stringify(['Typecheck', 'E2E']) && sub.taskRuns === 1 && /from Coupons/.test(sub.head), `a subtask without a suite runs its task's: ${JSON.stringify(sub ?? await testing())}`);

    // 6 The PRD: an overview of each task's suite, last result, pass rate and open bugs; a row opens that task.
    await pickTarget(`prd:${prdId ?? ''}`);
    const overview = await waitFor<string[][] | null>(async () => {
      const rows: string[][] = await js("[...document.querySelectorAll('#testing .tst-overview-row')].map((r) => [r.querySelector('.tst-overview-name').textContent, r.querySelector('.tst-overview-meta').textContent])");
      return rows.length === 4 ? rows : null;
    }, 4000);
    check(overview?.[0]?.[0] === 'Fix the cart total' && /^2 stages · Last run passed · .+ · 50% passed · 0 open bugs$/.test(overview[0][1] ?? '') && overview[1]?.[0] === 'Coupons' && /^2 stages · Last run passed · .+ · 100% passed · 0 open bugs$/.test(overview[1][1] ?? ''), `the overview lists both tasks with their suites: ${JSON.stringify(overview)}`);
    check(overview?.[2]?.[0] === 'Coupon API' && /^2 stages, its task’s suite · Last run failed · .+ · 0% passed · 1 open bug$/.test(overview[2][1] ?? ''), `subtasks show under their task with their own results: ${JSON.stringify(overview?.slice(2))}`);
    check((await testing())?.head === 'PRD · Checkout' && (await js("document.querySelector('#testing .tst-tools-bar').hidden")), 'the header names the PRD; Edit and Run are for a task');
    await capture('testing-prd-overview');
    await js(`document.querySelector('#testing .tst-overview-row[data-task="t-cart"]').click()`);
    check(await waitTesting((s) => s.task === 'Fix the cart total' && s.stages.length === 2), 'a row opens that task');

    // 7 The coding session holding the task rewrites its suite file: not applied, flagged, the stages stay.
    const cartFile = path.join(repo, '.petal', 'suites', 't-cart.json');
    const before = fs.readFileSync(cartFile, 'utf8');
    appendSuiteWrite(transcript, SESSION, 'prd-a-suite', repo, cartFile);
    put(cartFile, JSON.stringify({ stages: [{ name: 'Unit', command: 'npm test' }] }));
    const outside = await waitTesting((s) => s.suiteProblem === 'Changed outside the testing agent, not applied.', 8000);
    check(outside && JSON.stringify(outside.stages) === JSON.stringify(['Unit', 'Lint']) && !outside.suiteChange, `the coding session's write is not applied and is flagged: ${JSON.stringify(outside ?? await testing())}`);
    put(cartFile, before);
    check(await waitTesting((s) => s.suiteProblem === null && s.stages.length === 2, 10000), 'putting the file back clears the flag');

    // 7b The test lock: on, the hook entry lands in the repo's settings.local.json; a main-session edit to a locked test is put back.
    const cartTest = path.join(repo, 'src', 'cart.test.ts');
    const settingsFile = path.join(repo, '.claude', 'settings.local.json');
    const lockFile = path.join(repo, '.petal', 'lock.json');
    put(cartTest, 'it("rounds to the cent", () => {});\n');
    await js("document.querySelector('#testing .tst-lock-toggle input').click()");
    const approved = await waitFor(() => {
      const lock = fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, 'utf8')) as { enabled: boolean; approved: Record<string, string> } : null;
      return lock?.enabled && lock.approved['src/cart.test.ts'] ? lock : null;
    }, 10000);
    const settings = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : '';
    check(approved && settings.includes('.petal/test-lock.mjs') && settings.includes('PreToolUse') && fs.existsSync(path.join(repo, '.petal', 'test-lock.mjs')), `the lock's hook lands in the repo's settings.local.json and the test is approved: ${settings.slice(0, 160)}`);
    appendSuiteWrite(transcript, SESSION, 'prd-a-edit-test', repo, cartTest);
    put(cartTest, 'it.skip("rounds to the cent", () => {});\n');
    const flag = await waitFor<string | null>(async () => {
      const text: string = await js("document.querySelector('#testing .tst-lock-flag')?.textContent ?? ''");
      return text && fs.readFileSync(cartTest, 'utf8') === 'it("rounds to the cent", () => {});\n' ? text : null;
    }, 10000);
    check(flag && /^Main session changed a test\. Restored\. · src\/cart\.test\.ts · (just now|\d+ min ago)$/.test(flag), `a main-session change to a locked test is restored and flagged: ${flag ?? await js("document.querySelector('#testing .tst-lock')?.textContent ?? ''")}`);
    const red: string = await js("(() => { const probe = document.createElement('span'); probe.style.color = 'var(--decide-ink)'; document.getElementById('testing').append(probe); const c = getComputedStyle(probe).color; probe.remove(); return c === getComputedStyle(document.querySelector('#testing .tst-lock-flag')).color ? c : ''; })()");
    check(red, `the flag shows in the warning colour: ${red}`);
    await capture('testing-lock');
    await js("document.querySelector('#testing .tst-lock-toggle input').click()");
    check(await waitFor(() => (fs.readFileSync(settingsFile, 'utf8').includes('test-lock') ? null : true), 6000), `turning it off removes only the lock's entry: ${fs.readFileSync(settingsFile, 'utf8').trim()}`);

    // 8 A task with no suite: Ask Claude starts its testing agent under a session id Petal remembers.
    await pickTarget('task:t-docs');
    const docs = await waitTesting((s) => s.task === 'Document the cart API');
    const noSuite: string = await js("document.querySelector('#testing .tst-no-suite-title')?.textContent ?? ''");
    check(docs && docs.stages.length === 0 && noSuite === 'No suite for this task yet' && !(await js("document.querySelector('#testing .tst-seed-suite')")), `no suite yet, and no seed offered without project commands: ${noSuite}`);
    const startsBefore = testingFixture.loopStarts.length;
    await js("document.querySelector('#testing .tst-ask-suite').click()");
    const started = await waitFor(() => testingFixture.loopStarts.slice(startsBefore).find((l) => l.command.includes('/petal-testing-suite')) ?? null, 4000);
    const agent = store.load(repo).agents?.['t-docs']?.[0]?.sessionId ?? '';
    check(started && agent && started.command.includes(`--session-id ${agent} --`) && started.command.includes('for task t-docs:') && started.command.includes('testing agent') && !/[—–]/.test(started.command), `the testing agent starts in a new tab with its own session id: ${JSON.stringify(started?.command.slice(0, 160))}`);

    // 9 The testing agent writes the suite: taken, "Testing agent updated this suite", and Undo restores.
    const agentLog = path.join(dir, 'tabs', `${agent}.jsonl`);
    const docsFile = path.join(repo, '.petal', 'suites', 't-docs.json');
    writeTranscript(agentLog, repo, agent);
    appendSuiteWrite(agentLog, agent, 'prd-agent-suite', repo, docsFile);
    extraTabFixtures.push({ sessionId: agent, transcript: agentLog, status: 'idle', cwd: repo });
    openTab(win.webContents);
    put(docsFile, JSON.stringify({ stages: [{ name: 'Docs build', command: 'npm run docs' }, { name: 'Links', command: 'npm run check-links' }] }));
    const updated = await waitTesting((s) => s.stages.length === 2 && s.suiteChange, 10000);
    const line: string = await js("document.querySelector('#testing .tst-suite-change')?.textContent ?? ''");
    check(updated && /^Testing agent updated this suite · (just now|\d+ min ago) · Undo$/.test(line), `the agent's write shows its stages and says so: ${line} ${JSON.stringify(updated?.stages ?? await testing())}`);
    await capture('testing-suite-change');
    await js("document.querySelector('#testing .tst-undo-suite').click()");
    const undone = await waitTesting((s) => s.stages.length === 0 && !s.suiteChange);
    check(undone && !fs.existsSync(docsFile) && (await js("document.querySelector('#testing .tst-no-suite-title')?.textContent")) === 'No suite for this task yet', 'Undo puts back what was there: no suite');
    const overflow: number = await js("Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.getElementById('testing').scrollWidth - document.getElementById('testing').clientWidth)");
    check(overflow <= 1, `nothing sideways at 1280px: ${overflow}`);
  } finally {
    await js('PastelTerm.testing.close()');
    await js('PastelTerm.sessionsBoard.close()');
    extraTabFixtures.length = 0;
    const opened: string[] = (await js('PastelTerm.tabs.ids()')).filter((t: string) => !startTabs.includes(t));
    for (const t of opened) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(t)})`);
    await waitFor(async () => ((await js('PastelTerm.tabs.ids()')).length === startTabs.length ? true : null), 8000);
    await js(`PastelTerm.tabs.activate(${JSON.stringify(startTabs[0])})`);
    panelFixture.sessions = saved.panel;
    folderFixture.home = saved.home;
    testingFixture.project = saved.project;
    testingFixture.claudeDir = saved.claudeDir;
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
