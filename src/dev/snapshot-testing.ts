// Testing: a fixture project (vitest, .maestro flows, a prove-it skill) shows its stack and a proposed pipeline;
// Run pipeline confirms the exact commands, then records the line a new tab would run (never executed);
// fixture exit codes and a real vitest JSON report finish it; results group with failures first; Ask Claude to fix
// records the paste; a Claude run in the fixture log lands in history; editing saves; every theme, style and width fits.
import fs from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { resizeOffscreen } from '../main/snapshot-window';
import { fixtureFile, pasteWrites, testingFixture } from '../main/snapshot-mode';
import { READING_CHOICES } from '../main/menu';

const MIN_RATIO = 4.5;
const WIDTHS = [800, 1280, 1600];
const fixtureOutput = (name: string) => fs.readFileSync(path.join(app.getAppPath(), 'test', 'fixtures', 'testing', name), 'utf8');
const put = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// A fake project and Claude folder under the snapshot folder; nothing of hers.
export function seedTestingProject(outDir: string): { project: string; claudeDir: string } {
  const project = path.join(outDir, 'testing-fixture', 'acme');
  const claudeDir = path.join(outDir, 'testing-fixture', 'claude');
  fs.rmSync(path.dirname(project), { recursive: true, force: true });
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
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
  return { project, claudeDir };
}

// Claude ran the unit tests in the fixture session: a Bash call and its failing result.
export function appendClaudeRun(transcript: string, cwd: string, minutesAgo = 20): void {
  const at = (s: number) => new Date(Date.now() - minutesAgo * 60000 + s * 1000).toISOString();
  const line = (o: object, s: number) => `${JSON.stringify({ isSidechain: false, timestamp: at(s), cwd, ...o })}\n`;
  fs.appendFileSync(transcript,
    line({ type: 'assistant', uuid: 'tst-a1', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_tst_1', name: 'Bash', input: { command: 'npx vitest run', description: 'Run the unit tests' } }] } }, 0)
    + line({ type: 'user', uuid: 'tst-u1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_tst_1', is_error: true, content: `Exit code 1\n${fixtureOutput('vitest-output.txt')}` }] } }, 6));
}

