// Customize › Formatting › Output styles (PASTEL_SNAPSHOT_MODE=customize-styles), against a stand-in ~/.claude:
// every style listed with the right Active badge, a click shows the full prompt as plain text with its path,
// a long prompt scrolls inside its box, nothing overflows sideways at 800px, in every theme; browsing never writes.
// Use this style moves the badge and changes only outputStyle in the stand-in settings.json; other names are refused.
// Add Petal's reply styles copies the four bundled petal-*.md files in, and the button goes away.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { stylesFixture } from '../main/snapshot-mode';
import { bundleDir as bundledStylesDir } from '../main/customize-ipc';
import { resizeOffscreen } from '../main/snapshot-window';

const WIDTH = 800;
const HEIGHT = 900;
const LONG_TOKEN = `https://example.com/${'a-very-long-unbroken-path-segment-'.repeat(40)}end`;
const LONG_PROMPT = [
  'You are a careful assistant. This style has no frontmatter, so Petal names it after the file.',
  '',
  ...Array.from({ length: 220 }, (_, i) => `${i + 1}. **Rule ${i + 1}:** keep <tags> & markdown *as typed*, never rendered.`),
  LONG_TOKEN,
  'Last line of the long prompt.',
].join('\n');
const FILES: Record<string, string> = {
  'research-paper.md': '---\nname: Research Paper\ndescription: Abstract first, numbered sections, references last.\n---\n\n# Research paper\n\nWrite like a short paper.\n',
  'magazine.md': '---\nname: Magazine\ndescription: >\n  Headline, dek, sidebars and pull quotes\n  for Petal.\n---\n\nLay replies out like a magazine.\n',
  'plain-notes.md': LONG_PROMPT,
};
const ACTIVE = 'Research Paper';
// Other keys that must survive a switch untouched, in this order, at 2-space indent.
const SETTINGS = { permissions: { allow: ['Bash(ls)'], deny: [] }, outputStyle: ACTIVE, model: 'opus', hooks: { Stop: [{ command: 'true' }] } };
const SETTINGS_TEXT = `${JSON.stringify(SETTINGS, null, 2)}\n`;
const HINT = (name: string) => `New Claude sessions use ${name}; running ones switch on their next message.`;

// any: the page scripts below build their own shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;

const LIST = `(() => [...document.querySelectorAll('#customize .cz-style')].map((row) => ({
  file: row.dataset.file,
  name: row.querySelector('.cz-style-name').firstChild.textContent,
  active: Boolean(row.querySelector('.cz-style-active')),
  desc: row.querySelector('.cz-style-desc')?.textContent ?? '',
  expanded: row.querySelector('.cz-style-head').getAttribute('aria-expanded'),
  use: Boolean(row.querySelector('.cz-style-use')),
})))()`;
const HINTS = "[...document.querySelectorAll('#customize .cz-style-switched')].map((p) => p.textContent)";
const clickUse = (name: string): string => `document.querySelector('#customize .cz-style-use[aria-label=${JSON.stringify(`Use ${name}`)}]').click()`;

const OPEN_PANEL = `(() => {
  const pre = document.querySelector('#customize .cz-style-text');
  const pane = document.getElementById('customize');
  if (!pre) return null;
  const card = pre.closest('.cz-card').getBoundingClientRect();
  const box = pre.getBoundingClientRect();
  return {
    text: pre.textContent, children: pre.children.length,
    path: document.querySelector('#customize .cz-style-path')?.textContent,
    scrollHeight: pre.scrollHeight, clientHeight: pre.clientHeight, scrollWidth: pre.scrollWidth, clientWidth: pre.clientWidth,
    overflowY: getComputedStyle(pre).overflowY, whiteSpace: getComputedStyle(pre).whiteSpace,
    boxRight: Math.round(box.right), cardRight: Math.round(card.right),
    pageScrollWidth: pane.scrollWidth, pageClientWidth: pane.clientWidth,
    docScrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
  };
})()`;

const clickHead = (name: string): string => `[...document.querySelectorAll('#customize .cz-style')].find((row) => row.querySelector('.cz-style-name').firstChild.textContent === ${JSON.stringify(name)}).querySelector('.cz-style-head').click()`;

const hashDir = (dir: string): string => {
  const hash = crypto.createHash('sha256');
  for (const name of fs.readdirSync(dir, { recursive: true }).map(String).sort()) {
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    hash.update(`${name}:${stat.mtimeMs}:${stat.isFile() ? fs.readFileSync(file, 'utf8') : 'dir'}\n`);
  }
  return hash.digest('hex');
};

