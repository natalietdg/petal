// PRDs and per-task suites (PASTEL_SNAPSHOT_MODE=prd-tasks): a version 1 tasks.json read and written back as 2,
// a PRD made through the task store grouping two tasks, one task split into subtasks, then Testing opened from the session that
// holds a task: that task's own suite, another task's different stages a pick away, a subtask running its task's suite,
// the PRD's overview of both, the coding session's suite write refused, the test lock (absolute hook path, the main session's
// refusals, her own suite edits: Use this file or Keep the old suite), and a task with no suite starting its testing
// agent, whose write is taken with Undo. Never runs a command.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit, TabsDeps } from './snapshot';
import { extraTabFixtures, folderFixture, historyFixture, panelFixture, pasteWrites, testingFixture } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import * as store from '../main/testing-store';
import { lockedCopiesDir } from '../main/test-lock';
import { assertFixtureOutsideClaude } from './snapshot-views';
import { closeExtraTabs, hostOf } from './snapshot-testing';
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
  const saved = { panel: panelFixture.sessions, home: folderFixture.home, project: testingFixture.project, claudeDir: testingFixture.claudeDir, historyRecords: [...historyFixture.records] };
  const [startWidth, startHeight] = win.getContentSize();
  const startTabs: string[] = await js('PastelTerm.tabs.ids()');
  type View = { tasks: { id: string; title: string; prdId: string | null; parentId: string | null }[]; prds: { id: string; title: string }[] };
  const taskOp = (tabId: string | null, op: object): Promise<View> => js(`window.pastel.tasks.change(${JSON.stringify(tabId)}, ${JSON.stringify(op)})`);
  const groups = (v: View | null) => v?.tasks.map((t) => [t.title, v.prds.find((p) => p.id === t.prdId)?.title ?? null, v.tasks.find((p) => p.id === t.parentId)?.title ?? null]);
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

    // 1 The store reads the v1 file: three tasks, no PRDs yet. Testing's picker reads the same store.
    const first: View | null = await js(`window.pastel.tasks.get(${JSON.stringify(tab)})`);
    check(first?.tasks.length === 3 && first.prds.length === 0, `v1 tasks read, ungrouped: ${JSON.stringify(groups(first))}`);

    // 2 New PRD, then two tasks put into it.
    const made = await taskOp(tab, { kind: 'prd-add', title: 'Checkout', notes: 'Cart to payment' });
    const prdId = made?.prds[0]?.id ?? null;
    check(prdId, `the PRD is made: ${prdId}`);
    await taskOp(tab, { kind: 'set-prd', id: 't-cart', prdId });
    const grouped = await taskOp(tab, { kind: 'set-prd', id: 't-coupon', prdId });
    check(JSON.stringify(groups(grouped)) === JSON.stringify([['Fix the cart total', 'Checkout', null], ['Coupons', 'Checkout', null], ['Document the cart API', null, null]]), `Checkout groups two tasks, the third has no PRD: ${JSON.stringify(groups(grouped))}`);

    // 3 Split Coupons into two subtasks, inside the PRD.
    const split = await taskOp(tab, { kind: 'split', id: 't-coupon', titles: ['Coupon API', 'Coupon UI'] });
    check(JSON.stringify(groups(split)?.filter((g) => g[2] === 'Coupons')) === JSON.stringify([['Coupon API', 'Checkout', 'Coupons'], ['Coupon UI', 'Checkout', 'Coupons']]), `the split task has two subtasks: ${JSON.stringify(groups(split))}`);
    const stored = JSON.parse(fs.readFileSync(tasksJson, 'utf8')) as { version: number; prds: { id: string }[]; tasks: { id: string; title: string; prdId: string | null; parentId: string | null }[] };
    const subtask = stored.tasks.find((t) => t.title === 'Coupon API');
    check(stored.version === 2 && stored.prds.length === 1 && subtask?.parentId === 't-coupon' && subtask.prdId === prdId, `written back as version 2 with the PRD and subtasks: ${JSON.stringify(stored.tasks.map((t) => [t.title, t.prdId, t.parentId]))}`);

    // 4 Testing from the session holding "Fix the cart total": its own suite, runs and criteria. Coupons has different stages.
    testingFixture.project = repo;
    testingFixture.claudeDir = path.join(dir, 'claude');
    fs.mkdirSync(testingFixture.claudeDir, { recursive: true });
    writeSuite(repo, 't-cart', [['Unit', 'npm test'], ['Lint', 'npm run lint']]);
    writeSuite(repo, 't-coupon', [['Typecheck', 'npx tsc --noEmit'], ['E2E', 'npx playwright test']]);
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    fs.utimesSync(path.join(repo, '.petal', 'suites', 't-cart.json'), ago(5), ago(5)); // fixture suite times, so the picker order is fixed
    fs.utimesSync(path.join(repo, '.petal', 'suites', 't-coupon.json'), ago(120), ago(120));
    for (const r of [run('prd-run-old', 300, 'passed', null), run('prd-run-sub', 90, 'failed', subtask?.id ?? null), run('prd-run-c', 80, 'passed', 't-coupon'), run('prd-run-a1', 60, 'failed', 't-cart'), run('prd-run-a2', 20, 'passed', 't-cart')]) store.putRun(repo, r);
    put(path.join(repo, '.petal', 'test-criteria.md'), `# Test criteria\n\n## Scenarios\n- [pass] cart total rounds to the cent · test: src/cart.test.ts::rounds · round 1 · task: t-cart\n- [fail] two coupons stack · round 1 · task: ${subtask?.id ?? 'none'}\n- [pass] an old scenario · round 1\n\n## Bugs\n- [fixed] total off by a cent · test: src/cart.test.ts::cent · round 1 · task: t-cart\n- [fail] coupon API 500s · round 1 · task: ${subtask?.id ?? 'none'}\n`);
    await js('document.getElementById("testing-button").click()');
    const cart = await waitTesting((s) => s.task === 'Fix the cart total' && s.taskRuns === 2, 8000);
    check(cart && JSON.stringify(cart.stages) === JSON.stringify(['Unit', 'Lint']), `opens on the session's task with its own 2 stages and 2 runs: ${JSON.stringify(cart ?? await testing())}`);
    check(cart?.head === 'Fix the cart total · PRD Checkout · 2 stages' && !/shop/.test(cart.head), `the header names the task and its PRD, never the project: ${cart?.head}`);
    const listed = await picker();
    // Coupons' subtasks were made seconds ago, newer than the cart suite's 5 min; Document the cart API dates from 3 h ago.
    check(JSON.stringify(listed.groups) === JSON.stringify(['PRD · Checkout', 'No PRD']) && JSON.stringify(listed.options) === JSON.stringify(['All tasks in Checkout', 'Coupons', '↳ Coupon API', '↳ Coupon UI', 'Fix the cart total', 'Document the cart API']), `the picker groups tasks by PRD, newest activity first, subtasks nested: ${JSON.stringify(listed)}`);
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
    const copy = path.join(lockedCopiesDir(repo), 'src', 'cart.test.ts');
    check(fs.existsSync(copy) && copy.startsWith(store.testingDir()) && !fs.existsSync(path.join(repo, '.petal', 'locked')), `the approved copy is kept in Petal's storage, not the repo where test runners look: ${copy}`);
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
    check(settings.includes(`node '${repo}/.petal/test-lock.mjs'`) && !settings.includes('CLAUDE_PROJECT_DIR'), `the hook names this repo's script by its absolute path, so a subfolder session finds it: ${settings.slice(0, 200)}`);

    // 7c The main session's refusals, never shown before, show in the lock bar; Dismiss clears them.
    put(path.join(repo, '.petal', 'lock-refusals.jsonl'), `${JSON.stringify({ at: Date.now(), session: SESSION, tool: 'Edit', target: cartTest, reason: 'Tests belong to Testing agent. Ask it to change them.' })}\n`);
    const refusal = await waitFor<string | null>(async () => {
      const lines: string[] = await js("[...document.querySelectorAll('#testing .tst-lock-flag')].map((n) => n.textContent)");
      return lines.find((l) => l.startsWith('Main session tried to edit')) ?? null;
    }, 8000);
    check(refusal && /^Main session tried to edit src\/cart\.test\.ts\. Refused\. · (just now|\d+ min ago)$/.test(refusal), `the main session's refusal shows in the lock bar: ${refusal ?? await js("document.querySelector('#testing .tst-lock')?.textContent ?? ''")}`);
    await capture('testing-lock-refusal');
    await js("document.querySelector('#testing .tst-lock-dismiss').click()");
    check(await waitFor(async () => ((await js("document.querySelector('#testing .tst-lock')?.textContent ?? ''")).includes('tried to edit') ? null : true), 6000), 'Dismiss clears the refusal line');

    // 7d Her hand edit of a suite with the lock on: still refused, but Use this file is hers; Keep the old suite isn't offered.
    const couponFile = path.join(repo, '.petal', 'suites', 't-coupon.json');
    const couponBefore = fs.readFileSync(couponFile, 'utf8');
    await pickTarget('task:t-coupon');
    await waitTesting((s) => s.task === 'Coupons');
    writeSuite(repo, 't-coupon', [['Typecheck', 'npx tsc --noEmit'], ['E2E', 'npx playwright test'], ['Hers', 'npm run hers']]);
    const lockedOutside = await waitTesting((s) => s.suiteProblem === 'Changed outside the testing agent, not applied.', 8000);
    const lockedButtons: string[] = await js("[...document.querySelectorAll('#testing .tst-suite-change button')].map((b) => b.textContent)");
    check(lockedOutside && JSON.stringify(lockedButtons) === JSON.stringify(['Use this file']) && lockedOutside.stages.length === 2, `with the lock on her edit is refused and only Use this file is offered: ${JSON.stringify(lockedButtons)} ${JSON.stringify(lockedOutside ?? await testing())}`);
    put(couponFile, couponBefore);
    await waitTesting((s) => s.suiteProblem === null, 8000);
    await pickTarget('task:t-cart');
    await waitTesting((s) => s.task === 'Fix the cart total');

    await js("document.querySelector('#testing .tst-lock-toggle input').click()");
    check(await waitFor(() => (fs.readFileSync(settingsFile, 'utf8').includes('test-lock') ? null : true), 6000), `turning it off removes only the lock's entry: ${fs.readFileSync(settingsFile, 'utf8').trim()}`);

    // 7e Lock off: her hand edit says so plainly, with Use this file and Keep the old suite. Use it, then Undo; then Keep.
    await pickTarget('task:t-coupon');
    await waitTesting((s) => s.task === 'Coupons');
    writeSuite(repo, 't-coupon', [['Typecheck', 'npx tsc --noEmit'], ['E2E', 'npx playwright test'], ['Hers', 'npm run hers']]);
    const plain = await waitTesting((s) => s.suiteProblem === 'Changed outside the testing agent.', 8000);
    const plainButtons: string[] = await js("[...document.querySelectorAll('#testing .tst-suite-change button')].map((b) => b.textContent)");
    check(plain && JSON.stringify(plainButtons) === JSON.stringify(['Use this file', 'Keep the old suite']), `lock off: her edit is flagged plainly with both answers: ${JSON.stringify(plainButtons)} ${JSON.stringify(plain ?? await testing())}`);
    await capture('testing-suite-outside');
    await js("document.querySelector('#testing .tst-use-file').click()");
    const used = await waitTesting((s) => s.stages.length === 3 && s.suiteProblem === null && s.suiteChange, 8000);
    const usedLine: string = await js("document.querySelector('#testing .tst-suite-change')?.textContent ?? ''");
    check(used && /^You took this file · (just now|\d+ min ago) · Undo$/.test(usedLine), `Use this file takes her stages, with Undo: ${usedLine} ${JSON.stringify(used ?? await testing())}`);
    await js("document.querySelector('#testing .tst-undo-suite').click()");
    check(await waitTesting((s) => s.stages.length === 2 && !s.suiteChange, 8000), 'Undo puts the old suite back');
    writeSuite(repo, 't-coupon', [['Oops', 'npm run oops']]);
    await waitTesting((s) => s.suiteProblem === 'Changed outside the testing agent.', 8000);
    await js("document.querySelector('#testing .tst-keep-suite').click()");
    const kept = await waitTesting((s) => s.suiteProblem === null && s.stages.length === 2, 8000);
    check(kept && fs.readFileSync(couponFile, 'utf8') === couponBefore, `Keep the old suite writes the suite in use back over her file: ${fs.readFileSync(couponFile, 'utf8').slice(0, 120)}`);
    fs.utimesSync(couponFile, new Date(Date.now() - 120 * 60_000), new Date(Date.now() - 120 * 60_000)); // fixture time back, so later order holds

    // 8 A task with no suite: Ask Claude starts its testing agent under a session id Petal remembers.
    await pickTarget('task:t-docs');
    const docs = await waitTesting((s) => s.task === 'Document the cart API');
    const noSuite: string = await js("document.querySelector('#testing .tst-no-suite-title')?.textContent ?? ''");
    check(docs && docs.stages.length === 0 && noSuite === 'No suite for this task yet' && !(await js("document.querySelector('#testing .tst-seed-suite')")), `no suite yet, and no seed offered without project commands: ${noSuite}`);
    const startsBefore = testingFixture.loopStarts.length;
    await js("document.querySelector('#testing .tst-ask-suite').click()");
    const started = await waitFor(() => testingFixture.loopStarts.slice(startsBefore).find((l) => l.brief?.includes('You are this task\'s testing agent')) ?? null, 4000);
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
    // 10 The loop as two agents: rename both, start them, both busy at once with a bug queue between them, chat with each.
    await pickTarget('task:t-cart');
    await waitTesting((s) => s.task === 'Fix the cart total' && s.stages.length === 2);
    const lane = (role: string) => `#testing .tst-agent-lane[data-role="${role}"]`;
    for (const [role, name] of [['tester', 'Quinn'], ['fixer', 'Fixie']] as const) {
      await waitFor(() => js(`document.querySelector('${lane(role)} .tst-agent-rename-button') ? true : null`), 4000);
      await js(`document.querySelector('${lane(role)} .tst-agent-rename-button').click()`);
      await waitFor(() => js(`document.querySelector('${lane(role)} .tst-agent-name-input') ? true : null`), 3000);
      await js(`(() => { const i = document.querySelector('${lane(role)} .tst-agent-name-input'); i.value = ${JSON.stringify(` ${name} `)}; document.querySelector('${lane(role)} .tst-agent-rename').requestSubmit(); })()`);
      await waitFor(async () => ((await js(`document.querySelector('${lane(role)} .tst-agent-name')?.textContent`)) === name ? true : null), 6000);
    }
    const laneNames: string[] = await js("[...document.querySelectorAll('#testing .tst-agent-name')].map((n) => n.textContent)");
    const estimateLine: string = await js("document.querySelector('#testing .tst-agent-estimate')?.textContent ?? ''");
    check(JSON.stringify(laneNames) === JSON.stringify(['Quinn', 'Fixie']) && JSON.stringify(store.load(repo).agentNames) === JSON.stringify({ tester: 'Quinn', fixer: 'Fixie' }), `both agents renamed, saved per project: ${JSON.stringify(laneNames)}`);
    check(/^About [\d.]+k? tokens per round for both agents\./.test(estimateLine), `an estimate before Start: ${estimateLine}`);

    const TESTER = '7e570000-0000-4000-8000-0000000000a1';
    const FIXER = '7e570000-0000-4000-8000-0000000000a2';
    const testerLog = path.join(dir, 'tabs', `${TESTER}.jsonl`);
    const fixerLog = path.join(dir, 'tabs', `${FIXER}.jsonl`);
    const stamp = () => new Date().toISOString();
    const entry = (sessionId: string, fields: Record<string, unknown>) => `${JSON.stringify({ isSidechain: false, cwd: repo, sessionId, timestamp: stamp(), ...fields })}\n`;
    const usage = { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 4000, cache_read_input_tokens: 9000 };
    const say = (sessionId: string, uuid: string, prompt: string, text: string) => entry(sessionId, { type: 'user', uuid: `${uuid}-u`, message: { role: 'user', content: prompt } })
      + entry(sessionId, { type: 'assistant', uuid, message: { id: `msg-${uuid}`, role: 'assistant', usage, content: [{ type: 'text', text }] } });
    const tool = (sessionId: string, uuid: string, name: string, input: object, result: string, isError = false) => entry(sessionId, { type: 'assistant', uuid, message: { id: `msg-${uuid}`, role: 'assistant', usage, content: [{ type: 'tool_use', id: `toolu_${uuid}`, name, input }] } })
      + entry(sessionId, { type: 'user', uuid: `${uuid}-r`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${uuid}`, content: result, is_error: isError }] } });
    put(testerLog, say(TESTER, 'h-t0', 'You are Quinn.', 'Reading the cart code.'));
    put(fixerLog, say(FIXER, 'h-f0', 'You are Fixie.', 'Ready.'));
    const testerFixture = { sessionId: TESTER, transcript: testerLog, status: 'idle', cwd: repo };
    const fixerFixture = { sessionId: FIXER, transcript: fixerLog, status: 'idle', cwd: repo };
    testingFixture.agentIds.splice(0, Infinity, TESTER, FIXER);
    extraTabFixtures.push(testerFixture, fixerFixture);
    const startsBefore10 = testingFixture.loopStarts.length;
    await js("document.querySelector('#testing .tst-loop-go').click()");
    const loopStarts = await waitFor(() => (testingFixture.loopStarts.length === startsBefore10 + 2 ? testingFixture.loopStarts.slice(startsBefore10) : null), 6000);
    check(loopStarts && loopStarts[0]?.command.includes(`--session-id ${TESTER} --`) && loopStarts[0].brief?.startsWith('You are Quinn, this task\'s testing agent.') && loopStarts[1]?.command.includes(`--session-id ${FIXER} --`) && loopStarts[1].brief?.startsWith('You are Fixie, the bug fix agent'), `Start opens the testing agent and the bug fix agent, named: ${JSON.stringify(loopStarts?.map((l) => l.brief?.slice(0, 50)))}`);
    const tabOfAgent = (id: string): string | null => hostOf(win.webContents.id, repo, id); // its agent terminal, as main says
    const testerTab = await waitFor(() => tabOfAgent(TESTER), 8000);
    const fixerTab = await waitFor(() => tabOfAgent(FIXER), 8000);
    const titles = await waitFor(async () => { const t: string[] = await js(`[${JSON.stringify(testerTab)}, ${JSON.stringify(fixerTab)}].map((id) => PastelTerm.tabs.get(id)?.element.title ?? '')`); return t[0]?.startsWith('Quinn') && t[1]?.startsWith('Fixie') ? t : null; }, 8000);
    check(titles && titles[0] === 'Quinn · Fix the cart total' && titles[1] === 'Fixie · Fix the cart total', `each agent's terminal is titled with its name and the task: ${JSON.stringify(titles ?? await js(`[${JSON.stringify(testerTab)}, ${JSON.stringify(fixerTab)}].map((id) => PastelTerm.tabs.get(id)?.element.title ?? '')`))}`);

    // Quinn files a bug; the idle Fixie gets it. Then both work at once, and a failure seen mid-edit waits for a recheck.
    const criteriaFile = path.join(repo, '.petal', 'test-criteria.md');
    const criteriaBase = fs.readFileSync(criteriaFile, 'utf8');
    fs.appendFileSync(testerLog, tool(TESTER, 'h-t1', 'Write', { file_path: path.join(repo, 'src', 'cart.test.ts'), content: 'it("drops no cent")\n' }, 'ok')
      + tool(TESTER, 'h-t2', 'Bash', { command: 'npm test' }, 'Exit code 1\n1 failed', true)
      + say(TESTER, 'h-t3', 'go on', 'One real bug, filed.\n\n**Loop:** round 1/5 · testing · 1 open'));
    put(criteriaFile, `${criteriaBase}- [fail] cart total drops a cent · test: src/cart.test.ts::rounds · round 1 · task: t-cart\n`);
    const handed = await waitFor(() => pasteWrites.find((w) => w.tabId === fixerTab && w.data.includes('Bug: cart total drops a cent.')) ?? null, 10000);
    check(handed, `the bug goes to Fixie's session: ${JSON.stringify(handed?.data.slice(0, 80))}`);
    testerFixture.status = 'busy';
    fixerFixture.status = 'busy';
    check(await waitFor(async () => ((await js("document.querySelectorAll('#testing .tst-agent-lane.is-busy').length")) === 2 ? true : null), 8000), 'both agents are busy at once');
    fs.appendFileSync(fixerLog, tool(FIXER, 'h-f1', 'Edit', { file_path: path.join(repo, 'src', 'cart.ts'), old_string: 'Math.floor(t)', new_string: 'Math.round(t * 100) / 100' }, 'ok')
      + tool(FIXER, 'h-f2', 'Edit', { file_path: path.join(repo, 'src', 'cart.test.ts'), old_string: 'a', new_string: 'b' }, 'PreToolUse:Edit hook error: Tests belong to Quinn. Ask it to change them.', true));
    put(criteriaFile, `${criteriaBase}- [fail] cart total drops a cent · test: src/cart.test.ts::rounds · round 1 · task: t-cart\n- [fail] coupon line shows NaN · test: src/coupon.test.ts::label · round 1 · task: t-cart\n`);
    type AgentsState = { queue: { key: string; state: string }[]; lanes: { role: string; name: string; status: string }[] };
    const both = await waitFor(async () => {
      const a = (await js('PastelTerm.testing.state().agents')) as AgentsState;
      const busy: number = await js("document.querySelectorAll('#testing .tst-agent-lane.is-busy').length");
      return busy === 2 && a.queue.some((b) => b.state === 'fixing') && a.queue.some((b) => b.state === 'recheck') ? a : null;
    }, 10000);
    check(both && both.lanes[1]?.status === 'Fixing cart total drops a cent' && /Testing · round 1\/5/.test(both.lanes[0]?.status ?? ''), `both lanes busy at once, one bug fixing and the mid-edit one waiting for a recheck: ${JSON.stringify(both ?? await js('PastelTerm.testing.state().agents'))}`);
    const counts: string = await js("document.querySelector('#testing .tst-queue-head')?.textContent ?? ''");
    check(/Rechecking 1/.test(counts) && /Fixing 1/.test(counts), `the queue counts each state: ${counts}`);

    // Chat: one message to each agent reaches that agent's session; its reply shows in the lane.
    for (const [role, tab, text] of [['tester', testerTab, 'Add a case for half a cent.'], ['fixer', fixerTab, 'Check the rounding in totals too.']] as const) {
      const before = pasteWrites.length;
      await js(`(() => { const i = document.querySelector('${lane(role)} .tst-agent-input'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); document.querySelector('${lane(role)} .tst-agent-send').requestSubmit(); })()`);
      const sent = await waitFor(() => pasteWrites.slice(before).find((w) => w.data.includes(text)) ?? null, 4000);
      check(sent && sent.tabId === tab, `the message to the ${role} reached its own session: ${JSON.stringify(sent)}`);
    }
    fs.appendFileSync(testerLog, say(TESTER, 'h-t4', 'Add a case for half a cent.', 'Added **half a cent** to the rounding cases.\n\n**Loop:** round 1/5 · testing · 2 open'));
    fs.appendFileSync(fixerLog, say(FIXER, 'h-f3', 'Check the rounding in totals too.', 'Totals round the same way now.'));
    const replied = await waitFor(async () => {
      const t: string = await js(`document.querySelector('${lane('tester')} .tst-agent-turns')?.textContent ?? ''`);
      const f: string = await js(`document.querySelector('${lane('fixer')} .tst-agent-turns')?.textContent ?? ''`);
      return t.includes('Added half a cent to the rounding cases.') && f.includes('Totals round the same way now.') ? { t, f } : null;
    }, 10000);
    check(replied && await js(`!!document.querySelector('${lane('tester')} .tst-agent-reply strong')`), 'each reply renders in its lane in the reader style');
    const refusalLine: string = await js(`document.querySelector('${lane('fixer')} .tst-agent-refusal')?.textContent ?? ''`);
    check(refusalLine === 'Refused: Fixie tried to edit src/cart.test.ts', `the lock's refusal shows in Fixie's lane: ${refusalLine}`);
    const tokens: string[] = await js("[...document.querySelectorAll('#testing .tst-agent-tokens')].map((n) => n.textContent)");
    const total: string = await js("document.querySelector('#testing .tst-agent-total')?.textContent ?? ''");
    check(tokens.length === 2 && tokens.every((t) => /^[\d.]+k tokens \([\d.]+k of them cached reads\)$/.test(t)) && /so far for both agents$/.test(total), `tokens per lane from each session's usage, cache reads named apart, and a total: ${JSON.stringify(tokens)} ${total}`);
    await js(`document.querySelector('${lane('fixer')} .tst-agent-view[data-view="actions"]').click()`);
    const fixerLogLines = await waitFor<string[] | null>(async () => { const l: string[] = await js(`[...document.querySelectorAll('${lane('fixer')} .tst-agent-step-text')].map((n) => n.textContent)`); return l.some((x) => x.startsWith('Edited src/cart.ts')) ? l : null; }, 6000);
    const roundLine: string = await js(`document.querySelector('${lane('fixer')} .tst-agent-rounds li')?.textContent ?? ''`);
    check(fixerLogLines?.includes('Refused: Fixie tried to edit src/cart.test.ts') && fixerLogLines.includes('Edited src/cart.ts (+1 −1)') && fixerLogLines.some((l) => l.startsWith('Quinn → Fixie · cart total drops a cent')) && /edits? · \d+ commands? · 1 refusal$/.test(roundLine), `Fixie's action log: its edits, the refusal and Petal's handoff, with a round line: ${JSON.stringify(fixerLogLines)} ${roundLine}`);
    await js("document.querySelector('#testing .tst-agentsbox').scrollIntoView({ block: 'start' })");
    await wait(300);
    await capture('testing-handoff');
    testerFixture.status = 'idle';
    fixerFixture.status = 'idle';
    await js("document.querySelector('#testing .tst-stop').click()");
    check(await waitFor(async () => ((await js('PastelTerm.testing.state().loop')) === 'stopped' ? true : null), 15000), 'Stop halts both agents');

    // Quinn's terminal gone (closed, or after a restart): the lane still takes a message and main resumes its session for it.
    historyFixture.records.push({ sessionId: TESTER, file: testerLog, cwd: repo, title: 'Quinn', firstPrompt: 'You are Quinn.', lastAt: Date.now(), messages: 1, messagesExact: true });
    await js(`PastelTerm.tabs.requestClose(${JSON.stringify(testerTab)})`);
    const reopenBox = await waitFor<{ placeholder: string; terminal: string | null } | null>(() => js(`(() => { const i = document.querySelector('${lane('tester')} .tst-agent-input'); return i && !i.disabled && !PastelTerm.tabs.get(${JSON.stringify(testerTab)}) && i.placeholder.includes('Resumes') ? { placeholder: i.placeholder, terminal: document.querySelector('${lane('tester')} .tst-agent-terminal')?.textContent ?? null } : null; })()`), 10000);
    check(reopenBox?.placeholder === 'Message Quinn. Resumes its session' && reopenBox.terminal === 'Terminal', `with its terminal closed Quinn's box stays on and Terminal stays: ${JSON.stringify(reopenBox)}`);
    const resumesBefore = testingFixture.resumes.length;
    await js(`(() => { const i = document.querySelector('${lane('tester')} .tst-agent-input'); i.value = 'Still there?'; i.dispatchEvent(new Event('input')); document.querySelector('${lane('tester')} .tst-agent-send').requestSubmit(); })()`);
    const reopened = await waitFor(() => (testingFixture.resumes.slice(resumesBefore).some((r) => r.sessionId === TESTER) ? true : null), 6000);
    const reopenLine: string = await waitFor(() => js(`document.querySelector('${lane('tester')} .tst-agent-note')?.textContent || null`), 4000) ?? '';
    check(reopened && reopenLine === 'Resuming Quinn’s session. Your message goes once it’s ready.', `Send resumed Quinn's own session in an agent terminal: ${JSON.stringify({ resumes: testingFixture.resumes.slice(resumesBefore), reopenLine })}`);

    const overflow: number = await js("Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.getElementById('testing').scrollWidth - document.getElementById('testing').clientWidth)");
    check(overflow <= 1, `nothing sideways at 1280px: ${overflow}`);

    // 11 A second Claude session in this repo, which already has tasks, gets its own task named for it, once, however
    // fast Testing refreshes; the testing agent's session gets none.
    const SECOND = '7a5c0000-0000-4000-8000-0000000000d2';
    const secondLog = path.join(dir, 'tabs', `${SECOND}.jsonl`);
    writeTranscript(secondLog, repo, SECOND);
    extraTabFixtures.push({ sessionId: SECOND, transcript: secondLog, status: 'idle', cwd: repo });
    openTab(win.webContents);
    const secondTab = await waitFor<string | null>(() => js(`PastelTerm.tabs.ids().find((t) => PastelTerm.tabs.get(t).update?.sessionId === ${JSON.stringify(SECOND)}) ?? null`), 15000);
    type Detected = { sessionTaskId: string | null; tasks: { id: string; title: string; owner: { sessionId: string } | null }[] };
    const detect = (tabId: string | null): Promise<Detected> => js(`window.pastel.testing.detect(${JSON.stringify(tabId)})`);
    const [one, two] = await Promise.all([detect(secondTab), detect(secondTab)]);
    const ownedBySecond = (await detect(secondTab)).tasks.filter((t) => t.owner?.sessionId === SECOND);
    check(secondTab && ownedBySecond.length === 1 && one.sessionTaskId === ownedBySecond[0]?.id && two.sessionTaskId === ownedBySecond[0]?.id, `the second session gets exactly one task of its own: ${JSON.stringify({ owned: ownedBySecond, one: one.sessionTaskId, two: two.sessionTaskId })}`);
    check(ownedBySecond[0]?.title && ownedBySecond[0].title !== 'Fix the cart total' && one.tasks.find((t) => t.id === 't-cart')?.owner?.sessionId === SESSION, `named for its session, and the first session keeps its task: ${JSON.stringify(ownedBySecond[0]?.title)}`);
    check(JSON.stringify(store.load(repo).autoTasks ?? []).includes(ownedBySecond[0]?.id ?? 'none'), 'the task is remembered as made by Testing, the only kind it may prune');
    const asAgent = await detect(testerTab);
    check(!asAgent.tasks.some((t) => t.owner?.sessionId === TESTER), `the testing agent's session gets no task: ${JSON.stringify(asAgent.tasks.map((t) => t.owner?.sessionId))}`);
  } finally {
    await js('PastelTerm.testing.close()');
    await js('PastelTerm.sessionsBoard.close()');
    extraTabFixtures.length = 0;
    testingFixture.resumes.length = 0;
    await closeExtraTabs(kit, startTabs);
    await js(`PastelTerm.tabs.activate(${JSON.stringify(startTabs[0])})`);
    panelFixture.sessions = saved.panel;
    folderFixture.home = saved.home;
    testingFixture.project = saved.project;
    testingFixture.claudeDir = saved.claudeDir;
    testingFixture.agentIds.length = 0;
    historyFixture.records.splice(0, Infinity, ...saved.historyRecords);
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
