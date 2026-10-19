// Workflow › Factory (PASTEL_SNAPSHOT_MODE=factory), against a stand-in ~/.claude and a fixture repo in the snapshot folder:
// the seven default stations in order; an edit, an add, a remove, a button move and a drag each land in SKILL.md;
// removing asks inline, never with a browser dialog; the project override goes to the fixture repo's .petal and the
// scope line switches; Use global takes it away again; nothing spills sideways at 800px. The Test badge reads Claude,
// the Add button shows its word, and every folder Petal writes in the repo carries a self-ignoring .gitignore.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { factoryFixture } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { DEFAULT_STATIONS, GENERATED_MARKER } from '../shared/factory';

const WIDTH = 800;
const HEIGHT = 900;
const NEW_TEXT = 'Quote her words exactly. Snapshot edit 7f3a.';
const PROJECT_TEXT = 'Project-only intake rule 91c2.';

const NAMES = "[...document.querySelectorAll('#workflow .fx-chart .fx-node')].map((n) => n.querySelector('.fx-name').textContent)";
const FOLLOWS = "document.querySelector('#workflow .fx-follows')?.textContent ?? ''";
const SAVED_LINE = "document.querySelector('#workflow .fx-saved')?.textContent ?? ''";
const click = (selector: string): string => `document.querySelector(${JSON.stringify(`#workflow ${selector}`)}).click()`;
const type = (selector: string, value: string, event = 'input'): string =>
  `(() => { const e = document.querySelector(${JSON.stringify(`#workflow ${selector}`)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`;
const drag = (from: string, to: string): string => `(() => {
  const dt = new DataTransfer();
  const src = document.querySelector('#workflow [data-station="${from}"]');
  const dst = document.querySelector('#workflow [data-station="${to}"]');
  src.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
  dst.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  dst.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  src.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
})()`;
const FIT = `(() => {
  const W = window.innerWidth;
  const pane = document.getElementById('workflow');
  const outside = [...pane.querySelectorAll('.fx-node, .fx-scope, .fx-editor, .fx-follows')].filter((e) => e.getBoundingClientRect().right > W + 1).map((e) => e.className);
  return { doc: document.documentElement.scrollWidth, pane: [pane.scrollWidth, pane.clientWidth], inner: W, outside };
})()`;

const headings = (file: string): string[] => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('## ')) : []);