export async function customizeStylesCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, log, waitFor, capture, themes, applyTheme, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} customize styles: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();

  // The stand-in ~/.claude lives in the snapshot folder; her real one is never read here.
  const claudeDir = path.join(outDir, 'styles-claude');
  const stylesDir = path.join(claudeDir, 'output-styles');
  fs.rmSync(claudeDir, { recursive: true, force: true });
  fs.mkdirSync(stylesDir, { recursive: true });
  for (const [name, text] of Object.entries(FILES)) fs.writeFileSync(path.join(stylesDir, name), text);
  fs.writeFileSync(path.join(claudeDir, 'settings.json'), SETTINGS_TEXT);
  const before = hashDir(claudeDir);
  stylesFixture.claudeDir = claudeDir;
  stylesFixture.opened = [];

  const showFormatting = async () => {
    await js("PastelTerm.customize.open('formatting')");
    return waitFor(() => js("document.querySelector('#customize-tabs [aria-selected=\"true\"]')?.dataset.section === 'formatting' && document.querySelector('#customize .cz-card') !== null"), 5000);
  };
  const expected = Object.entries(FILES).map(([file, text]) => ({
    file: path.join(stylesDir, file),
    name: /^name: (.+)$/m.exec(text)?.[1] ?? path.basename(file, '.md'),
  })).sort((a, b) => a.name.localeCompare(b.name));

  try {
    await js('PastelTerm.getStarted.close()');
    resizeOffscreen(win, WIDTH, HEIGHT);
    check(await waitFor(async () => { win.webContents.invalidate(); return (await js('window.innerWidth')) === WIDTH; }, 3000), `${WIDTH}px window sized`);

    const state: Page = await js('window.pastel.config.get()');
    check(state.outputStyles?.dir === stylesDir && state.outputStyle === ACTIVE, `state reads the stand-in folder: ${state.outputStyles?.dir}, active ${state.outputStyle}`);

    for (const theme of Object.keys(themes)) {
      applyTheme(theme, { persist: false });
      check(await showFormatting(), `${theme}: Formatting open`);
      const rows: Page[] = await js(LIST);
      if (rows.some((r) => r.expanded === 'true')) await js(clickHead(rows.find((r) => r.expanded === 'true').name)); // start collapsed
      const listed: Page[] = await js(LIST);
      check(JSON.stringify(listed.map((r) => [r.name, r.file])) === JSON.stringify(expected.map((e) => [e.name, e.file])), `${theme}: lists every style ${JSON.stringify(listed.map((r) => r.name))}`);
      check(listed.filter((r) => r.active).map((r) => r.name).join() === ACTIVE, `${theme}: Active badge only on ${ACTIVE}: ${JSON.stringify(listed.filter((r) => r.active).map((r) => r.name))}`);
      check(listed.every((r) => r.use === !r.active), `${theme}: Use this style on every row but the active one`);
      check(listed.find((r) => r.name === 'Magazine')?.desc === 'Headline, dek, sidebars and pull quotes for Petal.' && listed.find((r) => r.name === 'plain-notes')?.desc === '', `${theme}: descriptions from frontmatter, none without it`);
      check(listed.every((r) => r.expanded === 'false') && !(await js("Boolean(document.querySelector('#customize .cz-style-text'))")), `${theme}: collapsed shows no prompt`);
      await js("document.querySelector('#customize .cz-styles').closest('.cz-card').scrollIntoView({ block: 'start' })");
      await capture(`customize-styles-collapsed-${theme}`);

      await js(clickHead('plain-notes'));
      const panel: Page = await waitFor(() => js(OPEN_PANEL), 3000);
      check(panel && panel.text === LONG_PROMPT && panel.children === 0, `${theme}: click shows the full prompt as plain text (${panel?.text.length}/${LONG_PROMPT.length} chars, ${panel?.children} child elements)`);
      check(panel?.path === path.join(stylesDir, 'plain-notes.md'), `${theme}: shows the file path ${panel?.path}`);
      check(panel && panel.overflowY === 'auto' && panel.scrollHeight > panel.clientHeight + 200 && panel.clientHeight <= 420, `${theme}: long prompt scrolls inside its box (${panel?.clientHeight}px of ${panel?.scrollHeight}px)`);
      const scrolled = await js("(() => { const pre = document.querySelector('#customize .cz-style-text'); pre.scrollTop = 300; return pre.scrollTop; })()");
      check(scrolled > 0, `${theme}: the box scrolls (${scrolled}px)`);
      check(panel && panel.scrollWidth <= panel.clientWidth && panel.boxRight <= panel.cardRight && panel.pageScrollWidth <= panel.pageClientWidth && panel.docScrollWidth <= panel.innerWidth,
        `${theme}: no horizontal overflow at ${WIDTH}px ${JSON.stringify({ box: [panel?.scrollWidth, panel?.clientWidth], right: [panel?.boxRight, panel?.cardRight], page: [panel?.pageScrollWidth, panel?.pageClientWidth], doc: [panel?.docScrollWidth, panel?.innerWidth] })}`);
      await js("document.querySelector('#customize .cz-style-text').scrollTop = 0; document.querySelector('#customize .cz-style-head[aria-expanded=\"true\"]').scrollIntoView({ block: 'start' })");
      await capture(`customize-styles-open-${theme}`);

      const opened = stylesFixture.opened.length;
      await js("[...document.querySelectorAll('#customize .cz-style-panel button')].find((b) => b.textContent === 'Open in editor').click()");
      check(await waitFor(() => stylesFixture.opened.length === opened + 1, 3000) && stylesFixture.opened.at(-1) === path.join(stylesDir, 'plain-notes.md'), `${theme}: Open in editor asks main to open ${stylesFixture.opened.at(-1)}`);

      await js(clickHead('plain-notes'));
      check(await waitFor(async () => !(await js("Boolean(document.querySelector('#customize .cz-style-text'))")) || null, 3000), `${theme}: a second click collapses it`);
      await js('PastelTerm.customize.close()');
    }
    applyTheme('paleSky', { persist: false });

    // Open in editor refuses a path that is not one of the listed styles.
    const refused: Page = await js(`window.pastel.config.openStyle(${JSON.stringify(path.join(claudeDir, 'settings.json'))})`);
    check(refused?.error && stylesFixture.opened.every((f) => f.startsWith(stylesDir)), `Open in editor refuses other paths: ${JSON.stringify(refused)}`);

    // Read-only: the folder is byte for byte what the harness wrote.
    check(hashDir(claudeDir) === before, 'the stand-in ~/.claude is unchanged after every click');

    // Use this style: the badge moves, only outputStyle changes, the hint shows; any other name is refused.
    const stylesHash = hashDir(stylesDir);
    await showFormatting();
    await js(clickUse('Magazine'));
    const moved = await waitFor(async () => { const rows: Page[] = await js(LIST); return rows.find((r) => r.active)?.name === 'Magazine' ? rows : null; }, 5000);
    check(moved && moved.filter((r: Page) => r.active).length === 1 && moved.every((r: Page) => r.use === !r.active), `Use this style moves the badge to Magazine: ${JSON.stringify(moved?.map((r: Page) => [r.name, r.active, r.use]))}`);
    const written = fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8');
    check(written === `${JSON.stringify({ ...SETTINGS, outputStyle: 'Magazine' }, null, 2)}\n`, `settings.json has outputStyle Magazine, every other key, order and indent intact: ${JSON.stringify(written)}`);
    check(fs.readdirSync(claudeDir).sort().join() === 'output-styles,settings.json' && hashDir(stylesDir) === stylesHash, 'nothing else written: no temp file, style files unchanged');
    const hints: string[] = await js(HINTS);
    check(hints.join('|') === HINT('Magazine'), `the hint line shows: ${JSON.stringify(hints)}`);
    await js("document.querySelector('#customize .cz-styles').closest('.cz-card').scrollIntoView({ block: 'start' })");
    await capture('customize-styles-switched-paleSky');

    // A different style in settings.local.json is named in one more line, and that file is never written.
    const local = path.join(claudeDir, 'settings.local.json');
    fs.writeFileSync(local, '{"outputStyle":"Explanatory"}');
    await js(clickUse('Research Paper'));
    const overrideHints = await waitFor(async () => { const h: string[] = await js(HINTS); return h.length === 2 ? h : null; }, 5000);
    check(overrideHints?.[0] === HINT('Research Paper') && /settings\.local\.json names Explanatory, which still wins/.test(overrideHints?.[1] ?? ''), `override line shows: ${JSON.stringify(overrideHints)}`);
    check(fs.readFileSync(local, 'utf8') === '{"outputStyle":"Explanatory"}' && fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8') === SETTINGS_TEXT, 'settings.local.json untouched; settings.json back to the original bytes');
    fs.rmSync(local);

    const unknown: Page[] = await js("Promise.all(['Explanatory', 'magazine.md', '../settings', ''].map((n) => window.pastel.config.useStyle(n)))");
    check(unknown.every((r) => r?.error) && fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8') === SETTINGS_TEXT, `unknown names refused, settings.json unchanged: ${JSON.stringify(unknown)}`);
    await js('PastelTerm.customize.close()');
    await showFormatting();
    check((await js(HINTS)).length === 0, 'reopening clears the hint');
    await js('PastelTerm.customize.close()');

    // Reload on open: a file added while Customize is shut shows on the next open.
    const added = path.join(stylesDir, 'added-later.md');
    fs.writeFileSync(added, '---\nname: Added Later\n---\nNew.\n');
    await showFormatting();
    const afterAdd: Page[] = await js(LIST);
    check(afterAdd.length === expected.length + 1 && afterAdd.some((r) => r.name === 'Added Later'), `reopening reloads the list: ${JSON.stringify(afterAdd.map((r) => r.name))}`);
    await js('PastelTerm.customize.close()');
    fs.rmSync(added);

    // Petal's reply styles: offered, copied from the app bundle on click, usable, then no longer offered.
    const PETAL = ['Petal · Landing Page', 'Petal · Magazine', 'Petal · Pyramid', 'Petal · Research Paper'];
    const bundleDir = bundledStylesDir();
    const bundledFiles = fs.readdirSync(bundleDir).sort();
    check(bundledFiles.join() === 'petal-landing-page.md,petal-magazine.md,petal-pyramid.md,petal-research-paper.md', `the app bundle carries the four styles: ${bundleDir} ${JSON.stringify(bundledFiles)}`);
    const beforePetal = Object.fromEntries(fs.readdirSync(stylesDir).map((f) => [f, fs.readFileSync(path.join(stylesDir, f), 'utf8')]));
    await showFormatting();
    check(await js("Boolean(document.querySelector('#customize .cz-petal-add'))"), 'Add Petal’s reply styles is offered');
    await js("document.querySelector('#customize .cz-petal-add').click()");
    const withPetal = await waitFor(async () => { const rows: Page[] = await js(LIST); return PETAL.every((n) => rows.some((r) => r.name === n)) ? rows : null; }, 5000);
    check(withPetal, `the four Petal styles are listed: ${JSON.stringify(withPetal?.map((r: Page) => r.name))}`);
    const copied = bundledFiles.every((f) => fs.readFileSync(path.join(stylesDir, f), 'utf8') === fs.readFileSync(path.join(bundleDir, f), 'utf8'));
    const untouched = Object.entries(beforePetal).every(([f, text]) => fs.readFileSync(path.join(stylesDir, f), 'utf8') === text);
    const newFiles = fs.readdirSync(stylesDir).filter((f) => !(f in beforePetal)).sort();
    check(copied && untouched && newFiles.join() === bundledFiles.join(), `copied byte for byte, only petal-*.md added, fixture styles untouched: ${JSON.stringify(newFiles)}`);
    check(!(await js("Boolean(document.querySelector('#customize .cz-petal-add'))")) && /^Added Petal’s reply styles/.test((await js(HINTS)).join()), 'the button is gone and the added line shows');
    await js(clickUse('Petal · Magazine'));
    const petalActive = await waitFor(async () => { const rows: Page[] = await js(LIST); return rows.find((r) => r.active)?.name === 'Petal · Magazine' ? rows : null; }, 5000);
    const petalSettings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    check(petalActive && petalSettings.outputStyle === 'Petal · Magazine' && JSON.stringify(Object.keys(petalSettings)) === JSON.stringify(Object.keys(SETTINGS)), `Use this style works on a Petal style: ${petalSettings.outputStyle}`);
    check(!(await js("Boolean(document.querySelector('#customize .cz-petal-add'))")), 'still no offer once they are installed');
    await js("document.querySelector('#customize .cz-styles').closest('.cz-card').scrollIntoView({ block: 'start' })");
    await capture('customize-styles-petal-paleSky');
    await js('PastelTerm.customize.close()');

    // A missing folder: one short line, no list.
    const empty = path.join(outDir, 'styles-claude-missing');
    fs.rmSync(empty, { recursive: true, force: true });
    fs.mkdirSync(empty);
    stylesFixture.claudeDir = empty;
    await showFormatting();
    const missing: Page = await js("({ line: document.querySelector('#customize .cz-empty')?.textContent ?? null, rows: document.querySelectorAll('#customize .cz-style').length })");
    check(missing.rows === 0 && /^No output styles folder at .+\.$/.test(missing.line ?? ''), `missing folder shows one line: ${JSON.stringify(missing)}`);
    await js('PastelTerm.customize.close()');
  } finally {
    stylesFixture.claudeDir = null;
    stylesFixture.opened = [];
    resizeOffscreen(win, startWidth, startHeight);
  }
}
