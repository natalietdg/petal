// Dev-only snapshot step: the Stop button in the reply box, on the streaming reply and on Board cards, and ⌘.
// Status is the fixture's; Escs are recorded in main (stopWrites), never typed.
import fs from 'node:fs';
import path from 'node:path';
import { Menu, type BrowserWindow } from 'electron';
import { stopWrites } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import type { ReaderFeed } from '../main/reader-feed';
import type { Kit, TabsDeps } from './snapshot';

// A permission prompt shape from shared/prompt-answer.ts, so the screen reads as asking.
const PERMISSION_SCREEN = [
  '─'.repeat(40), ' Bash command', '', '   npm test', '', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', '', ' Esc to cancel · Tab to amend',
];
const THEMES = ['paleSky', 'blush', 'nightPastel'];
const LOOKS = ['newspaper', 'editorial', 'lifestyle', 'print'];
const MIN_RATIO = 4.5;

interface StopState {
  composer: { shown: boolean; text: string; name: string | null; title: string; phase: string | null; tabId: string | null } | null;
  sendShown: boolean;
  reader: { text: string; name: string | null } | null;
  board: { text: string; name: string | null; tabId: string | null } | null;
}

const STATE = `(() => {
  const shown = (b) => b && !b.hidden && b.getClientRects().length > 0;
  const info = (b) => (shown(b) ? { text: b.textContent, name: b.getAttribute('aria-label'), title: b.title, phase: b.dataset.phase ?? null, tabId: b.dataset.tabId ?? null, shown: true } : null);
  return {
    composer: info(document.querySelector('#composer .stop-composer')),
    sendShown: shown(document.getElementById('composer-send')),
    reader: info(document.querySelector('#reader-status .stop-reader')),
    board: info(document.querySelector('#board .stop-board')),
  };
})()`;

// Contrast of a button's text on its own background, plus whether it fits the box beside "/" and Send.
const MEASURE = `(() => {
  const rgb = (s) => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => { const c = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b); };
  const ratio = (el) => { const s = getComputedStyle(el); const a = lum(rgb(s.color)), b = lum(rgb(s.backgroundColor)); const [hi, lo] = a > b ? [a, b] : [b, a]; return Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100; };
  const stop = document.querySelector('#composer .stop-composer');
  const reader = document.querySelector('#reader-status .stop-reader');
  const box = document.getElementById('composer-input').getBoundingClientRect();
  const actions = document.getElementById('composer-actions').getBoundingClientRect();
  const parts = ['composer-slash', 'composer-send'].map((id) => document.getElementById(id).getBoundingClientRect());
  const s = stop.getBoundingClientRect();
  const overlaps = parts.some((p) => s.left < p.right && p.left < s.right);
  const textRoom = box.right - parseFloat(getComputedStyle(document.getElementById('composer-input')).paddingRight);
  return {
    composer: ratio(stop), reader: reader ? ratio(reader) : null,
    inside: s.left >= box.left && s.right <= box.right && s.top >= box.top && s.bottom <= box.bottom,
    clearOfText: textRoom <= actions.left, overlaps, oneRow: Math.abs(s.top - parts[1].top) < 12,
    width: Math.round(window.innerWidth),
  };
})()`;

