// Dev-only snapshot step for Open Repo: ⌘O, filtering, Enter recording a `cd`, the index guard, and the reply box shortcut.
// The index points at <snapshot dir>/fake-home (repo-index.ts scanRoot), never her home.
import fs from 'node:fs';
import path from 'node:path';
import { Menu, type BrowserWindow, type MenuItem } from 'electron';
import * as repoIndex from '../main/repo-index';
import { send } from '../main/ipc';
import { repoWrites } from '../main/snapshot-mode';
import { shellQuote } from '../main/resume-command';
import type { Kit, TabsDeps } from './snapshot';

const QUOTED_NAME = "it's-quoted";

function makeRepo(root: string, relative: string, head: string): void {
  const gitDir = path.join(root, relative, '.git');
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'HEAD'), head);
}

// Repos at depths 1 to 4, a detached HEAD, a name that needs quoting, and repos the scan must skip.
function buildFakeHome(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
  makeRepo(root, 'petal-notes', 'ref: refs/heads/main\n');
  makeRepo(root, 'Code/admin-v3', 'ref: refs/heads/feature/auth-migration\n');
  makeRepo(root, 'Code/side/projects/sweep', 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n');
  makeRepo(root, `Code/${QUOTED_NAME}`, 'ref: refs/heads/main\n');
  makeRepo(root, 'Library/hidden', 'ref: refs/heads/main\n');
  makeRepo(root, 'Code/node_modules/dep', 'ref: refs/heads/main\n');
  makeRepo(root, 'Code/admin-v3/vendor/nested', 'ref: refs/heads/main\n');
}

export async function reposCheck(kit: Kit, { win, activeSession, openTab }: TabsDeps & { win: BrowserWindow }): Promise<void> {
  const { js, wait, waitFor, log, themes, applyTheme, verifiedCapture } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} repos: ${what}`);
  const contents = win.webContents;
  const fixtureTab = activeSession(contents.id);
  if (!fixtureTab) throw new Error('repos check: no active tab');

  const fakeHome = repoIndex.scanRoot();
  check(fakeHome.startsWith(kit.outDir), `index root is the scratch fake home: ${fakeHome}`);
  buildFakeHome(fakeHome);
  const index = await repoIndex.refresh();
  const found = index.repos.map((r) => `${r.shortPath}@${r.branch}`).sort();
  const expected = ['~/Code/admin-v3@feature/auth-migration', `~/Code/${QUOTED_NAME}@main`, '~/Code/side/projects/sweep@a1b2c3d', '~/petal-notes@main'].sort();
  check(JSON.stringify(found) === JSON.stringify(expected),
    `scan found the 4 fake repos, skipped Library, node_modules and nested: ${JSON.stringify(found)}`);

  const menuItem = Menu.getApplicationMenu()?.items.flatMap((m): MenuItem[] => m.submenu?.items ?? []).find((i) => i.label === 'Open Repo…');
  check(menuItem?.accelerator === 'CmdOrCtrl+O', `Shell menu has Open Repo… on ${menuItem?.accelerator}`);

  const state = () => js(`(() => ({
    open: !document.getElementById('repos').hidden,
    reader: !document.getElementById('reader').hidden,
    rows: [...document.querySelectorAll('#repos .repos-row')].map((r) => r.querySelector('.repos-name').textContent),
    selected: document.querySelector('#repos .repos-row[aria-selected="true"] .repos-name')?.textContent ?? null,
    branches: [...document.querySelectorAll('#repos .repos-branch')].map((b) => b.textContent),
    hint: document.querySelector('#repos .repos-hint').textContent,
    query: document.querySelector('#repos .repos-search').value,
  }))()`);
  const type = (text: string) => js(`(() => { const s = document.querySelector('#repos .repos-search'); s.value = ${JSON.stringify(text)}; s.dispatchEvent(new Event('input')); })()`);
  const key = (name: string) => js(`document.querySelector('#repos .repos-search').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(name)}, bubbles: true }))`);

  // ⌘O is a menu accelerator; main answers it with repos:palette to the focused window, sent directly here.
  send(contents, 'repos:palette');
  const opened = await waitFor(async () => { const s = await state(); return s.open && s.rows.length === 4 ? s : null; }, 8000);
  check(opened && !opened.reader && opened.branches.includes('a1b2c3d') && /this tab/.test(opened.hint), `⌘O opens the palette over the reader with 4 rows, branch chips, same-tab hint: ${JSON.stringify(opened)}`);
  for (const id of ['paleSky', 'nightPastel']) {
    applyTheme(id, { persist: false });
    await verifiedCapture({ ...kit, theme: themes[id], panelOpen: false, name: `repos-palette-${id}` });
  }
  applyTheme('paleSky', { persist: false });

  await type('adm');
  const filtered = await state();
  check(filtered.rows[0] === 'admin-v3' && filtered.rows.length === 1, `typing "adm" filters to admin-v3: ${JSON.stringify(filtered.rows)}`);
  await type('code');
  await key('ArrowDown');
  const moved = await state();
  check(moved.selected === moved.rows[1], `ArrowDown moves the selection: ${JSON.stringify({ rows: moved.rows, selected: moved.selected })}`);
  await type('quoted');
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: false, name: 'repos-palette-filtered' });

  const before = repoWrites.length;
  await key('Enter');
  const written = await waitFor(() => repoWrites[before] ?? null, 5000);
  const want = `cd ${shellQuote(path.join(fakeHome, 'Code', QUOTED_NAME))}\r`;
  check(written && written.command === want && written.tabId === fixtureTab.tabId && !written.newTab,
    `Enter records ${JSON.stringify(want)} for the fixture tab: ${JSON.stringify(written)}`);
  const closed = await state();
  check(!closed.open && closed.reader, `Enter closes the palette, reader back: ${JSON.stringify({ open: closed.open, reader: closed.reader })}`);

  const rejected = await js(`window.pastel.repos.open(${JSON.stringify(fixtureTab.tabId)}, '/etc')`);
  check('note' in rejected && repoWrites.length === before + 1, `a path outside the index is refused, nothing typed: ${JSON.stringify(rejected)}`);

  send(contents, 'repos:palette');
  await waitFor(async () => (await state()).open || null, 5000);
  await key('Escape');
  check(!(await state()).open, 'Esc closes the palette');

  // Reply box: a tab without Claude turns "checkout <name>" into the palette, pre-filled, and types nothing.
  openTab(contents);
  const fresh = await waitFor(() => { const next = activeSession(contents.id); return next && next !== fixtureTab ? next : null; }, 8000);
  if (!fresh) throw new Error('repos check: second tab never opened');
  await wait(2500); // login shell rc files
  let freshOutput = '';
  const listener = fresh.pty.onData((data) => { freshOutput += data; });
  await js("(() => { const box = document.getElementById('composer-input'); box.value = 'Checkout sweep'; box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()");
  const prefilled = await waitFor(async () => { const s = await state(); return s.open ? s : null; }, 5000);
  await wait(500);
  listener.dispose();
  check(prefilled?.query === 'sweep' && prefilled.rows[0] === 'sweep' && !freshOutput.includes('claude-start'),
    `reply box "Checkout sweep" opens the palette pre-filled, nothing sent: ${JSON.stringify({ query: prefilled?.query, rows: prefilled?.rows, typed: freshOutput.includes('claude-start') })}`);
  await key('Escape');

  // A name nothing matches stays a normal message (snapshot runs echo instead of launching claude).
  const fallbackListener = fresh.pty.onData((data) => { freshOutput += data; });
  await js("(() => { const box = document.getElementById('composer-input'); box.value = 'cd zzqqxx'; box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()");
  const fellBack = await waitFor(() => (/claude-start cd zzqqxx/.test(freshOutput) ? true : null), 8000);
  fallbackListener.dispose();
  check(fellBack && !(await state()).open, 'reply box "cd <no match>" goes to Claude as before, no palette');

  await js(`document.querySelector('#tab-strip .tab[data-tab-id="${fresh.tabId}"] .tab-close').click()`);
  await waitFor(() => (activeSession(contents.id) === fixtureTab ? true : null), 8000);
}
