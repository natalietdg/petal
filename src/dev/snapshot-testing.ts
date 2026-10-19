/// <reference types="vite/client" />
// Testing: a fixture project (vitest, .maestro flows, a prove-it skill) shows its stack and its one task's suite;
// Run suite confirms the exact commands, then records the line a new tab would run (never executed);
// fixture exit codes and a real vitest JSON report finish it; results group with failures first; Send to bug fix agent
// starts the task's bug fix agent on the failure (Ask in this session instead records the paste); Claude's runs in the fixture log land in history as rows that say what ran, why, what changed and
// how long it took; a tab in ~ picks a Claude session instead; a task with no suite starts one from Claude's checks;
// a repo with no tasks gives the tab's session one, and its drafting agent a lane; editing saves; every theme, style and width fits.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { resizeOffscreen } from '../main/snapshot-window';
import { extraTabFixtures, fixtureFile, historyFixture, panelFixture, pasteWrites, testingFixture, type FixtureSession } from '../main/snapshot-mode';
import { READING_CHOICES } from '../main/menu';
import * as store from '../main/testing-store';
import { writeSuite } from '../main/task-suites';
import { sessions } from '../main/tabs';
import { agentView, findAgent } from '../main/test-agents';
import vitestOutput from '../../test/fixtures/testing/vitest-output.txt?raw';
import vitestReport from '../../test/fixtures/testing/vitest-report.json?raw';

