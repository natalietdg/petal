// Customize › Factory (PASTEL_SNAPSHOT_MODE=factory), against a stand-in ~/.claude and a fixture repo in the snapshot folder.
// Jobs: Factory is out of Advanced; the empty state and first-run card, ship mode, rows in order with their reasons and
// buttons, Give guidance and Discard through inline panels, 800px fit, light and dark.
// Stations (folded below Jobs): the seven default stations on the spine; an edit, an add, a remove, a button move and a drag each land in SKILL.md;
// removing asks inline, never with a browser dialog; the project override goes to Petal's folder for the fixture repo,
// never the repo, and the scope line switches; Use global takes it away again; nothing spills sideways at 800px. The Test
// badge reads Claude and the Add button shows its word.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { factoryFixture } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { DEFAULT_STATIONS, GENERATED_MARKER } from '../shared/factory';
import { petalDirOf, petalFileOf, repoUntouched } from './snapshot-testing';
import { seedJobs } from './snapshot-factory-jobs';
import { execFileSync } from 'node:child_process';

const WIDTH = 800;
const HEIGHT = 900;
const NEW_TEXT = 'Quote her words exactly. Snapshot edit 7f3a.';
const PROJECT_TEXT = 'Project-only intake rule 91c2.';

const NAMES = "[...document.querySelectorAll('#customize .fx-chart .fx-node')].map((n) => n.querySelector('.fx-name').textContent)";
const FOLLOWS = "document.querySelector('#customize .fx-follows')?.textContent ?? ''";
const SAVED_LINE = "document.querySelector('#customize .fx-saved')?.textContent ?? ''";
const click = (selector: string): string => `document.querySelector(${JSON.stringify(`#customize ${selector}`)}).click()`;
const type = (selector: string, value: string, event = 'input'): string =>
  `(() => { const e = document.querySelector(${JSON.stringify(`#customize ${selector}`)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`;
const drag = (from: string, to: string): string => `(() => {
  const dt = new DataTransfer();
  const src = document.querySelector('#customize [data-station="${from}"]');
  const dst = document.querySelector('#customize [data-station="${to}"]');
  src.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
  dst.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  dst.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  src.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
})()`;
const FIT = `(() => {
  const W = window.innerWidth;
  const pane = document.getElementById('customize');
  const outside = [...pane.querySelectorAll('.fx-node, .fx-scope, .fx-editor, .fx-follows')].filter((e) => e.getBoundingClientRect().right > W + 1).map((e) => e.className);
  return { doc: document.documentElement.scrollWidth, pane: [pane.scrollWidth, pane.clientWidth], inner: W, outside };
})()`;