export async function factoryCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, log, waitFor, capture } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} factory: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  const saved = { ...factoryFixture };

  // Stand-ins only: her real ~/.claude and repos are never read or written here.
  const claudeDir = path.join(kit.outDir, 'factory-claude');
  const repo = path.join(kit.outDir, 'factory-repo');
  fs.rmSync(claudeDir, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  Object.assign(factoryFixture, { claudeDir, repo });
  const skill = path.join(claudeDir, 'skills', 'factory', 'SKILL.md');
  const projectMd = path.join(repo, '.petal', 'factory.md');
  const projectSkill = path.join(repo, '.claude', 'skills', 'factory', 'SKILL.md');

  const run = (code: string) => js(`Promise.resolve(${code}).then(() => 0)`); // statements only: executeJavaScript can't return functions or elements
  const nodeCount = (n: number) => waitFor(async () => (await js(NAMES)).length === n, 5000);
  const savedLine = () => waitFor(async () => (await js(SAVED_LINE)) === 'Saved. Claude follows this from your next message.', 5000);

  try {
    await run('PastelTerm.getStarted.close()');
    resizeOffscreen(win, WIDTH, HEIGHT);
    check(await waitFor(async () => { win.webContents.invalidate(); return (await js('window.innerWidth')) === WIDTH; }, 3000), `${WIDTH}px window sized`);
    await js('window.__fxConfirms = 0; window.__fxConfirm = window.confirm; window.confirm = () => { window.__fxConfirms++; return true; }; true');

    await run('PastelTerm.workflow.open()');
    await run("document.querySelector('#workflow-tabs button[data-tab=\"factory\"]').click()");
    check(await nodeCount(7), 'Workflow › Factory opens with seven cards');
    check(JSON.stringify(await js(NAMES)) === JSON.stringify(DEFAULT_STATIONS.map((s) => s.name)), `default stations in order: ${JSON.stringify(await js(NAMES))}`);
    const badges: string[] = await js("[...document.querySelectorAll('#workflow .fx-runner')].map((b) => b.textContent)");
    check(badges.length === 7 && badges[1] === 'Subagent · Plan' && badges[3] === 'Claude' && badges[5] === 'You approve', `who-runs badges: ${JSON.stringify(badges)}`);
    check((await js("document.querySelectorAll('#workflow .fx-arrow svg').length")) === 6, 'six arrows between seven cards');
    check(/isn’t following a factory yet/.test(await js(FOLLOWS)), `before any save: ${await js(FOLLOWS)}`);
    check(!fs.existsSync(skill), 'opening writes nothing');
    const addText = await js("document.querySelector('#workflow [data-station=\"build\"] [data-tool=\"add\"]')?.textContent ?? ''");
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
    await run(type('#fx-name', 'Review'));
    await run(type('#fx-runner', 'you', 'change'));
    await run(type('#fx-pass', 'You have read the diff.'));
    await run(click('.fx-save'));
    check(await nodeCount(8), 'Add station puts an eighth card in');
    check(headings(skill)[3] === '## 4. Review' && fs.readFileSync(skill, 'utf8').includes('You have read the diff.'), `added station in SKILL.md: ${JSON.stringify(headings(skill))}`);

    // Remove it, through the inline confirm.
    await run(click('[data-station="review"] [data-tool="remove"]'));
    check(await waitFor(() => js("Boolean(document.querySelector('#workflow .fx-remove-yes'))"), 3000), 'Remove asks inline first');
    await run(click('.fx-remove-yes'));
    check(await nodeCount(7) && !headings(skill).some((h) => h.includes('Review')), `removed from SKILL.md: ${JSON.stringify(headings(skill))}`);
    check((await js('window.__fxConfirms')) === 0, 'no browser dialog was used');

    // Reorder: Move left by button keeps focus on the moved card, then a drag puts Learn first.
    await run(click('[data-station="learn"] [data-tool="left"]'));
    check(await waitFor(() => headings(skill)[5] === '## 6. Learn', 5000), `Move left reorders SKILL.md: ${JSON.stringify(headings(skill))}`);
    check(await js("document.activeElement?.closest('[data-station]')?.dataset.station === 'learn'"), 'focus stays on the moved card');
    await run(drag('learn', 'intake'));
    check(await waitFor(() => headings(skill)[0] === '## 1. Learn', 5000), `drag reorders SKILL.md: ${JSON.stringify(headings(skill))}`);
    check((await js(NAMES))[0] === 'Learn', 'the chart shows the dragged order');

    // Project override: copied from global into the fixture repo's .petal, and the scope line switches.
    await run(click('.fx-scope [data-scope="project"]'));
    check(new RegExp(`This project \\(${path.basename(repo)}\\)`).test(await js("document.querySelector('#workflow .fx-scope [data-scope=\"project\"]').textContent")), 'scope switch names the fixture repo');
    await run(click('.fx-customise'));
    check(await waitFor(() => fs.existsSync(projectMd) && fs.existsSync(path.join(repo, '.petal', 'factory.json')), 5000), 'Customise for this project writes .petal/factory.json and factory.md');
    const ignores = [path.join(repo, '.petal', '.gitignore'), path.join(path.dirname(projectSkill), '.gitignore')].map((f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null));
    check(fs.existsSync(projectSkill) && ignores.every((t) => t === '*\n'), `project skill written, both folders self-ignored: ${JSON.stringify(ignores)}`);
    check(await waitFor(async () => /this project’s factory/.test(await js(FOLLOWS)), 3000), `scope line follows the project: ${await js(FOLLOWS)}`);
    const globalBefore = fs.readFileSync(skill, 'utf8');
    await run(click('[data-station="intake"] .fx-card'));
    await waitFor(() => js("Boolean(document.querySelector('#workflow #fx-instructions'))"), 3000);
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
    check(await waitFor(() => !fs.existsSync(path.join(repo, '.petal')) && !fs.existsSync(path.join(repo, '.claude')), 5000), 'Use global deletes the override and the project skill');
    check(await waitFor(async () => /Claude follows the global factory/.test(await js(FOLLOWS)), 3000), `scope line back on global: ${await js(FOLLOWS)}`);

    // A factory skill she wrote herself stops the save with one line and stays byte for byte.
    const hers = '---\nname: factory\n---\nMy own steps.\n';
    fs.writeFileSync(skill, hers);
    const refused = await js(`window.pastel.factory.save({ scope: 'global', repo: null, factory: { version: 1, stations: ${JSON.stringify(DEFAULT_STATIONS)} } })`);
    check(/A factory skill you wrote already exists/.test(refused?.error ?? '') && fs.readFileSync(skill, 'utf8') === hers, `her own skill is never overwritten: ${JSON.stringify(refused)}`);
  } finally {
    await js('if (window.__fxConfirm) window.confirm = window.__fxConfirm; true');
    await run('PastelTerm.workflow.close()');
    Object.assign(factoryFixture, saved);
    resizeOffscreen(win, startWidth, startHeight);
  }
}