const MIN_RATIO = 4.5;
const WIDTHS = [800, 1280, 1600];
// Bundled at build time: the packaged app has no test/ folder.
const FIXTURES: Record<string, string> = { 'vitest-output.txt': vitestOutput, 'vitest-report.json': vitestReport };
const fixtureOutput = (name: string): string => {
  const text = FIXTURES[name];
  if (text === undefined) throw new Error(`no bundled testing fixture ${name}`);
  return text;
};
const put = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// A fake project and Claude folder under the snapshot folder; nothing of hers.
export function seedTestingProject(outDir: string): { project: string; claudeDir: string; bare: string } {
  const project = path.join(outDir, 'testing-fixture', 'acme');
  const bare = path.join(outDir, 'testing-fixture', 'notes-app'); // a repo with nothing to detect: no stages
  const claudeDir = path.join(outDir, 'testing-fixture', 'claude');
  fs.rmSync(path.dirname(project), { recursive: true, force: true });
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  fs.mkdirSync(path.join(bare, '.git'), { recursive: true });
  put(path.join(project, 'package.json'), JSON.stringify({
    name: 'acme', scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' },
    devDependencies: { vitest: '^5.0.0', typescript: '^5.9.0', '@testing-library/react': '^16.0.0' },
  }, null, 2));
  put(path.join(project, '.maestro', 'login.yaml'), 'appId: com.acme.app\n---\n- launchApp\n- tapOn: Sign in\n');
  put(path.join(project, '.maestro', 'checkout.yaml'), 'appId: com.acme.app\n---\n- launchApp\n- tapOn: Place order\n');
  put(path.join(project, '.github', 'workflows', 'ci.yml'), 'jobs:\n  test:\n    steps:\n      - run: npm ci\n      - run: npm test\n');
  put(path.join(claudeDir, 'skills', 'prove-it', 'SKILL.md'), '---\nname: prove-it\ndescription: Verify that claimed changes actually landed in the running app.\n---\n');
  put(path.join(claudeDir, 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: Ship the app to staging.\n---\n');
  put(path.join(claudeDir, 'agents', 'qa-runner.md'), '---\nname: qa-runner\ndescription: Runs the e2e suite and reports failures.\n---\n');
  seedTask(project, FIXTURE_TASK, 'Settings screen', [['Typecheck', 'npm run typecheck'], ['Unit', 'npm test'], ['Mobile flows', 'maestro test .maestro']]);
  seedTask(bare, 't-notes', 'Sort notes by date', null);
  return { project, claudeDir, bare };
}

export const FIXTURE_TASK = 't-settings';
const PICK_NEW = '5e550000-0000-4000-8000-0000000000a1'; // the session picker's fixture sessions
const PICK_LOOSE = '5e550000-0000-4000-8000-0000000000a2';
const PICK_NOTES = '5e550000-0000-4000-8000-0000000000a3';
const PICK_AGENT = '5e550000-0000-4000-8000-0000000000a4'; // the notes task's testing agent
const tasksJson = (repo: string): string => path.join(repo, '.petal', 'tasks.json');
export const FIXER_SESSION = '7e570000-0000-4000-8000-0000000000f1';

// The terminal main says runs an agent in a window: the one following its session, else the one it is starting in.
export function hostOf(contentsId: number, root: string, sessionId: string | null): string | null {
  const agent = findAgent(root, sessionId);
  return agent ? agentView(root, agent, contentsId).hostTabId : null;
}

// Every agent terminal Testing opened, in any window (popped-out ones included).
export const agentTerminals = (): string[] => [...sessions.values()].filter((s) => s.agent).map((s) => s.tabId);

// Closes every tab-bar tab not in startTabs and every agent terminal; true once only startTabs remain.
export async function closeExtraTabs({ js, waitFor }: Pick<Kit, 'js' | 'waitFor'>, startTabs: readonly string[]): Promise<boolean> {
  const extra = [...((await js('PastelTerm.tabs.ids()')) as string[]).filter((t) => !startTabs.includes(t)), ...agentTerminals()];
  for (const id of new Set(extra)) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(id)})`);
  return Boolean(await waitFor(async () => (!agentTerminals().length && JSON.stringify(await js('PastelTerm.tabs.ids()')) === JSON.stringify(startTabs)) || null, 8000));
}

// A loop step's cleanup: Stop if the loop still runs, then close the agent terminals and tabs it opened.
export async function endLoop(kit: Pick<Kit, 'js' | 'waitFor'>, startTabs: readonly string[]): Promise<boolean> {
  const { js, waitFor } = kit;
  const running = async () => ['starting', 'running'].includes(await js('PastelTerm.testing.state().loop'));
  if (await running()) {
    await js("document.querySelector('#testing .tst-stop')?.click()");
    await waitFor(async () => !(await running()) || null, 8000);
  }
  return closeExtraTabs(kit, startTabs);
}

// The loop's two agents in snapshot runs: the fixture session plays the testing agent, so its replies and Loop lines
// drive the loop as before; the bug fix agent gets its own fixture tab and log. The tester's new tab follows an empty
// log under the same id, so the fixture's own tab is the one Testing finds first.
export function useAgentFixtures(outDir: string, testerId = 'snapshot-fixture'): { fixer: FixtureSession; fixerLog: string } {
  const dir = path.join(outDir, 'testing-fixture', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  const testerLog = path.join(dir, 'tester-tab.jsonl');
  const fixerLog = path.join(dir, `${FIXER_SESSION}.jsonl`);
  fs.writeFileSync(testerLog, '');
  fs.writeFileSync(fixerLog, `${JSON.stringify({ isSidechain: false, type: 'user', uuid: 'fixer-u0', sessionId: FIXER_SESSION, timestamp: new Date().toISOString(), message: { role: 'user', content: 'You are the bug fix agent.' } })}\n`);
  const fixer: FixtureSession = { sessionId: FIXER_SESSION, transcript: fixerLog, status: 'idle', cwd: testingFixture.project ?? undefined };
  testingFixture.agentIds.splice(0, Infinity, testerId, FIXER_SESSION);
  extraTabFixtures.push({ sessionId: testerId, transcript: testerLog, status: 'idle' }, fixer);
  return { fixer, fixerLog };
}

// One task held by the fixture session since before its first logged run, so Claude's runs file under it; its suite if given.
function seedTask(repo: string, id: string, title: string, stages: [string, string][] | null): void {
  const owner = { sessionId: 'snapshot-fixture', name: 'Fixture', branch: 'main' };
  const task = { id, title, notes: '', status: 'working', owner, createdAt: Date.now() - 4 * 86_400_000, claimedAt: Date.now() - 3 * 86_400_000, doneAt: null, doneBy: null, prdId: null, parentId: null };
  put(path.join(repo, '.petal', '.gitignore'), '*\n');
  put(path.join(repo, '.petal', 'tasks.json'), JSON.stringify({ version: 2, prds: [], tasks: [task] }, null, 2));
  if (stages) put(path.join(repo, '.petal', 'suites', `${id}.json`), JSON.stringify({ stages: stages.map(([name, command]) => ({ name, command })), keepGoing: false, autoRun: false }, null, 2));
}

const VITEST_PASS = (n: number) => ` ✓ src/theme.test.ts (${n} tests) 4ms\n\n Test Files  1 passed (1)\n      Tests  ${n} passed (${n})\n`;
const JEST_PASS = 'PASS src/notes.test.ts\nTests:       12 passed, 12 total\n';

// Claude's checks in the fixture session, oldest first: yesterday's suite, a repeated theme test, a jest call that
// printed nothing, a typecheck, then the failing unit run (newest, so Unit shows failed); two in notes-app via cd.
export function appendClaudeRun(transcript: string, cwd: string, bare = ''): void {
  let n = 0;
  const lines: string[] = [];
  const line = (o: object, minutesAgo: number, s = 0) => lines.push(`${JSON.stringify({ isSidechain: false, timestamp: new Date(Date.now() - minutesAgo * 60000 + s * 1000).toISOString(), cwd, ...o })}\n`);
  const prompt = (text: string, minutesAgo: number) => line({ type: 'user', uuid: `tst-p${minutesAgo}`, message: { role: 'user', content: text } }, minutesAgo, -5);
  const bash = (command: string, output: string, minutesAgo: number, seconds: number, failed = false) => {
    n += 1;
    line({ type: 'assistant', uuid: `tst-a${n}`, message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_tst_${n}`, name: 'Bash', input: { command } }] } }, minutesAgo);
    line({ type: 'user', uuid: `tst-u${n}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_tst_${n}`, is_error: failed, content: failed ? `Exit code 1\n${output}` : output }] } }, minutesAgo, seconds);
  };
  prompt('set up the settings screen with a theme picker', 26 * 60);
  bash('npx vitest run', VITEST_PASS(5), 26 * 60, 9);
  if (bare) {
    prompt('make the notes list sort by date', 60);
    bash(`cd ${bare} && npx jest`, JEST_PASS, 60, 12);
    bash(`cd ${bare} && npx tsc --noEmit`, '', 59, 6);
  }
  prompt('add a dark mode toggle to the settings screen', 50);
  for (const m of [44, 42, 40]) bash('npx vitest run src/theme', VITEST_PASS(3), m, 4);
  bash('npx jest --listTests > /tmp/jest-list.txt', '', 36, 2);
  bash('npm run typecheck 2>&1 | tail -n 20', '', 22, 7);
  bash('npx vitest run', fixtureOutput('vitest-output.txt'), 20, 6, true);
  fs.appendFileSync(transcript, lines.join(''));
}

