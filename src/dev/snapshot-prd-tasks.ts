// PRDs and task-scoped testing (PASTEL_SNAPSHOT_MODE=prd-tasks): a version 1 tasks.json read and written back as 2,
// a PRD made on the Board grouping two tasks, one task split into subtasks, then Testing opened from the session that
// holds a task: scoped to This task by default, with PRD and Whole project a click away. Never runs a command.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit, TabsDeps } from './snapshot';
import { extraTabFixtures, folderFixture, panelFixture, testingFixture } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { putRun } from '../main/testing-store';
import { assertFixtureOutsideClaude } from './snapshot-views';
import type { PipelineRun, RunState } from '../shared/testing';

const SESSION = '7a5c0000-0000-4000-8000-0000000000d1';
const HOUR = 60 * 60_000;

const put = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

function writeTranscript(file: string, cwd: string): void {
  assertFixtureOutsideClaude(file);
  const at = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const entry = (fields: Record<string, unknown>) => JSON.stringify({ isSidechain: false, cwd, sessionId: SESSION, ...fields });
  put(file, `${entry({ type: 'user', uuid: 'prd-u0', timestamp: at(10), message: { role: 'user', content: 'fix the cart total rounding' } })}\n${entry({ type: 'assistant', uuid: 'prd-a0', timestamp: at(9), message: { role: 'assistant', content: [{ type: 'text', text: '**Looking at the cart.**' }] } })}\n`);
}

// A version 1 file: the fixture session holds "Fix the cart total".
function writeTasksV1(repo: string): void {
  const owner = { sessionId: SESSION, name: 'Cart work', branch: 'main' };
  const task = (id: string, title: string, held = false) => ({ id, title, notes: '', status: held ? 'claimed' : 'open', owner: held ? owner : null, createdAt: Date.now() - 3 * HOUR, claimedAt: held ? Date.now() - 2 * HOUR : null, doneAt: null, doneBy: null });
  put(path.join(repo, '.petal', '.gitignore'), '*\n');
  put(path.join(repo, '.petal', 'tasks.json'), JSON.stringify({ version: 1, tasks: [task('t-cart', 'Fix the cart total', true), task('t-coupon', 'Coupons'), task('t-docs', 'Document the cart API')] }, null, 2));
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
  const testing = (): Promise<{ scope: string; sessionTaskId: string | null; scopedRuns: number; runs: number } | null> => js("PastelTerm.testing.isOpen() ? PastelTerm.testing.state() : null");
  const scopeLine = (): Promise<{ pressed: string | null; label: string; disabled: string[] }> => js(`(() => ({
    pressed: document.querySelector('#testing .tst-scope-option[aria-pressed="true"]')?.dataset.scope ?? null,
    label: document.querySelector('#testing .tst-scope-label')?.textContent ?? '',
    disabled: [...document.querySelectorAll('#testing .tst-scope-option:disabled')].map((b) => b.dataset.scope),
  }))()`);

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
    await submit('#board .task-split');
    const split = await waitFor(async () => { const g = await groups(); return g[0]?.subtasks.length === 2 ? g : null; }, 4000);
    check(JSON.stringify(split?.[0]?.subtasks) === JSON.stringify(['Coupon API', 'Coupon UI']), `the split task shows two subtasks: ${JSON.stringify(split ?? await groups())}`);
    const stored = JSON.parse(fs.readFileSync(tasksJson, 'utf8')) as { version: number; prds: { id: string }[]; tasks: { id: string; title: string; prdId: string | null; parentId: string | null }[] };
    const subtask = stored.tasks.find((t) => t.title === 'Coupon API');
    check(stored.version === 2 && stored.prds.length === 1 && subtask?.parentId === 't-coupon' && subtask.prdId === prdId, `written back as version 2 with the PRD and subtasks: ${JSON.stringify(stored.tasks.map((t) => [t.title, t.prdId, t.parentId]))}`);
    await capture('prd-board');
    await js('PastelTerm.sessionsBoard.close()');

    // 4 Testing from the session holding "Fix the cart total": two runs for it, one for a subtask in the PRD, one untagged.
    testingFixture.project = repo;
    testingFixture.claudeDir = path.join(dir, 'claude');
    fs.mkdirSync(testingFixture.claudeDir, { recursive: true });
    for (const r of [run('prd-run-old', 300, 'passed', null), run('prd-run-sub', 90, 'failed', subtask?.id ?? null), run('prd-run-a1', 60, 'failed', 't-cart'), run('prd-run-a2', 20, 'passed', 't-cart')]) putRun(repo, r);
    put(path.join(repo, '.petal', 'test-criteria.md'), `# Test criteria\n\n## Scenarios\n- [pass] cart total rounds to the cent · test: src/cart.test.ts::rounds · round 1 · task: t-cart\n- [fail] two coupons stack · round 1 · task: ${subtask?.id ?? 'none'}\n- [pass] an old scenario · round 1\n\n## Bugs\n- [fixed] total off by a cent · test: src/cart.test.ts::cent · round 1 · task: t-cart\n`);
    await js('document.getElementById("testing-button").click()');
    const scopedTask = await waitFor(async () => { const s = await testing(); return s?.scope === 'task' && s.sessionTaskId === 't-cart' && s.scopedRuns === 2 ? s : null; }, 8000);
    check(scopedTask, `opens scoped to This task with its 2 runs: ${JSON.stringify(scopedTask ?? await testing())}`);
    const line = await scopeLine();
    check(line.pressed === 'task' && line.label === 'Fix the cart total' && !line.disabled.length, `the switch shows This task pressed and names it: ${JSON.stringify(line)}`);
    const crit: string[] = await js("[...document.querySelectorAll('#testing .tst-crit-name')].map((n) => n.textContent)");
    check(JSON.stringify(crit) === JSON.stringify(['cart total rounds to the cent', 'total off by a cent']), `criteria show this task's scenario and bug only: ${JSON.stringify(crit)}`);
    const editLabel: string = await js("document.querySelector('#testing .tst-head .tst-button')?.title ?? ''");
    check(/project’s commands/.test(editLabel), `Edit pipeline says the commands are the project's: ${editLabel}`);
    await capture('testing-task-scope');

    // 5 PRD adds the subtask's run; Whole project adds the untagged one.
    await js("document.querySelector('#testing .tst-scope-option[data-scope=\"prd\"]').click()");
    const prd = await waitFor(async () => { const s = await testing(); return s?.scope === 'prd' && s.scopedRuns === 3 ? s : null; }, 3000);
    check(prd && (await scopeLine()).label === 'Checkout', `PRD rolls up the subtask's run under Checkout: ${JSON.stringify(prd ?? await testing())}`);
    await capture('testing-prd-scope');
    await js("document.querySelector('#testing .tst-scope-option[data-scope=\"project\"]').click()");
    const whole = await waitFor(async () => { const s = await testing(); return s?.scope === 'project' && s.scopedRuns >= 4 && s.scopedRuns === s.runs ? s : null; }, 3000);
    check(whole, `Whole project shows every run, the untagged one too: ${JSON.stringify(whole ?? await testing())}`);
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