const PROBE = `(() => {
  const view = document.getElementById('testing');
  if (!view || view.hidden) return null;
  const rgb = (s) => (s.match(/[\\d.]+/g) ?? []).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const backOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c; } return [255, 255, 255]; };
  const ratio = (el) => { const a = lum(rgb(getComputedStyle(el).color)), b = lum(backOf(el)); const [hi, lo] = a > b ? [a, b] : [b, a]; return Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100; };
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const texts = [...view.querySelectorAll('.tst-title, .tst-summary, .tst-button:not(:disabled), .tst-link, .tst-note span, .tst-stage-name, .tst-stage-meta, .tst-stage-run:not(:disabled), .tst-section-title, .tst-sub, .tst-count, .tst-facts span, .tst-command, .tst-fix, .tst-group-file, .tst-group-tally, .tst-row-name, .tst-row-time, .tst-failure code, .tst-trend-label, .tst-run-name, .tst-by, .tst-run-meta, .tst-tool-name, .tst-kind, .tst-tool-detail, .tst-found, .tst-insert, .tst-muted, .tst-empty, .tst-confirm-title, .tst-confirm code, .tst-confirm-name, .tst-new, .tst-input, .tst-toggle span')].filter(visible);
  const worst = texts.map((t) => [ratio(t), t.className || t.tagName, t.textContent.slice(0, 30)]).sort((a, b) => a[0] - b[0])[0] ?? [99];
  const chips = [...view.querySelectorAll('.tst-stage-item')].map((li) => [li.querySelector('.tst-stage-name')?.textContent, [...li.classList].find((c) => c.startsWith('is-'))?.slice(3)]);
  const groups = [...view.querySelectorAll('.tst-group')].map((g) => [g.querySelector('.tst-group-file')?.textContent, g.open, g.classList.contains('is-failed')]);
  return {
    state: PastelTerm.testing.state(),
    chips,
    groups,
    chipHeights: [...view.querySelectorAll('.tst-stage')].map((c) => Math.round(c.getBoundingClientRect().height)),
    tools: [...view.querySelectorAll('.tst-tool')].map((t) => [t.querySelector('.tst-tool-name')?.textContent, t.querySelector('.tst-found')?.textContent]),
    confirm: view.querySelector('.tst-confirm')?.hidden ? null : [...view.querySelectorAll('.tst-confirm-list code')].map((c) => c.textContent),
    runs: [...view.querySelectorAll('.tst-run')].map((r) => r.textContent),
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

type Probe = { state: { project: string | null; stages: string[]; runs: number; editing: boolean; confirming: string[] | null }; [k: string]: unknown };

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

  const { project, claudeDir } = seedTestingProject(outDir);
  testingFixture.project = project;
  testingFixture.claudeDir = claudeDir;
  testingFixture.runs.length = 0;
  const transcript = fixtureFile();
  if (transcript) appendClaudeRun(transcript, project);
  await js('PastelTerm.welcome.close()');
  await js('PastelTerm.overlays.hideCurrent()');
  const [startWidth, startHeight] = win.getContentSize();
  try {
    resizeOffscreen(win, 1280, 900);
    await wait(1200); // the reader takes in the appended Claude run

    // Opens from the dock; the stack and the proposed pipeline come from the fixture files.
    await click('#testing-button');
    const opened = await settle((p) => p.state.project === 'acme' && (p.tools as unknown[]).length > 2);
    check(opened?.pressed === 'true', 'the Testing button shows pressed');
    const tools = (opened?.tools ?? []) as [string, string][];
    const found = (name: string) => tools.find(([n]) => n === name);
    check(found('Vitest')?.[1] === 'found in package.json', `Vitest found in package.json: ${JSON.stringify(found('Vitest'))}`);
    check(/found in \.maestro\//.test(found('Maestro')?.[1] ?? ''), `Maestro found in .maestro: ${JSON.stringify(found('Maestro'))}`);
    check(found('prove-it')?.[1] === 'found in user skills' && !found('deploy'), `prove-it skill listed, deploy not: ${JSON.stringify(found('prove-it'))}`);
    check(found('qa-runner') && found('CI'), 'the qa-runner agent and the CI workflow are listed');
    check(JSON.stringify(opened?.state.stages) === JSON.stringify(['Typecheck', 'Unit', 'Mobile flows']), `proposed stages: ${JSON.stringify(opened?.state.stages)}`);

    // Claude's run from the fixture log, mapped onto the Unit stage, labelled by Claude.
    const claude = await settle((p) => (p.runs as string[]).some((r) => /by Claude/.test(r)));
    check(claude && (claude.chips as string[][]).some(([n, s]) => n === 'Unit' && s === 'failed'), `Claude's failing vitest run lands on Unit: ${JSON.stringify(claude?.chips)}`);
    check(claude && /by Claude/.test(claude.sumbar as string), `its results say by Claude: ${String(claude?.sumbar).slice(0, 80)}`);

    // Run pipeline: a confirm naming each exact command; nothing recorded yet.
    const tabsBefore = await js('PastelTerm.tabs.ids().length') as number;
    await click('#testing .tst-head .tst-primary');
    const asked = await settle((p) => Array.isArray(p.confirm));
    check(JSON.stringify(asked?.confirm) === JSON.stringify(['npm run typecheck', 'npm test', 'maestro test .maestro']), `the confirm names the exact commands: ${JSON.stringify(asked?.confirm)}`);
    check(testingFixture.runs.length === 0, 'nothing runs before the confirm');
    await capture('testing-confirm');
    await click('#testing .tst-confirm-run');
    const recorded = await waitFor(() => testingFixture.runs[0] ?? null, 5000);
    check(recorded && /^sh '.+pipeline\.sh'\r$/.test(recorded.typed), `the new tab's line runs Petal's pipeline script: ${JSON.stringify(recorded?.typed)}`);
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
    check(doneRun && (doneRun.bars as number) >= 2 && (doneRun.runs as string[]).length === 2, `history shows two runs with a trend: ${doneRun?.bars} bars`);
    await capture('testing-pipeline');

    // Edit pipeline: add a stage, save, and it is kept; then back to the three.
    await click('#testing .tst-head .tst-button:not(.tst-primary)');
    const editing = await settle((p) => p.state.editing);
    check(editing && await js("document.querySelectorAll('#testing .tst-edit-row').length") === 3, 'the editor lists the three stages');
    await capture('testing-edit');
    await js("[...document.querySelectorAll('#testing .tst-editor .tst-button')].find((b) => b.textContent === 'Add stage').click()");
    await js("(() => { const rows = document.querySelectorAll('#testing .tst-edit-row'); const last = rows[rows.length - 1]; const [n, c] = last.querySelectorAll('input'); n.value = 'Lint'; n.dispatchEvent(new Event('input')); c.value = 'npm run lint'; c.dispatchEvent(new Event('input')); })()");
    await js("[...document.querySelectorAll('#testing .tst-editor .tst-button')].find((b) => b.textContent === 'Save pipeline').click()");
    const saved = await settle((p) => !p.state.editing && p.state.stages.length === 4);
    check(saved && saved.state.stages[3] === 'Lint', `saved with a fourth stage: ${JSON.stringify(saved?.state.stages)}`);
    await click('#testing .tst-head .tst-button:not(.tst-primary)');
    await settle((p) => p.state.editing);
    await js("[...document.querySelectorAll('#testing .tst-editor .tst-button')].find((b) => b.textContent === 'Use detected stages').click()");
    await js("[...document.querySelectorAll('#testing .tst-editor .tst-button')].find((b) => b.textContent === 'Save pipeline').click()");
    check(await settle((p) => !p.state.editing && p.state.stages.length === 3), 'Use detected stages restores the proposal');

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

    // Ask Claude to fix: back to the session tab, pasted through the reply box's send path.
    await click('#testing-button');
    await settle((p) => (p.failRows as string[]).length > 0);
    const pastesBefore = pasteWrites.length;
    await click('#testing .tst-row.is-failed .tst-fix');
    const pasted = await waitFor(() => pasteWrites.slice(pastesBefore).find((w) => w.data.includes('rejects an expired token')) ?? null, 4000);
    check(pasted && pasted.data.includes('src/auth.test.js') && pasted.data.includes('`npm test`') && pasted.data.length < 3100, `the fix prompt names the test, file and command: ${JSON.stringify(pasted?.data.slice(0, 140))}`);

    // Esc closes it.
    await click('#testing-button');
    await settle();
    await js("document.getElementById('testing').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    check(await waitFor(async () => (await js("document.getElementById('testing').hidden")) || null, 3000), 'Esc closes Testing');
  } finally {
    testingFixture.project = null;
    testingFixture.claudeDir = null;
    await js('PastelTerm.overlays.hideCurrent()');
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