const PROBE = `(() => {
  const view = document.getElementById('testing');
  if (!view || view.hidden) return null;
  const rgb = (s) => (s.match(/[\\d.]+/g) ?? []).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const backOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c; } return [255, 255, 255]; };
  const ratio = (el) => { const a = lum(rgb(getComputedStyle(el).color)), b = lum(backOf(el)); const [hi, lo] = a > b ? [a, b] : [b, a]; return Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100; };
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const texts = [...view.querySelectorAll('.tst-run-why, .tst-run-result, .tst-run-change, .tst-run-failing, .tst-day, .tst-other, .tst-axis, .tst-pick-name, .tst-pick-path, .tst-pick-agents, .tst-pick-suite, .tst-picker-title, .tst-title, .tst-summary, .tst-button:not(:disabled), .tst-link, .tst-note span, .tst-stage-name, .tst-stage-meta, .tst-stage-run:not(:disabled), .tst-section-title, .tst-sub, .tst-count, .tst-facts span, .tst-command, .tst-fix, .tst-group-file, .tst-group-tally, .tst-row-name, .tst-row-time, .tst-failure code, .tst-trend-label, .tst-run-name, .tst-by, .tst-run-meta, .tst-tool-name, .tst-kind, .tst-tool-detail, .tst-found, .tst-insert, .tst-muted, .tst-empty, .tst-confirm-title, .tst-confirm code, .tst-confirm-name, .tst-new, .tst-input, .tst-toggle span')].filter(visible);
  const worst = texts.map((t) => [ratio(t), t.className || t.tagName, t.textContent.slice(0, 30)]).sort((a, b) => a[0] - b[0])[0] ?? [99];
  const chips = [...view.querySelectorAll('.tst-stage-item')].map((li) => [li.querySelector('.tst-stage-name')?.textContent, [...li.classList].find((c) => c.startsWith('is-'))?.slice(3)]);
  const history = [...view.querySelectorAll('.tst-day, .tst-runs > li > .tst-run, .tst-other')].map((n) => n.textContent);
  const groups = [...view.querySelectorAll('.tst-group')].map((g) => [g.querySelector('.tst-group-file')?.textContent, g.open, g.classList.contains('is-failed')]);
  return {
    state: PastelTerm.testing.state(),
    chips,
    groups,
    chipHeights: [...view.querySelectorAll('.tst-stage')].map((c) => Math.round(c.getBoundingClientRect().height)),
    tools: [...view.querySelectorAll('.tst-tool')].map((t) => [t.querySelector('.tst-tool-name')?.textContent, t.querySelector('.tst-found')?.textContent]),
    confirm: view.querySelector('.tst-confirm')?.hidden ? null : [...view.querySelectorAll('.tst-confirm-list code')].map((c) => c.textContent),
    runs: [...view.querySelectorAll('.tst-run')].map((r) => r.textContent),
    history,
    chartLabels: [...view.querySelectorAll('.tst-trend-label')].map((n) => n.textContent),
    timedParts: [...view.querySelectorAll('.tst-durations .tst-part')].filter((p) => parseFloat(p.style.height) > 0).length,
    picker: [...view.querySelectorAll('.tst-pick')].map((b) => [b.querySelector('.tst-pick-name')?.textContent, b.querySelector('.tst-pick-path')?.textContent, b.querySelector('.tst-pick-agents')?.textContent ?? null]),
    noSuite: Boolean(view.querySelector('.tst-no-suite')),
    askSuite: Boolean(view.querySelector('.tst-ask-suite')),
    drawing: view.querySelector('.tst-drawing')?.textContent ?? null,
    pickerTitle: view.querySelector('.tst-picker-title')?.textContent ?? '',
    makePipeline: Boolean(view.querySelector('.tst-make-pipeline')),
    head: view.querySelector('.tst-summary')?.textContent ?? '',
    bars: view.querySelectorAll('.tst-bar').length,
    sumbar: view.querySelector('.tst-sumbar')?.textContent ?? '',
    failRows: [...view.querySelectorAll('.tst-row.is-failed .tst-row-name')].map((n) => n.textContent),
    note: view.querySelector('.tst-note')?.hidden ? '' : view.querySelector('.tst-note')?.textContent ?? '',
    pressed: document.getElementById('testing-button').getAttribute('aria-pressed'),
    minRatio: worst[0],
    worst,
    overflowX: Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, view.scrollWidth - view.clientWidth),
    inWindow: [...view.querySelectorAll('.tst-head, .tst-results, .tst-side, .tst-group, .tst-tool')].filter(visible).every((n) => { const b = n.getBoundingClientRect(); return b.left >= -1 && b.right <= window.innerWidth + 1; }),
  };
})()`;

type Probe = { state: { project: string | null; task: string | null; target: unknown; stages: string[]; runs: number; editing: boolean; confirming: string[] | null; elsewhere: { reason: string } | null }; history: string[]; [k: string]: unknown };