const headings = (file: string): string[] => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((l) => /^### \d+\. /.test(l)) : []);

export async function factoryCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, log, waitFor, capture, wait } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} factory: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  const saved = { ...factoryFixture };

  // Stand-ins only: her real ~/.claude and repos are never read or written here.
  const claudeDir = path.join(kit.outDir, 'factory-claude');
  const repo = path.join(kit.outDir, 'factory-repo');
  fs.rmSync(claudeDir, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(petalDirOf(repo), { recursive: true, force: true });
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.email=snap@example.invalid', '-c', 'user.name=Snap', ...args], { stdio: 'ignore' });
  git('init', '-q', '-b', 'main'); // a temp repo of its own, so a job's worktree is real git and nothing of hers
  git('commit', '-q', '--allow-empty', '-m', 'start');
  Object.assign(factoryFixture, { claudeDir, repo });
  const skill = path.join(claudeDir, 'skills', 'factory', 'SKILL.md');
  const projectMd = petalFileOf(repo, 'factory.md');
  const projectJson = petalFileOf(repo, 'factory.json');

  const run = (code: string) => js(`Promise.resolve(${code}).then(() => 0)`); // statements only: executeJavaScript can't return functions or elements
  const nodeCount = (n: number) => waitFor(async () => (await js(NAMES)).length === n, 5000);
  const savedLine = () => waitFor(async () => (await js(SAVED_LINE)) === 'Saved. Claude follows this from your next message.', 5000);

  try {
    await run('PastelTerm.getStarted.close()');
    resizeOffscreen(win, WIDTH, HEIGHT);
    check(await waitFor(async () => { win.webContents.invalidate(); return (await js('window.innerWidth')) === WIDTH; }, 3000), `${WIDTH}px window sized`);
    await js('window.__fxConfirms = 0; window.__fxConfirm = window.confirm; window.confirm = () => { window.__fxConfirms++; return true; }; true');

    await run('PastelTerm.customize.open()');
    check(await js("!document.querySelector('#customize-tabs button[data-section=\"factory\"]').classList.contains('advanced-only')"), 'Factory is out of Advanced');
    await run("document.querySelector('#customize-tabs button[data-section=\"factory\"]').click()");
    await jobsScreen(kit, win, repo);
    await run("document.querySelector('#customize .fx-fold').open = true");
    check(await nodeCount(7), 'Customize › Factory opens with seven cards');
    check(JSON.stringify(await js(NAMES)) === JSON.stringify(DEFAULT_STATIONS.map((s) => s.name)), `default stations in order: ${JSON.stringify(await js(NAMES))}`);
    const badges: string[] = await js("[...document.querySelectorAll('#customize .fx-runner')].map((b) => b.textContent)");
    check(badges.length === 7 && badges[1] === 'Subagent · Plan' && badges[3] === 'Claude' && badges[5] === 'You approve', `who-runs badges: ${JSON.stringify(badges)}`);
    check((await js("document.querySelectorAll('#customize .fx-arrow svg').length")) === 6, 'six arrows between seven cards');
    check(/isn’t following a factory yet/.test(await js(FOLLOWS)), `before any save: ${await js(FOLLOWS)}`);
    check(!fs.existsSync(skill), 'opening writes nothing');
    const addText = await js("document.querySelector('#customize [data-station=\"build\"] [data-tool=\"add\"]')?.textContent ?? ''");
    check(addText === 'Add', `the add button shows “Add”: ${JSON.stringify(addText)}`);
    const fit = await js(FIT);
    check(fit.doc <= fit.inner && fit.pane[0] <= fit.pane[1] && !fit.outside.length, `fits ${WIDTH}px with no sideways scroll: ${JSON.stringify(fit)}`);
    await capture('factory-800');

    // Edit one station: its new text lands in the generated skill.
    await run(click('[data-station="intake"] .fx-card'));
    check(await waitFor(() => js("document.activeElement?.id === 'fx-name'"), 3000), 'clicking a card opens the edit panel on Name');
    await run(type('#fx-instructions', NEW_TEXT));
    await run(click('.fx-save'));
    check(await savedLine(), 'Save shows “Saved. Claude follows this from your next message.”');
    const afterEdit = fs.existsSync(skill) ? fs.readFileSync(skill, 'utf8') : '';
    check(afterEdit.includes(NEW_TEXT) && afterEdit.split('\n')[4] === GENERATED_MARKER && afterEdit.startsWith('---\nname: factory\n'), `SKILL.md has the edit, frontmatter and marker (${afterEdit.length} chars)`);
    check(/Claude follows the global factory/.test(await js(FOLLOWS)), `scope line after save: ${await js(FOLLOWS)}`);

    // Add after Build, as a step you approve.
    await run(click('[data-station="build"] [data-tool="add"]'));
    await waitFor(() => js("document.activeElement?.id === 'fx-name'"), 3000);
    await run(type('#fx-name', 'Check'));
    await run(type('#fx-runner', 'you', 'change'));
    await run(type('#fx-pass', 'You have read the diff.'));
    await run(click('.fx-save'));
    check(await nodeCount(8), 'Add station puts an eighth card in');
    check(headings(skill)[3] === '### 4. Check' && fs.readFileSync(skill, 'utf8').includes('You have read the diff.'), `added station in SKILL.md: ${JSON.stringify(headings(skill))}`);

    // Remove it, through the inline confirm.
    check(await js("!document.querySelector('#customize [data-station=\"review\"] [data-tool=\"remove\"]')"), 'spine stations have no Remove');
    await run(click('[data-station="check"] [data-tool="remove"]'));
    check(await waitFor(() => js("Boolean(document.querySelector('#customize .fx-remove-yes'))"), 3000), 'Remove asks inline first');
    await run(click('.fx-remove-yes'));
    check(await nodeCount(7) && !headings(skill).some((h) => h.includes('Check')), `removed from SKILL.md: ${JSON.stringify(headings(skill))}`);
    check((await js('window.__fxConfirms')) === 0, 'no browser dialog was used');

    // Reorder: Move left by button keeps focus on the moved card, then a drag moves Research & plan after Build.
    await run(click('[data-station="test-queue"] [data-tool="left"]'));
    check(await waitFor(() => headings(skill)[2] === '### 3. Test', 5000), `Move left reorders SKILL.md: ${JSON.stringify(headings(skill))}`);
    check(await js("document.activeElement?.closest('[data-station]')?.dataset.station === 'test-queue'"), 'focus stays on the moved card');
    await run(drag('research-plan', 'build'));
    check(await waitFor(() => headings(skill)[3] === '### 4. Research & plan', 5000), `drag reorders SKILL.md: ${JSON.stringify(headings(skill))}`);
    check((await js(NAMES))[3] === 'Research & plan', 'the chart shows the dragged order');
    await run(drag('test-queue', 'intake'));
    await wait(500);
    check(headings(skill)[0] === '### 1. Intake', 'nothing can be dropped before Intake');

    // Project override: copied from global into Petal's folder for the fixture repo, and the scope line switches.
    await run(click('.fx-scope [data-scope="project"]'));
    check(new RegExp(`This project \\(${path.basename(repo)}\\)`).test(await js("document.querySelector('#customize .fx-scope [data-scope=\"project\"]').textContent")), 'scope switch names the fixture repo');
    await run(click('.fx-customise'));
    check(await waitFor(() => fs.existsSync(projectMd) && fs.existsSync(projectJson), 5000), `Customise for this project writes factory.json and factory.md in Petal: ${petalDirOf(repo)}`);
    check(repoUntouched(repo), 'nothing is written in the repo: no .petal/, no project skill in .claude/');
    check(await waitFor(async () => /this project’s factory/.test(await js(FOLLOWS)), 3000), `scope line follows the project: ${await js(FOLLOWS)}`);
    const globalBefore = fs.readFileSync(skill, 'utf8');
    await run(click('[data-station="intake"] .fx-card'));
    await waitFor(() => js("Boolean(document.querySelector('#customize #fx-instructions'))"), 3000);
    await run(type('#fx-instructions', PROJECT_TEXT));
    await run(click('.fx-save'));
    await savedLine();
    check(fs.readFileSync(projectMd, 'utf8').includes(PROJECT_TEXT) && fs.readFileSync(skill, 'utf8') === globalBefore, 'a project edit lands in factory.md and leaves SKILL.md alone');
    const projectFit = await js(FIT);
    check(projectFit.doc <= projectFit.inner && !projectFit.outside.length, `project view fits ${WIDTH}px: ${JSON.stringify(projectFit)}`);
    await capture('factory-project-800');

    // Use global: inline confirm, the override goes, the line switches back.
    await run(click('.fx-use-global'));
    await run(click('.fx-confirm-yes'));
    check(await waitFor(() => !fs.existsSync(projectMd) && !fs.existsSync(projectJson), 5000) && repoUntouched(repo), 'Use global deletes the override from Petal, and the repo stays untouched');
    check(await waitFor(async () => /Claude follows the global factory/.test(await js(FOLLOWS)), 3000), `scope line back on global: ${await js(FOLLOWS)}`);

    // A factory skill she wrote herself stops the save with one line and stays byte for byte.
    const hers = '---\nname: factory\n---\nMy own steps.\n';
    fs.writeFileSync(skill, hers);
    const refused = await js(`window.pastel.factory.save({ scope: 'global', repo: null, factory: { version: 1, stations: ${JSON.stringify(DEFAULT_STATIONS)} } })`);
    check(/A factory skill you wrote already exists/.test(refused?.error ?? '') && fs.readFileSync(skill, 'utf8') === hers, `her own skill is never overwritten: ${JSON.stringify(refused)}`);
  } finally {
    await js('if (window.__fxConfirm) window.confirm = window.__fxConfirm; true');
    await run('PastelTerm.customize.close()');
    Object.assign(factoryFixture, saved);
    resizeOffscreen(win, startWidth, startHeight);
  }
}