export async function stopButtonCheck(kit: Kit, { win, feed, activeSession }: Pick<TabsDeps, 'activeSession'> & { win: BrowserWindow; feed: ReaderFeed }): Promise<void> {
  const { js, wait, waitFor, log, outDir } = kit;
  const session = activeSession(win.webContents.id);
  if (!session || !feed.fixture) throw new Error('stop check: needs the fixture tab');
  const fixture = feed.fixture;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} ${what}`);
  const state = (): Promise<StopState> => js(STATE);
  const until = (ok: (s: StopState) => boolean) => waitFor(async () => { const s = await state(); return ok(s) ? s : null; }, 8000);
  const escsFor = (tabId: string) => stopWrites.filter((w) => w.tabId === tabId).length;
  const setStatus = (status: string) => { fixture.status = status; };
  const shot = async (name: string, clip?: Electron.Rectangle) => {
    await wait(600);
    const file = path.join(outDir, `${name}.png`);
    fs.writeFileSync(file, (await win.webContents.capturePage(clip)).toPNG());
    log(`captured ${name}: ${file}`);
  };
  const shellScreen = async (lines: string[] | null) => {
    session.pty.write('\x03');
    await wait(200);
    if (!lines) { session.pty.write('clear\r'); return; }
    const target = path.join(outDir, 'screen-stop-permission.txt');
    fs.writeFileSync(target, `${lines.join('\n')}\n`);
    session.pty.write(`clear; cat '${target}'; read -r _\r`);
  };
  const tabId = session.tabId;
  kit.applyTheme('paleSky', { persist: false });
  await js('PastelTerm.layout.setTerminalMinimised(false, false)');

  // Idle: nothing to stop.
  setStatus('idle');
  const idle = await until((s) => !s.composer && !s.reader);
  check(idle, `idle: no Stop anywhere: ${JSON.stringify(idle)}`);

  // Busy: the reply box, the streaming reply's header and the Board card all offer it.
  setStatus('busy');
  const busy = await until((s) => Boolean(s.composer && s.reader));
  check(busy?.composer && busy.composer.text === 'Stop' && busy.composer.name === 'Stop Claude' && busy.composer.title === 'Stop Claude (Esc in the terminal)'
    && busy.composer.tabId === tabId && busy.sendShown, `busy: Stop before Send in the reply box, Send still there: ${JSON.stringify(busy)}`);
  check(busy?.reader?.name === 'Stop Claude', `busy: Stop on the streaming reply's header: ${JSON.stringify(busy?.reader)}`);

  // Contrast in 3 themes x 4 looks, and it fits the box at 800px.
  const [startWidth, startHeight] = win.getContentSize();
  resizeOffscreen(win, 800, 900);
  await wait(500);
  for (const theme of THEMES) {
    kit.applyTheme(theme, { persist: false });
    for (const look of LOOKS) {
      await js(`document.documentElement.dataset.reading = '${look}'`);
      await wait(250);
      const m = await js(MEASURE);
      check(m.composer >= MIN_RATIO && (m.reader ?? 0) >= MIN_RATIO && m.inside && m.clearOfText && !m.overlaps && m.oneRow,
        `${theme}/${look} at ${m.width}px: contrast composer ${m.composer}:1 reader ${m.reader}:1, inside box ${m.inside}, text clear ${m.clearOfText}, no overlap ${!m.overlaps}, one row ${m.oneRow}`);
    }
  }
  await js("document.documentElement.dataset.reading = 'newspaper'");
  kit.applyTheme('paleSky', { persist: false });
  await wait(400);
  await shot('composer');
  resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 1000);
  await wait(500);

  // Board: the working card in this window has its own Stop.
  await js('PastelTerm.sessionsBoard.open()');
  const board = await until((s) => Boolean(s.board));
  check(board?.board?.name === 'Stop Claude' && board.board.tabId === tabId, `board: working card offers Stop for its tab: ${JSON.stringify(board?.board)}`);
  const card = await js(`(() => { const r = document.querySelector('#board .board-item.has-stop').getBoundingClientRect(); return { x: Math.max(0, Math.floor(r.x) - 16), y: Math.max(0, Math.floor(r.y) - 16), width: Math.ceil(r.width) + 32, height: Math.ceil(r.height) + 32 }; })()`);
  await shot('board', card);
  const beforeBoard = escsFor(tabId);
  await js("document.querySelector('#board .stop-board').click()");
  const boardStopping = await until((s) => s.board?.name === 'Stopping...');
  check(escsFor(tabId) === beforeBoard + 1 && boardStopping, `board: click records one Esc for tab ${tabId} and says Stopping...: ${stopWrites.length} writes`);
  await js('PastelTerm.sessionsBoard.close()');

  // Reply box: a double click still types one Esc; Stopping... until Claude stops.
  setStatus('idle');
  await until((s) => !s.composer);
  await wait(1100); // past main's guard for the board's Esc
  setStatus('busy');
  await until((s) => s.composer?.phase === 'offered');
  const before = escsFor(tabId);
  await js("(() => { const b = document.querySelector('#composer .stop-composer'); b.click(); b.click(); })()");
  const stopping = await until((s) => s.composer?.text === 'Stopping...');
  await wait(600);
  check(escsFor(tabId) === before + 1 && stopWrites.at(-1)?.keys.join() === '\x1b' && stopping, `reply box: double click records exactly one Esc for ${tabId}: ${escsFor(tabId) - before}`);
  setStatus('idle');
  check(await until((s) => !s.composer && !s.reader), 'Stopping... goes once Claude is idle');

  // ⌘.: the menu has it, and it stops a working Claude.
  const item = Menu.getApplicationMenu()?.items.flatMap((m) => m.submenu?.items ?? []).find((i) => i.label === 'Stop Claude');
  check(item?.accelerator === 'CmdOrCtrl+.', `menu: Stop Claude on ${item?.accelerator}`);
  await wait(1100);
  setStatus('busy');
  await until((s) => s.composer?.phase === 'offered');
  const beforeKey = escsFor(tabId);
  win.webContents.send('claude:stop');
  check(await waitFor(() => (escsFor(tabId) === beforeKey + 1 ? true : null), 4000), '⌘. records one Esc');
  setStatus('idle');
  await until((s) => !s.composer);
  await wait(1100);

  // Waiting (a prompt Claude Code reports): hidden, and ⌘. types nothing.
  setStatus('waiting');
  await wait(1500);
  const waiting = await state();
  const beforeWaiting = stopWrites.length;
  win.webContents.send('claude:stop');
  await wait(800);
  check(!waiting.composer && !waiting.reader && stopWrites.length === beforeWaiting, `waiting: no Stop, ⌘. sends nothing: ${JSON.stringify(waiting)}`);

  // Busy but a permission prompt on screen: hidden, ⌘. sends nothing.
  setStatus('busy');
  await until((s) => Boolean(s.composer));
  await shellScreen(PERMISSION_SCREEN);
  const asking = await until((s) => !s.composer && !s.reader);
  const beforeAsking = stopWrites.length;
  win.webContents.send('claude:stop');
  await wait(800);
  check(asking && stopWrites.length === beforeAsking, `prompt on screen: no Stop, ⌘. sends nothing: ${JSON.stringify(asking)}`);
  await shellScreen(null);
  check(await until((s) => Boolean(s.composer)), 'Stop is back once the prompt leaves the screen');

  // History open: its reply box has no Stop, and ⌘. leaves the past session alone.
  await js('PastelTerm.history.open?.()');
  await wait(800);
  const historyStops = await js("document.querySelectorAll('#history .stop-claude').length");
  const beforeHistory = stopWrites.length;
  win.webContents.send('claude:stop');
  await wait(800);
  check(historyStops === 0 && stopWrites.length === beforeHistory, `History: no Stop, ⌘. sends nothing (${historyStops} buttons)`);
  await js('PastelTerm.overlays.hideCurrent()');

  // Idle: hidden again, ⌘. sends nothing.
  setStatus('idle');
  await until((s) => !s.composer);
  const beforeIdle = stopWrites.length;
  win.webContents.send('claude:stop');
  await wait(800);
  check(stopWrites.length === beforeIdle, 'idle: ⌘. sends nothing');
  log(`stop writes: ${JSON.stringify(stopWrites)}`);
}