export async function testingCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} testing: ${what}`);
  const probe = (): Promise<Probe | null> => js(PROBE);
  const settle = async (want: (p: Probe) => boolean = () => true, ms = 6000) => waitFor(async () => { const p = await probe(); return p && want(p) ? p : null; }, ms);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  const setReading = async (look: string) => {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
  };

  const { project, claudeDir, bare } = seedTestingProject(outDir);
  testingFixture.project = project;
  testingFixture.claudeDir = claudeDir;
  testingFixture.runs.length = 0;
  const transcript = fixtureFile();
  if (transcript) appendClaudeRun(transcript, project, bare);
  await js('PastelTerm.getStarted.close()');
  await js('PastelTerm.overlays.hideCurrent()');
  const [startWidth, startHeight] = win.getContentSize();
  const startTabs = await js('PastelTerm.tabs.ids()') as string[];
  try {
    resizeOffscreen(win, 1280, 900);
    await wait(1200); // the reader takes in the appended Claude run

    // Opens from the dock on the session's task; the stack comes from the fixture files, the stages from the task's suite.
    await click('#testing-button');
    const opened = await settle((p) => p.state.project === 'acme' && (p.tools as unknown[]).length > 2);
    check(opened?.pressed === 'true', 'the Testing button shows pressed');
    const tools = (opened?.tools ?? []) as [string, string][];
    const found = (name: string) => tools.find(([n]) => n === name);
    check(found('Vitest')?.[1] === 'found in package.json', `Vitest found in package.json: ${JSON.stringify(found('Vitest'))}`);
    check(/found in \.maestro\//.test(found('Maestro')?.[1] ?? ''), `Maestro found in .maestro: ${JSON.stringify(found('Maestro'))}`);
    check(found('prove-it')?.[1] === 'found in user skills' && !found('deploy'), `prove-it skill listed, deploy not: ${JSON.stringify(found('prove-it'))}`);
    check(found('qa-runner') && found('CI'), 'the qa-runner agent and the CI workflow are listed');
    check(JSON.stringify(opened?.state.stages) === JSON.stringify(['Typecheck', 'Unit', 'Mobile flows']), `the task's stages: ${JSON.stringify(opened?.state.stages)}`);
    check(opened && opened.head === 'Settings screen · No PRD · 3 stages' && !/acme/.test(opened.head as string), `the header names the task, not the project: ${opened?.head}`);

    // Claude's run from the fixture log, mapped onto the Unit stage, labelled by Claude.
    const claude = await settle((p) => (p.runs as string[]).some((r) => /by Claude/.test(r)));
    check(claude && (claude.chips as string[][]).some(([n, s]) => n === 'Unit' && s === 'failed'), `Claude's failing vitest run lands on Unit: ${JSON.stringify(claude?.chips)}`);
    check(claude && /by Claude/.test(claude.sumbar as string), `its results say by Claude: ${String(claude?.sumbar).slice(0, 80)}`);

    // History rows say what ran, why, what changed and how long; repeats collapse; the jest call with no output folds.
    const rows = (await settle((p) => p.history.length >= 6))?.history ?? [];
    const rowOf = (re: RegExp) => rows.find((r) => re.test(r)) ?? '';
    check(rows[0] === 'Today' && rows.includes('Yesterday'), `grouped by day: ${JSON.stringify(rows.filter((r) => r.length < 12))}`);
    check(/^Unit.*by Claude/.test(rowOf(/1 newly failing/)) && /while: add a dark mode toggle/.test(rowOf(/1 newly failing/)) && /auth\.test\.js › rejects an expired token/.test(rowOf(/1 newly failing/)), `the failing unit run names the new failure and the prompt: ${rowOf(/1 newly failing/)}`);
    check(/1 failed · 4 passed · 1 skipped · 6\.0s/.test(rowOf(/1 newly failing/)), `with counts and the time from the log: ${rowOf(/1 newly failing/)}`);
    check(/^Typecheck.*Passed · 7\.0s/.test(rowOf(/^Typecheck/)), `Claude's typecheck lands on Typecheck with a time: ${rowOf(/^Typecheck/)}`);
    check(/×3 · last/.test(rowOf(/×3/)), `three identical theme runs collapse: ${rowOf(/×3/)}`);
    check(rows.some((r) => /^1 other command, no test results$/.test(r)), `the jest call with no results folds: ${JSON.stringify(rows.filter((r) => /other/.test(r)))}`);
    check(!rows.some((r) => /Claude’s run/.test(r)) && !rows.some((r) => /notes-app|npx jest(?! --listTests)/.test(r)), 'no row is titled "Claude’s run"; notes-app’s runs stay out of acme');
    const chart = await probe();
    check(JSON.stringify(chart?.chartLabels) === JSON.stringify(['Pass rate · last 6 runs', 'Stage time · seconds per stage, last 6 runs']) && (chart?.timedParts as number) >= 6, `the chart is labelled and has times: ${JSON.stringify(chart?.chartLabels)} ${chart?.timedParts} timed`);
    await click('#testing .tst-repeats');
    check(await settle((p) => (p.runs as string[]).length > (chart?.runs as string[]).length, 3000), 'a collapsed row opens to its repeats');
    await js("document.querySelector('#testing .tst-history')?.scrollIntoView({ block: 'start' })");
    await wait(150);
    await capture('testing-history');

    // Run suite: a confirm naming each exact command; nothing recorded yet.
    const tabsBefore = await js('PastelTerm.tabs.ids().length') as number;
    await click('#testing .tst-head .tst-primary');
    const asked = await settle((p) => Array.isArray(p.confirm));
    check(JSON.stringify(asked?.confirm) === JSON.stringify(['npm run typecheck', 'npm test', 'maestro test .maestro']), `the confirm names the exact commands: ${JSON.stringify(asked?.confirm)}`);
    check(testingFixture.runs.length === 0, 'nothing runs before the confirm');
    await capture('testing-confirm');
    await click('#testing .tst-confirm-run');
    const recorded = await waitFor(() => testingFixture.runs[0] ?? null, 5000);
    check(recorded && /^sh '.+pipeline\.sh'\r$/.test(recorded.typed), `the new tab's line runs Petal's run script: ${JSON.stringify(recorded?.typed)}`);
    const script = recorded ? fs.readFileSync(recorded.script, 'utf8') : '';
    check(recorded && recorded.stages[1].exec.includes("npm test -- --reporter=default --reporter=json --outputFile.json='") && script.includes("'npm test'") && script.includes('maestro test .maestro --format junit --output'), 'the script runs each command with a reporter added');
    check(await waitFor(async () => ((await js('PastelTerm.tabs.ids().length')) as number) === tabsBefore + 1 || null, 4000), 'it opened one new tab (snapshot runs type a stand-in, never the commands)');

    // Fixture results: typecheck passes, unit fails with the real vitest report, the pipeline stops there.
    if (recorded) {
      const [tc, unit] = recorded.stages;
      put(tc.log, 'tsc --noEmit\n');
      put(tc.exit, '0\n');
      put(unit.log, fixtureOutput('vitest-output.txt'));
      if (unit.report) put(unit.report, fixtureOutput('vitest-report.json').split('/Users/demo/acme').join(project)); // as if run in the fixture project
      put(unit.exit, '1\n');
      put(path.join(recorded.dir, 'done'), '1\n');
    }
    await js('PastelTerm.overlays.hideCurrent()');
    await click('#testing-button');
    const doneRun = await settle((p) => JSON.stringify(p.chips) === JSON.stringify([['Typecheck', 'passed'], ['Unit', 'failed'], ['Mobile flows', 'skipped']]), 8000);
    check(doneRun && (doneRun.chipHeights as number[]).every((h) => h >= 44), `stage chips are full height: ${JSON.stringify(doneRun?.chipHeights)}`);
    check(doneRun, `stages after the run: ${JSON.stringify((await probe())?.chips)}`);
    const groups = (doneRun?.groups ?? []) as [string, boolean, boolean][];
    check(groups.length === 2 && groups[0][0] === 'src/auth.test.js' && groups[0][2] && groups[0][1] && !groups[1][2] && !groups[1][1], `grouped by file, failing group first and open, passing collapsed: ${JSON.stringify(groups)}`);
    check(JSON.stringify(doneRun?.failRows) === JSON.stringify(['auth > tokens > rejects an expired token']), `the failing test row: ${JSON.stringify(doneRun?.failRows)}`);
    check(/1\s*failed/.test(String(doneRun?.sumbar)) && /4\s*passed/.test(String(doneRun?.sumbar)) && /by you/.test(String(doneRun?.sumbar)), `summary bar: ${String(doneRun?.sumbar).slice(0, 90)}`);
    check(doneRun && (doneRun.bars as number) >= 2 && /^Suite · 3 stages.*by you.*Run suite/.test(doneRun.history[1] ?? ''), `her run is the newest row, titled by what ran: ${JSON.stringify(doneRun?.history.slice(0, 2))}`);
    await capture('testing-pipeline');

    // Edit suite: add a stage, save, and it is kept in the task's file; then back to the three.
    await click('#testing .tst-head .tst-button:not(.tst-primary)');
    const editing = await settle((p) => p.state.editing);
    check(editing && await js("document.querySelectorAll('#testing .tst-edit-row').length") === 3, 'the editor lists the three stages');
    await capture('testing-edit');
    await js("[...document.querySelectorAll('#testing .tst-editor .tst-button')].find((b) => b.textContent === 'Add stage').click()");
    await js("(() => { const rows = document.querySelectorAll('#testing .tst-edit-row'); const last = rows[rows.length - 1]; const [n, c] = last.querySelectorAll('input'); n.value = 'Lint'; n.dispatchEvent(new Event('input')); c.value = 'npm run lint'; c.dispatchEvent(new Event('input')); })()");
    await js("[...document.querySelectorAll('#testing .tst-editor .tst-button')].find((b) => b.textContent === 'Save suite').click()");
    const saved = await settle((p) => !p.state.editing && p.state.stages.length === 4);
    const suiteJson = fs.readFileSync(path.join(project, '.petal', 'suites', `${FIXTURE_TASK}.json`), 'utf8');
    check(saved && saved.state.stages[3] === 'Lint' && suiteJson.includes('"npm run lint"'), `saved with a fourth stage, in the task's suite file: ${JSON.stringify(saved?.state.stages)}`);
    await click('#testing .tst-head .tst-button:not(.tst-primary)');
    await settle((p) => p.state.editing);
    await js("[...document.querySelectorAll('#testing .tst-editor .tst-button')].find((b) => b.textContent === 'Use detected stages').click()");
    await js("[...document.querySelectorAll('#testing .tst-editor .tst-button')].find((b) => b.textContent === 'Save suite').click()");
    check(await settle((p) => !p.state.editing && p.state.stages.length === 3), 'Use detected stages puts back the three detected ones');

    // Every theme and reading style, with a failure open.
    for (const theme of ['paleSky', 'blush', 'nightPastel']) {
      applyTheme(theme, { persist: false });
      for (const [look] of READING_CHOICES) {
        await setReading(look);
        await wait(150);
        const p = await probe();
        check(p && (p.minRatio as number) >= MIN_RATIO && (p.overflowX as number) <= 0, `${theme} ${look}: ${p?.minRatio}:1 ${JSON.stringify(p?.worst)}`);
      }
      if (theme === 'nightPastel') await capture('testing-night');
    }
    applyTheme('paleSky', { persist: false });
    await setReading('newspaper');

    for (const width of WIDTHS) {
      resizeOffscreen(win, width, 900);
      await wait(400);
      const p = await probe();
      check(p && (p.overflowX as number) <= 0 && p.inWindow && (p.chipHeights as number[]).every((h) => h >= 44), `${width}px: overflow ${p?.overflowX}, in window ${p?.inWindow}, chips ${JSON.stringify(p?.chipHeights)}`);
      if (width === 800) await capture('testing-800');
    }
    resizeOffscreen(win, 1280, 900);

    // A skill goes into the reply box, as the "/" menu would put it.
    await click('#testing .tst-insert[data-insert="/prove-it"]');
    const inserted = await waitFor(async () => ((await js("document.getElementById('composer-input').value")) as string).startsWith('/prove-it ') || null, 3000);
    check(inserted && await js("document.getElementById('testing').hidden"), 'Use in reply puts /prove-it in the reply box and shows it');
    await js("(() => { const i = document.getElementById('composer-input'); i.value = ''; i.dispatchEvent(new Event('input')); })()");

    // Send this test to bug fix agent: with no loop running, the task's bug fix agent starts alone on it, in its own
    // terminal with no tab-bar entry, the failure as its brief and the bug already fixing in its queue. Nothing is pasted into the session.
    await click('#testing-button');
    await settle((p) => (p.failRows as string[]).length > 0);
    const fixEstimate: string = await js("document.querySelector('#testing .tst-fix-stage + .tst-ask-here + .tst-fix-estimate')?.textContent ?? ''");
    check(/^About [\d.]+k tokens\. A rough estimate from the brief and typical turns\.$/.test(fixEstimate), `a one-line estimate under Send to bug fix agent: ${JSON.stringify(fixEstimate)}`);
    const pastesBefore = pasteWrites.length;
    const startsBefore = testingFixture.loopStarts.length;
    await click('#testing .tst-row.is-failed .tst-fix');
    const fixerStart = await waitFor(() => testingFixture.loopStarts.slice(startsBefore).find((l) => l.brief?.startsWith('You are Bug fix agent, the bug fix agent')) ?? null, 4000);
    const fixerBrief = fixerStart?.brief ?? '';
    check(fixerBrief.includes('rejects an expired token') && fixerBrief.includes('src/auth.test.js') && fixerBrief.includes('`npm test`') && fixerBrief.includes('Fix the app code only. Never edit tests') && !/[\u2014\u2013]/.test(fixerBrief), `the bug fix agent starts on the failing test, app code only: ${JSON.stringify(fixerBrief.slice(0, 160))}`);
    check(testingFixture.loopStarts.length === startsBefore + 1 && !pasteWrites.slice(pastesBefore).some((w) => w.data.includes('rejects an expired token')), 'only the bug fix agent starts, and nothing is pasted into the session');
    const fixerLoop = await waitFor(() => { const l = store.load(project).loops?.[FIXTURE_TASK]; return l?.queue.length ? l : null; }, 4000);
    check(fixerLoop && fixerLoop.testerSessionId === null && fixerLoop.fixerSessionId && JSON.stringify(fixerLoop.queue.map((b) => [b.name, b.state])) === JSON.stringify([['auth > tokens > rejects an expired token', 'fixing']]), `it is saved as the task's bug fix agent, the bug fixing: ${JSON.stringify(fixerLoop && { tester: fixerLoop.testerSessionId, queue: fixerLoop.queue.map((b) => [b.name, b.state]) })}`);
    const fixerTab = await waitFor(() => hostOf(win.webContents.id, project, fixerLoop?.fixerSessionId ?? null), 10000);
    check(fixerTab && agentTerminals().includes(fixerTab) && !((await js('PastelTerm.tabs.ids()')) as string[]).includes(fixerTab) && (await js('PastelTerm.tabs.active()?.id')) === startTabs[0], `it runs in an agent terminal, off the tab bar, and her tab stays shown: ${fixerTab}`);
    const lanes = await js("PastelTerm.testing.state().agents.lanes.map((l) => [l.role, l.status])") as string[][];
    check(lanes.some(([role, status]) => role === 'fixer' && status.startsWith('Fixing auth > tokens')) && lanes.some(([role, status]) => role === 'tester' && status === 'Not started'), `its lane shows it fixing; the testing agent's is not started: ${JSON.stringify(lanes)}`);

    // A second send of the same test while it is being fixed adds nothing.
    await js('PastelTerm.overlays.hideCurrent()');
    await js(`PastelTerm.tabs.activate(${JSON.stringify(startTabs[0])})`);
    await click('#testing-button');
    await settle((p) => (p.failRows as string[]).length > 0);
    await click('#testing .tst-row.is-failed .tst-fix');
    const deduped = await settle((p) => /already has/.test(String(p.note)), 4000);
    check(deduped && testingFixture.loopStarts.length === startsBefore + 1 && store.load(project).loops?.[FIXTURE_TASK]?.queue.length === 1, `a second send is deduped: ${JSON.stringify(deduped?.note)}`);

    // Ask in this session instead: the old way, back to the session tab, pasted through the reply box's send path.
    await click('#testing .tst-row.is-failed .tst-ask-here');
    const pasted = await waitFor(() => pasteWrites.slice(pastesBefore).find((w) => w.data.includes('rejects an expired token')) ?? null, 4000);
    check(pasted && pasted.data.includes('src/auth.test.js') && pasted.data.includes('`npm test`') && pasted.data.length < 3100, `the fix prompt names the test, file and command: ${JSON.stringify(pasted?.data.slice(0, 140))}`);
    if (fixerTab) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(fixerTab)})`);
    check(await waitFor(() => (fixerTab && !agentTerminals().includes(fixerTab)) || null, 8000), 'the bug fix agent terminal closes again');

    // A tab in the home folder is not a project: pick one of her Claude sessions instead, newest activity first, its repo and status as the small line.
    // Fixture sessions only: a live one in acme with no task (last active 1 h ago), a live one in ~ (left out), a recent one in notes-app holding a task with a suite (2 h ago).
    // The notes task's busy testing agent is not a row of its own: its owner shows its status and sorts first by the agent's activity.
    testingFixture.project = os.homedir();
    const before = { panel: panelFixture.sessions, records: historyFixture.records, acme: fs.readFileSync(tasksJson(project), 'utf8'), notes: fs.readFileSync(tasksJson(bare), 'utf8'), notesStore: store.load(bare) };
    store.save({ ...before.notesStore, agents: { ...(before.notesStore.agents ?? {}), 't-notes-sort': [{ sessionId: PICK_AGENT, role: 'tester' }] } });
    const notesTask = { id: 't-notes-sort', title: 'Sort by date', notes: '', status: 'working', owner: { sessionId: PICK_NOTES, name: 'Notes sorting', branch: 'main' }, createdAt: Date.now() - 7_200_000, claimedAt: Date.now() - 3_600_000, doneAt: null, doneBy: null, prdId: null, parentId: null };
    const notesData = JSON.parse(before.notes) as { tasks: unknown[] };
    put(tasksJson(bare), JSON.stringify({ ...notesData, tasks: [...notesData.tasks, notesTask] }, null, 2));
    // Written as a suite Petal already took: a bare file on a task with a testing agent waits for that agent's log.
    writeSuite(bare, 't-notes-sort', { stages: [{ id: 'unit', name: 'Unit', command: 'npx jest' }], keepGoing: false, autoRun: false });
    panelFixture.sessions = [
      { pid: 0, sessionId: PICK_NEW, cwd: path.join(project, 'src'), kind: 'interactive', status: 'busy', name: 'acme', updatedAt: Date.now() - 3_600_000 },
      { pid: 0, sessionId: PICK_LOOSE, cwd: os.homedir(), kind: 'interactive', status: 'idle', name: 'home', updatedAt: Date.now() },
      { pid: 0, sessionId: PICK_AGENT, cwd: bare, kind: 'interactive', status: 'busy', name: 'Testing agent · Sort by date', updatedAt: Date.now() - 60_000 },
    ];
    const record = (sessionId: string, cwd: string, title: string, lastAt: number) => ({ sessionId, file: path.join(claudeDir, `${sessionId}.jsonl`), cwd, title, firstPrompt: title, lastAt, messages: 4, messagesExact: true });
    historyFixture.records = [record(PICK_NEW, project, 'Polish the settings copy', Date.now() - 3_600_000), record(PICK_LOOSE, os.homedir(), 'Loose ends', Date.now() - 600_000), record(PICK_NOTES, bare, 'Notes sorting', Date.now() - 7_200_000)];
    try {
      await js('PastelTerm.overlays.hideCurrent()');
      await click('#testing-button');
      const home = await settle((p) => p.state.elsewhere?.reason === 'home');
      const wantRows = [['Notes sorting', 'notes-app · closed has a suite', 'Testing agent · busy'], ['Polish the settings copy', 'acme · busy', null]];
      check(home && home.pickerTitle === 'This tab isn’t in a project. Pick a session:' && JSON.stringify(home.picker) === JSON.stringify(wantRows), `home folder shows the session picker, newest first, ~ and the agent session left out, the agent's status on its owner: ${home?.pickerTitle} ${JSON.stringify(home?.picker)}`);
      check(home && home.state.stages.length === 0 && !home.history.length, 'no suite or history for ~');
      await capture('testing-picker');

      // A session holding a task lands on that task's suite; the task select still switches within its repo.
      await click(`#testing .tst-pick[data-session="${PICK_NOTES}"]`);
      const held = await settle((p) => p.state.project === 'notes-app' && JSON.stringify(p.state.target) === JSON.stringify({ kind: 'task', id: 't-notes-sort' }));
      check(held && held.state.task === 'Sort by date' && JSON.stringify(held.state.stages) === JSON.stringify(['Unit']), `a session with a task opens that task's suite: ${JSON.stringify(held?.state.target)} ${JSON.stringify(held?.state.stages)}`);
      await js("(() => { const s = document.querySelector('#testing .tst-task-select'); s.value = 'task:t-notes'; s.dispatchEvent(new Event('change')); })()");
      const notes = await settle((p) => p.state.task === 'Sort notes by date' && Boolean(p.makePipeline));
      check(notes && (notes.history as string[]).some((r) => /^npx jest.*while: make the notes list sort by date.*12 passed/.test(r)), `notes-app shows its own runs: ${JSON.stringify(notes?.history)}`);
      await click('#testing .tst-make-pipeline');
      const made = await settle((p) => p.state.editing);
      const fields = await js("[...document.querySelectorAll('#testing .tst-edit-row')].map((r) => [...r.querySelectorAll('input')].map((i) => i.value))") as string[][];
      check(made && JSON.stringify(fields) === JSON.stringify([['Typecheck', 'npx tsc --noEmit'], ['Unit', 'npx jest']]), `Start from Claude's checks proposes them: ${JSON.stringify(fields)}`);
      await capture('testing-make-pipeline');
      await js("[...document.querySelectorAll('#testing .tst-editor .tst-button')].find((b) => b.textContent === 'Cancel').click()");
      await click('#testing .tst-change-session');
      check(await settle((p) => p.state.elsewhere?.reason === 'home'), 'Change session goes back to the picker');

      // A session with no task gets exactly one, titled with its name and given to it, and lands on its no-suite screen.
      await click(`#testing .tst-pick[data-session="${PICK_NEW}"]`);
      const fresh = await settle((p) => p.state.project === 'acme' && p.state.task === 'Polish the settings copy' && Boolean(p.noSuite));
      const owned = (JSON.parse(fs.readFileSync(tasksJson(project), 'utf8')) as { tasks: { id: string; title: string; owner: { sessionId: string } | null }[] }).tasks.filter((t) => t.owner?.sessionId === PICK_NEW);
      check(owned.length === 1 && owned[0]?.title === 'Polish the settings copy', `one task made for the session, owned by it: ${JSON.stringify(owned)}`);
      check(fresh && JSON.stringify(fresh.state.target) === JSON.stringify({ kind: 'task', id: owned[0]?.id }) && fresh.state.stages.length === 0, `it opens on that task's no-suite screen: ${JSON.stringify(fresh?.state.target)}`);
      await click('#testing .tst-change-session');
      check(await settle((p) => p.state.elsewhere?.reason === 'home'), 'Change session goes back to the picker again');
    } finally {
      panelFixture.sessions = before.panel;
      historyFixture.records = before.records;
      store.save({ ...store.load(bare), agents: before.notesStore.agents, suites: before.notesStore.suites });
      put(tasksJson(project), before.acme);
      put(tasksJson(bare), before.notes);
      fs.rmSync(path.join(bare, '.petal', 'suites', 't-notes-sort.json'), { force: true });
      testingFixture.project = project;
    }

    // A repo with no tasks: the tab's Claude session gets one silently, and Testing lands on its no-suite screen.
    const emptyRepo = path.join(outDir, 'testing-fixture', 'empty-app');
    const noClaudeRepo = path.join(outDir, 'testing-fixture', 'empty-shell');
    for (const repo of [emptyRepo, noClaudeRepo]) fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    const plainTab = ((await js('PastelTerm.tabs.ids()')) as string[]).find((t) => !startTabs.includes(t)) ?? null; // Run suite's tab: a shell, no Claude
    testingFixture.project = emptyRepo;
    try {
      await js('PastelTerm.overlays.hideCurrent()');
      await click('#testing-button');
      const given = await settle((p) => p.state.project === 'empty-app' && Boolean(p.noSuite));
      const made = fs.existsSync(tasksJson(emptyRepo)) ? (JSON.parse(fs.readFileSync(tasksJson(emptyRepo), 'utf8')) as { tasks: { id: string; owner: { sessionId: string } | null }[] }).tasks : [];
      check(given && made.length === 1 && made[0]?.owner?.sessionId === 'snapshot-fixture' && JSON.stringify(given.state.target) === JSON.stringify({ kind: 'task', id: made[0]?.id }), `the tab's session gets one task and its no-suite screen: ${JSON.stringify({ target: given?.state.target, made })}`);
      check(!(await js("document.querySelector('#testing .tst-no-tasks')")), 'no "add a task on the Board" dead end');
      const askEstimate: string = await js("document.querySelector('#testing .tst-no-suite .tst-ask-estimate')?.textContent ?? ''");
      check(/^About [\d.]+k tokens\. A rough estimate from the brief and typical turns\.$/.test(askEstimate), `a one-line estimate under Ask Claude to draw one up: ${JSON.stringify(askEstimate)}`);


      // Ask Claude: the testing agent drawing up the suite gets a lane (chat, action log, tokens) before any suite exists.
      const startsBefore = testingFixture.loopStarts.length;
      await click('#testing .tst-ask-suite');
      const asked = await waitFor(() => testingFixture.loopStarts.slice(startsBefore).find((l) => l.brief?.includes('You are this task\'s testing agent')) ?? null, 4000);
      check(asked?.brief && !asked.brief.startsWith('/petal-testing-suite') && asked.brief.includes('Write `.petal/suites/<task id>.json`') && !fs.existsSync(path.join(testingFixture.claudeDir ?? outDir, 'skills', 'petal-testing-suite')), `with the skill missing, the brief carries its bundled instructions and nothing is installed: ${JSON.stringify(asked?.brief?.slice(0, 60))}`);
      const lane = await waitFor<{ roles: string[]; chat: boolean; views: number; tokens: string | null; queue: boolean; events: string[] } | null>(() => js(`(() => {
        const box = document.querySelector('#testing .tst-agentsbox');
        const lanes = box && !box.hidden ? [...box.querySelectorAll('.tst-agent-lane')] : [];
        const tokens = box?.querySelector('.tst-agent-tokens')?.textContent ?? null;
        return lanes.length && tokens ? { roles: lanes.map((l) => l.dataset.role), chat: !!box.querySelector('.tst-agent-chat'), views: box.querySelectorAll('.tst-agent-view').length, tokens, queue: !!box.querySelector('.tst-queue'), events: PastelTerm.testing.state().agents.events.tester.map((e) => e.text) } : null;
      })()`), 8000);
      check(asked && lane && JSON.stringify(lane.roles) === JSON.stringify(['tester']) && lane.chat && lane.views === 2 && /^[\d.]+k? tokens( \([\d.]+k? of them cached reads\))?$/.test(lane.tokens ?? '') && !lane.queue, `the drafting agent has its own lane before a suite exists: ${JSON.stringify(lane)}`);
      const draft = store.load(emptyRepo).loops?.[made[0]?.id ?? ''];
      check(draft?.kind === 'draft' && draft.fixerSessionId === null && lane?.events.some((t) => /^Started Testing agent to draw up the suite$/.test(t)), `the draft is saved with its agent, and its start shows in the lane: ${JSON.stringify(draft && { kind: draft.kind, events: draft.events.tester })}`);
      await capture('testing-draft-lane');

      // Ask Claude starts the agent in its own terminal, off the tab bar; while it draws, a status replaces the button and main refuses a second.
      const agentTab = await waitFor(() => hostOf(win.webContents.id, emptyRepo, draft?.testerSessionId ?? null), 10000);
      check(agentTab && agentTerminals().includes(agentTab) && !((await js('PastelTerm.tabs.ids()')) as string[]).includes(agentTab), `the drafting agent runs in an agent terminal with no tab-bar entry: ${agentTab}`);
      const drawing = await settle((p) => p.drawing !== null);
      check(drawing && drawing.drawing === 'Testing agent is drawing up the suite' && !drawing.askSuite, `a status replaces Ask Claude while the agent draws: ${JSON.stringify({ drawing: drawing?.drawing, ask: drawing?.askSuite })}`);
      const startsNow = testingFixture.loopStarts.length;
      const again = await js(`window.pastel.testing.agentStart({ tabId: ${JSON.stringify(startTabs[0])}, root: ${JSON.stringify(emptyRepo)}, taskId: ${JSON.stringify(made[0]?.id)}, prompt: 'again' })`) as { note?: string };
      check(again?.note === 'This task’s testing agent is already drawing up its suite.' && testingFixture.loopStarts.length === startsNow, `a second start for the task is refused: ${JSON.stringify(again)}`);
      await click('#testing .tst-show-draft');
      const shown = await waitFor(() => js(`(() => { const lane = PastelTerm.testing.state().agents.lanes.find((l) => l.role === 'tester'); return lane?.mounted === ${JSON.stringify(agentTab)} && document.querySelector('#testing .tst-agent-lane.is-tester .tst-agent-term .term-host') ? lane.mounted : null; })()`), 3000);
      check(shown, `Show terminal mounts the drafting agent's terminal in its lane: ${JSON.stringify(shown)}`);

      // A tab with no Claude in a repo with no tasks: one line, and no task is made.
      testingFixture.project = noClaudeRepo;
      await js('PastelTerm.overlays.hideCurrent()');
      if (plainTab) await js(`PastelTerm.tabs.activate(${JSON.stringify(plainTab)})`);
      await click('#testing-button');
      const line = await waitFor<string | null>(() => js("document.querySelector('#testing .tst-no-tasks')?.textContent ?? null"), 6000);
      check(plainTab && line === 'Start Claude in this tab to give it a test suite.' && !fs.existsSync(tasksJson(noClaudeRepo)), `a tab without Claude gets one line and no task: ${JSON.stringify(line)}`);
    } finally {
      await js('PastelTerm.overlays.hideCurrent()');
      await js(`PastelTerm.tabs.activate(${JSON.stringify(startTabs[0])})`);
      testingFixture.project = project;
    }

    // Esc closes it.
    await click('#testing-button');
    await settle();
    await js("document.getElementById('testing').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    check(await waitFor(async () => (await js("document.getElementById('testing').hidden")) || null, 3000), 'Esc closes Testing');
  } finally {
    testingFixture.project = null;
    testingFixture.claudeDir = null;
    await js('PastelTerm.overlays.hideCurrent()');
    await js('PastelTerm.testing.resetLeftovers()'); // the history row it opened to its repeats
    // Run suite's tab and the drafting agent's terminal: later steps (Get started) count tabs from a clean start.
    check(await closeExtraTabs(kit, startTabs), `the run's tab and the agent terminals closed again: ${JSON.stringify(await js('PastelTerm.tabs.ids()'))}`);
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
