// Dev-only snapshot step for images and files: synthetic paste and drop events, never her clipboard or keyboard.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { ptyWrites } from '../main/snapshot-mode';
import { PASTE_DIR_NAME } from '../main/paste-files';
import type { Kit, TabsDeps } from './snapshot';

// An 8x8 pink PNG, so the page can build a real image File.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGP439CAFTEMLQkACnZ/wR8hFMgAAAAASUVORK5CYII=';
const DROPPED = "/tmp/petal drop/it's a file.png";
const DROPPED_TYPED = "'/tmp/petal drop/it'\\''s a file.png' ";

// Page-side helpers: a File from the PNG, and DataTransfers for paste and drop.
const PAGE_HELPERS = `
  const pngFile = () => new File([Uint8Array.from(atob(${JSON.stringify(PNG_BASE64)}), (c) => c.charCodeAt(0))], 'image.png', { type: 'image/png' });
  const imageData = () => { const d = new DataTransfer(); d.items.add(pngFile()); return d; };
  const textData = (text) => { const d = new DataTransfer(); d.setData('text/plain', text); return d; };
  const dropData = () => { const d = new DataTransfer(); d.setData('text/uri-list', ${JSON.stringify(`file://${encodeURI(DROPPED)}`)}); return d; };
  const paste = (target, data) => { const e = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }); target.dispatchEvent(e); return e.defaultPrevented; };
  const drop = (target, data) => {
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
    const e = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e.defaultPrevented;
  };
  const activeHost = () => [...document.querySelectorAll('.term-host')].find((h) => h.offsetHeight > 0);
`;

export async function pasteCheck(kit: Kit, { win, activeSession, openTab }: TabsDeps & { win: BrowserWindow }): Promise<void> {
  const { js, wait, waitFor, log, themes, applyTheme, verifiedCapture } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} paste: ${what}`);
  const page = (code: string) => js(`(() => { ${PAGE_HELPERS} ${code} })()`);
  const contents = win.webContents;
  const fixtureTab = activeSession(contents.id);
  if (!fixtureTab) throw new Error('paste check: no active tab');
  const writesSince = (from: number) => ptyWrites.slice(from).filter((w) => w.tabId === fixtureTab.tabId).map((w) => w.data);
  const clearLine = async () => { fixtureTab.pty.write('\x15\x15'); await wait(300); }; // the first ^U may be taken by ^V's quoted insert

  // Terminal, ⌘V with only an image: Claude's own Ctrl+V, nothing else.
  let from = ptyWrites.length;
  const imageHandled = await page('return paste(activeHost().querySelector(".xterm-helper-textarea"), imageData());');
  await waitFor(() => writesSince(from).length || null, 3000);
  check(imageHandled && JSON.stringify(writesSince(from)) === JSON.stringify(['\x16']), `image paste in the terminal writes Ctrl+V to the fixture tab: ${JSON.stringify(writesSince(from))}`);
  await clearLine();

  // Terminal, ⌘V with text: xterm pastes it as before.
  from = ptyWrites.length;
  const textHandled = await page('return paste(activeHost().querySelector(".xterm-helper-textarea"), textData("petal-text-paste"));');
  const textWrites = await waitFor(() => (writesSince(from).join('').includes('petal-text-paste') ? writesSince(from) : null), 3000);
  check(!textHandled && textWrites && !textWrites.includes('\x16'), `text paste is left to xterm, unchanged: ${JSON.stringify(textWrites)}`);
  await clearLine();

  // Terminal, drop: the quoted path, then a space.
  from = ptyWrites.length;
  const termDropped = await page('return drop(activeHost(), dropData());');
  const dropWrites = await waitFor(() => (writesSince(from).join('').includes(DROPPED_TYPED) ? writesSince(from) : null), 3000);
  check(termDropped && dropWrites, `drop on the terminal types the quoted path ${JSON.stringify(DROPPED_TYPED)}: ${JSON.stringify(writesSince(from))}`);
  await clearLine();

  // Reply box, drop: the quoted path at the cursor.
  const boxDrop = await page(`const box = document.getElementById('composer-input'); box.value = 'look at '; box.setSelectionRange(8, 8);
    const handled = drop(document.getElementById('composer'), dropData()); return { handled, value: box.value };`);
  check(boxDrop.handled && boxDrop.value === `look at ${DROPPED_TYPED}`, `drop on the reply box inserts the quoted path: ${JSON.stringify(boxDrop)}`);
  await js("document.getElementById('composer-input').value = ''");

  // Reply box, image paste: a chip per image, each removable; sends go from a fresh tab so the fixture shell stays clean.
  openTab(contents);
  const fresh = await waitFor(() => { const next = activeSession(contents.id); return next && next !== fixtureTab ? next : null; }, 8000);
  if (!fresh) throw new Error('paste check: second tab never opened');
  await wait(2500); // login shell rc files
  const chips = () => js("[...document.querySelectorAll('#composer-attachments .composer-chip img')].map((img) => img.alt)");
  await page("const box = document.getElementById('composer-input'); paste(box, imageData()); paste(box, imageData());");
  const two = await waitFor(async () => ((await chips()).length === 2 ? chips() : null), 5000);
  check(two, `two image pastes show two chips: ${JSON.stringify(two)}`);
  const edges = await js("({ chip: Math.round(document.querySelector('#composer-attachments .composer-chip').getBoundingClientRect().left), box: Math.round(document.getElementById('composer-input').getBoundingClientRect().left) })");
  check(Math.abs(edges.chip - edges.box) <= 1, `chips line up with the text box: ${JSON.stringify(edges)}`);
  const pasteFolder = path.join(kit.outDir, PASTE_DIR_NAME);
  const saved = fs.existsSync(pasteFolder) ? fs.readdirSync(pasteFolder).filter((f) => f.endsWith('.png')) : [];
  const isPng = saved.every((f) => fs.readFileSync(path.join(pasteFolder, f)).subarray(1, 4).toString() === 'PNG');
  check(saved.length >= 2 && isPng, `each paste is saved as a PNG in the scratch petal-paste folder: ${saved.length} files`);
  await js("document.getElementById('composer-input').value = 'echo petal-image-sent'");
  for (const id of ['paleSky', 'nightPastel']) {
    applyTheme(id, { persist: false });
    await verifiedCapture({ ...kit, theme: themes[id], panelOpen: false, name: `composer-image-chip-${id}` });
  }
  applyTheme('paleSky', { persist: false });
  await js("document.querySelector('#composer-attachments .composer-chip-remove').click()");
  const one = await chips();
  check(one.length === 1, `the remove button takes a chip away: ${JSON.stringify(one)}`);

  let freshOutput = '';
  const listener = fresh.pty.onData((data) => { freshOutput += data; });
  await js("document.getElementById('composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))");
  const sent = await waitFor(() => freshOutput.match(/claude-start echo petal-image-sent (\S+\.png)/)?.[1] ?? null, 8000);
  listener.dispose();
  const after = await js("({ chips: document.querySelectorAll('#composer-attachments .composer-chip').length, hidden: document.getElementById('composer-attachments').hidden, value: document.getElementById('composer-input').value })");
  check(sent && fs.existsSync(sent) && path.dirname(sent) === pasteFolder, `the sent message carries the saved image path: ${sent}`);
  check(after.chips === 0 && after.hidden && after.value === '', `sending clears the chips and the box: ${JSON.stringify(after)}`);

  await js(`document.querySelector('#tab-strip .tab[data-tab-id="${fresh.tabId}"] .tab-close').click()`);
  await waitFor(() => (activeSession(contents.id) === fixtureTab ? true : null), 8000);
}