// Factory › Jobs at 800px: empty, then four seeded jobs, her buttons through inline panels, light and dark.
async function jobsScreen(kit: Kit, win: BrowserWindow, repo: string): Promise<void> {
  const { js, log, waitFor, capture, applyTheme, wait } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} factory jobs screen: ${what}`);
  const run = (code: string) => js(`Promise.resolve(${code}).then(() => 0)`);
  const reopen = async () => {
    await run('PastelTerm.customize.close()');
    await run('PastelTerm.customize.open()');
    await run("document.querySelector('#customize-tabs button[data-section=\"factory\"]').click()");
    await waitFor(() => js("Boolean(document.querySelector('#customize .fj'))"), 5000);
  };
  const JOBS = `[...document.querySelectorAll('#customize .fj-job')].map((j) => ({ id: j.dataset.job, state: j.querySelector('.fj-state')?.textContent, reason: j.querySelector('.fj-reason')?.textContent ?? '', acts: [...j.querySelectorAll('.fj-act')].map((b) => b.textContent) }))`;
  const JOB_FIT = `(() => { const W = window.innerWidth; return [...document.querySelectorAll('#customize .fj-job, #customize .fj-repo-head, #customize .fj-first, #customize .fj-ship')].filter((e) => e.getBoundingClientRect().right > W + 1).map((e) => e.className); })()`;

  check(await waitFor(() => js("Boolean(document.querySelector('#customize .fj'))"), 5000), 'Factory opens on Jobs');
  check(await js("document.querySelector('#customize .fx-fold')?.open === false && document.querySelector('#customize .fx-fold-summary')?.textContent === 'Edit stations'"), 'stations fold below Jobs, closed');
  check(/No jobs yet\. In any session, type \/factory and what to build\./.test(await js("document.querySelector('#customize .fj-empty')?.textContent ?? ''")), 'empty state says how to start a job');
  const first = await js("document.querySelector('#customize .fj-first-text')?.textContent ?? ''");
  check(first === 'Jobs run on their own branch in a separate copy. Low-risk jobs merge into main on this computer by themselves, and you can undo them. Nothing is pushed. You approve anything touching auth, payments, CI, migrations, email or new packages.', `first-run card: ${JSON.stringify(first)}`);
  await capture('factory-jobs-empty-800');

  // Ship mode: Pull request saves for this repo, in Petal's folder.
  await run("document.querySelector('#customize .fj-ship [data-ship=\"pr\"]').click()");
  check(await waitFor(() => fs.existsSync(petalFileOf(repo, 'factory', 'ship.json')) && /"pr"/.test(fs.readFileSync(petalFileOf(repo, 'factory', 'ship.json'), 'utf8')), 5000), 'Pull request saves ship.json for the repo');
  check(await waitFor(async () => /Push the branch for a pull request\. You chose this\./.test(await js("document.querySelector('#customize .fj-ship-why')?.textContent ?? ''")), 3000), 'the ship line says what was chosen');
  check(/Low-risk jobs push their branch for a pull request by themselves\. Main is never touched\./.test(await js("document.querySelector('#customize .fj-first-text')?.textContent ?? ''")), 'the first-run card follows the ship mode');
  await run("document.querySelector('#customize .fj-ship [data-ship=\"local-merge\"]').click()");
  await waitFor(() => /"local-merge"/.test(fs.readFileSync(petalFileOf(repo, 'factory', 'ship.json'), 'utf8')), 5000);
  await run("document.querySelector('#customize .fj-first-ok').click()");
  check(await waitFor(async () => !(await js("Boolean(document.querySelector('#customize .fj-first'))")) && fs.existsSync(petalFileOf(repo, 'factory', 'seen.json')), 5000), 'Got it hides the first-run card and remembers it');

  const seeded = seedJobs(repo, null);
  await reopen();
  const jobs = await waitFor(async () => { const j = await js(JOBS) as { id: string; state: string; reason: string; acts: string[] }[]; return j.length === seeded.length ? j : null; }, 5000) as { id: string; state: string; reason: string; acts: string[] }[] | null;
  log(`factory jobs rows: ${JSON.stringify(jobs)}`);
  check(jobs && jobs.slice(0, 2).every((j) => ['20261115-login-rate-limit', '20261115-export-csv'].includes(j.id)) && jobs[2].id === '20261115-tidy-readme' && jobs[3].id === '20261114-fix-typo', 'waiting jobs first, then working, then finished');
  const byId = (id: string) => jobs?.find((j) => j.id === id);
  check(byId('20261115-login-rate-limit')?.reason === 'Approve merge · touches auth (src/auth/session.ts)' && JSON.stringify(byId('20261115-login-rate-limit')?.acts) === '["See the changes","Approve merge","Send back","Discard"]', `approve row: ${JSON.stringify(byId('20261115-login-rate-limit'))}`);
  check(byId('20261115-export-csv')?.reason === 'Stuck after 2 tries · code: no test for empty boards' && JSON.stringify(byId('20261115-export-csv')?.acts) === '["Give guidance","Take over","Discard"]', `escalated row: ${JSON.stringify(byId('20261115-export-csv'))}`);
  check(byId('20261114-fix-typo')?.state === 'Merged locally · not pushed' && JSON.stringify(byId('20261114-fix-typo')?.acts) === '["Undo merge"]', `done row: ${JSON.stringify(byId('20261114-fix-typo'))}`);
  check(await js("document.querySelector('#customize .fj-sub')?.textContent === 'Finished'"), 'finished jobs sit under Finished');
  check(await js("document.querySelector('#customize .fj-job[data-job=\"20261115-login-rate-limit\"] .fj-spec-summary')?.textContent === 'Read the spec'"), 'an approval row shows the spec it approves');
  check(await js("getComputedStyle(document.querySelector('#customize .fj-ship [aria-pressed=\"true\"]')).backgroundColor !== getComputedStyle(document.querySelector('#customize .fj-ship [aria-pressed=\"false\"]')).backgroundColor"), 'the chosen ship mode is highlighted');
  for (const theme of ['paleSky', 'nightPastel']) {
    applyTheme(theme, { persist: false });
    await wait(300);
    const outside = await js(JOB_FIT) as string[];
    check(!outside.length && (await js('document.documentElement.scrollWidth <= window.innerWidth')), `${theme} jobs fit 800px: ${JSON.stringify(outside)}`);
    await capture(`factory-jobs-800-${theme}`);
  }
  applyTheme('paleSky', { persist: false });

  // Give guidance: an inline note, then the job goes back to rework with the note, its runner recorded, not started.
  const csv = '#customize .fj-job[data-job="20261115-export-csv"]';
  await run(`document.querySelector('${csv} .fj-act-guidance').click()`);
  check(await waitFor(() => js(`document.activeElement === document.querySelector('${csv} .fj-note-input')`), 3000), 'Give guidance opens a note box with focus');
  await run(`(() => { const t = document.querySelector('${csv} .fj-note-input'); t.value = 'Add a test for an empty board'; })()`);
  await run(`document.querySelector('${csv} .fj-send').click()`);
  const jobFile = petalFileOf(repo, 'factory', 'jobs', '20261115-export-csv', 'job.json');
  const moved = await waitFor(() => { const j = JSON.parse(fs.readFileSync(jobFile, 'utf8')); return j.state === 'rework' ? j : null; }, 8000);
  check(moved?.guidance === 'Add a test for an empty board' && moved?.childSessionIds?.length === 1, `guidance sends it to rework with a runner: ${JSON.stringify(moved && { state: moved.state, guidance: moved.guidance, runners: moved.childSessionIds })}`);
  check(fs.existsSync(petalFileOf(repo, 'factory', 'jobs', '20261115-export-csv', 'round-3', 'review-code.md')), 'the failed round moves into round-3/ (its third try)');
  check(repoUntouched(repo), 'the repo itself gets nothing of Petal’s');

  // Discard asks inline, then the job lands under Finished.
  const tidy = '#customize .fj-job[data-job="20261115-tidy-readme"]';
  await run(`document.querySelector('${tidy} .fj-act-discard').click()`);
  check(await waitFor(() => js(`Boolean(document.querySelector('${tidy} .fj-confirm-yes'))`), 3000), 'Discard asks inline first');
  await run(`document.querySelector('${tidy} .fj-confirm-yes').click()`);
  check(await waitFor(async () => (await js(`document.querySelector('${tidy} .fj-state')?.textContent`)) === 'Discarded', 5000), 'Discard marks the job discarded');
  check((await js('window.__fxConfirms')) === 0, 'no browser dialog was used for jobs');
  fs.rmSync(petalFileOf(repo, 'factory'), { recursive: true, force: true });
  void win;
}
