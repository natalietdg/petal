// Dev-only snapshot step: a new user's first `claude`. A stand-in process named claude prints Claude Code's real
// first-run theme screen (test/fixtures/screens), so the tab is live with no session, as on a fresh install.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import * as configStore from '../main/config-store';
import { claudeFixture, historyFixture } from '../main/snapshot-mode';
import { harnessLine } from '../main/snapshot-shell';
import { resizeOffscreen } from '../main/snapshot-window';
import type { ActiveSession } from '../main/tab-session';
import type { Kit } from './snapshot';

const THEME_SCREEN = 'test/fixtures/screens/firstrun-theme-18rows.txt';
const THEME_TITLE = 'Choose the text style that looks best with your terminal';
const SETUP_LINE = 'Claude Code is setting up in the terminal below.';
const SETUP_ROWS = 24;
const TALL = 1320; // room for the theme card in the dock and 24 rows below it
const ALL_STEPS = ['install', 'add-session', 'sign-in', 'ask'];

const STATE = `(() => {
  const tab = PastelTerm.tabs.active();
  const status = document.getElementById('reader-status');
  const card = document.querySelector('.menu-card');
  return {
    rows: tab?.term.rows ?? 0,
    state: tab?.update?.state ?? 'none',
    sessionId: tab?.update?.sessionId ?? null,
    status: status.innerText,
    action: status.querySelector('.status-action')?.textContent ?? null,
    card: card && !card.hidden ? { title: card.querySelector('.qc-text')?.textContent ?? null, options: [...card.querySelectorAll('.mc-option .qc-label')].map((l) => l.textContent) } : null,
    minimised: PastelTerm.layout.isTerminalMinimised(),
  };
})()`;

interface FirstRunState {
  rows: number;
  state: string;
  sessionId: string | null;
  status: string;
  action: string | null;
  card: { title: string | null; options: string[] } | null;
  minimised: boolean;
}

export async function firstRunCheck(kit: Kit, { win, activeSession }: { win: BrowserWindow; activeSession: ActiveSession }): Promise<void> {
  const { js, wait, waitFor, log, capture, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} first run: ${what}`);
  const state = (): Promise<FirstRunState> => js(STATE);
  const until = (test: (s: FirstRunState) => boolean, ms = 8000) => waitFor(async () => { const s = await state(); return test(s) ? s : null; }, ms);
  const session = activeSession(win.webContents.id);
  if (!session) throw new Error('first run: needs the first tab');

  // A fresh install: folder allowed, no past sessions, nothing ticked, no split of her own.
  historyFixture.records.splice(0);
  configStore.save({ claudeFolder: { choice: 'allowed' }, welcome: { seen: true }, getStarted: { done: ALL_STEPS } });
  claudeFixture.installed = true;
  await js('PastelTerm.overlays.hideCurrent()');
  await js('PastelTerm.getStarted.load()');
  await js('PastelTerm.getStarted.recheckInstall()');

  // Before: the usual split, as 1.0.7 drew it.
  resizeOffscreen(win, 1280, 900);
  await wait(600);
  const usual900 = await state();
  resizeOffscreen(win, 1280, TALL);
  await wait(600);
  const usual = await state();
  log(`usual split: ${usual900.rows} rows at 900px, ${usual.rows} at ${TALL}px`);
  check(usual.rows < SETUP_ROWS, `the usual split is short of Claude Code's first-run screens: ${usual.rows} rows`);

  // A stand-in claude: a copy of sleep, so ps lists it as claude, after the real first-run screen.
  const bin = path.join(outDir, 'first-run-bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.copyFileSync('/bin/sleep', path.join(bin, 'claude'));
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  execFileSync('codesign', ['-s', '-', '-f', path.join(bin, 'claude')]); // a copied system binary is killed until re-signed
  const screen = path.join(app.getAppPath(), THEME_SCREEN);
  configStore.save({ getStarted: { done: [] } });
  await js('PastelTerm.getStarted.load()');
  session.pty.write(harnessLine(`clear; cat '${screen}'; '${path.join(bin, 'claude')}' 600`));

  const setup = await until((s) => s.state === 'live' && s.rows >= SETUP_ROWS && Boolean(s.card), 15000);
  const shown = setup ?? await state();
  check(shown.state === 'live' && shown.sessionId === null, `claude is live with no session yet: ${JSON.stringify({ state: shown.state, sessionId: shown.sessionId })}`);
  check(shown.status.startsWith(SETUP_LINE) && shown.action === 'Show the terminal', `the reader points at the terminal: ${JSON.stringify({ status: shown.status, action: shown.action })}`);
  check(shown.rows >= SETUP_ROWS, `the terminal grows to ${SETUP_ROWS}+ rows at ${TALL}px: ${shown.rows}`);
  check(shown.card?.title === THEME_TITLE && JSON.stringify(shown.card.options) === JSON.stringify(['Auto (match terminal)', 'Dark mode', 'Light mode']),
    `the dock shows the theme picker as a card: ${JSON.stringify(shown.card)}`);
  await capture(`first-run-setup-${TALL}`);

  resizeOffscreen(win, 1280, 900);
  await wait(800);
  const at900 = await state();
  check(at900.rows >= 2 * usual900.rows, `at the default 900px window the terminal gets all the reader chrome leaves: ${at900.rows} rows, was ${usual900.rows}`);
  await capture('first-run-setup-900');

  // Minimised by her earlier: Show the terminal brings it back.
  await js('PastelTerm.layout.setTerminalMinimised(true, false)');
  await js("document.querySelector('#reader-status .status-action').click()");
  const back = await until((s) => !s.minimised, 4000);
  check(back, 'Show the terminal un-minimises it');

  // Signed in (a session file would tick it): the setup room goes and the usual split returns.
  configStore.save({ getStarted: { done: ['sign-in'] } });
  await js('PastelTerm.getStarted.load()');
  const after = await until((s) => s.rows < SETUP_ROWS && !s.status.startsWith(SETUP_LINE), 5000);
  check(after, `past sign-in the reader takes its usual share back: ${JSON.stringify(after ?? await state())}`);

  session.pty.write('\x03');
  configStore.save({ getStarted: { done: ALL_STEPS } });
}
