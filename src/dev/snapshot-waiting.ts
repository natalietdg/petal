// Board's Waiting on you lane (PASTEL_SNAPSHOT_MODE=waiting): two fixture sessions in background tabs, their open Decides on top of the Board.
// Asserts the Board button's badge, rows from both sessions, Doing lines left to the cards, and that a row opens its own tab; light and dark.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit, TabsDeps } from './snapshot';
import { assertFixtureOutsideClaude } from './snapshot-views';
import { resizeTo } from './snapshot-tables';
import { extraTabFixtures } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';

const THEMES = ['paleSky', 'nightPastel']; // one light, one dark
const WIDTH = 990;
const GARDEN_ID = '7a17e001-0000-4000-8000-00000000b001';
const RECIPE_ID = '7a17e002-0000-4000-8000-00000000b002';

const GARDEN_REPLY = [
  '**The watering schedule is half built.**',
  '',
  'Each plant now has a watering interval; reminders are next.',
  '',
  '**Doing:** drafting the reminder times for each plant',
  '**Next:** show the schedule on the home screen',
  '',
  '**Decide:** morning or evening reminders?',
].join('\n');

const RECIPE_REPLY = [
  '**Recipes now scale by serving size.**',
  '',
  '**Doing:** nothing, waiting for you',
  '',
  '**Decide:** round amounts to the nearest quarter cup?',
].join('\n');

function writeLog(file: string, prompt: string, reply: string, at: string): void {
  assertFixtureOutsideClaude(file);
  const base = path.basename(file);
  const lines = [
    { type: 'user', uuid: `${base}-u`, timestamp: at, isSidechain: false, message: { role: 'user', content: prompt } },
    { type: 'assistant', uuid: `${base}-a`, timestamp: at, isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text: reply }] } },
  ];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
}

const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();

// What the lane and the Board button show, rows in order.
const MEASURE = `(() => {
  const lane = document.getElementById('waiting');
  const board = document.getElementById('board');
  const rows = [...lane.querySelectorAll('.waiting-row')].map((r) => ({
    tabId: r.dataset.tabId,
    text: r.querySelector('.waiting-text')?.textContent ?? '',
    session: r.querySelector('.waiting-session')?.textContent ?? '',
    ago: r.querySelector('.waiting-ago')?.textContent ?? '',
  }));
  const grid = board.querySelector('.board-grid');
  return {
    visible: !board.hidden && !lane.hidden && lane.getBoundingClientRect().height > 40,
    aboveCards: Boolean(grid && lane.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING),
    title: lane.querySelector('.waiting-title')?.textContent ?? '',
    pressed: document.getElementById('board-button').getAttribute('aria-pressed'),
    badge: document.querySelector('#board-button .dock-badge').textContent,
    waitingButton: Boolean(document.getElementById('waiting-button')),
    rows,
    readerHidden: document.getElementById('reader').hidden,
  };
})()`;

interface Row { tabId: string; text: string; session: string; ago: string }
interface Measure { visible: boolean; aboveCards: boolean; title: string; pressed: string; badge: string; waitingButton: boolean; rows: Row[]; readerHidden: boolean }

export async function waitingCheck(kit: Kit, { win, openTab }: Pick<TabsDeps, 'openTab'> & { win: BrowserWindow }): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} waiting: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  const dir = path.join(outDir, 'waiting-sessions');
  const startTabs: string[] = await js('PastelTerm.tabs.ids()');
  const startActive: string | null = await js('PastelTerm.tabs.active()?.id ?? null');
  await js('PastelTerm.getStarted.close()'); // a fresh profile opens on Get started, over the reader

  try {
    fs.rmSync(dir, { recursive: true, force: true });
    const garden = path.join(dir, 'garden-planner');
    const recipes = path.join(dir, 'recipe-box');
    fs.mkdirSync(garden, { recursive: true });
    fs.mkdirSync(recipes, { recursive: true });
    writeLog(path.join(dir, `${GARDEN_ID}.jsonl`), 'add a watering schedule', GARDEN_REPLY, minutesAgo(5));
    writeLog(path.join(dir, `${RECIPE_ID}.jsonl`), 'scale recipes by servings', RECIPE_REPLY, minutesAgo(40));
    extraTabFixtures.push(
      { sessionId: GARDEN_ID, transcript: path.join(dir, `${GARDEN_ID}.jsonl`), status: 'busy', cwd: garden },
      { sessionId: RECIPE_ID, transcript: path.join(dir, `${RECIPE_ID}.jsonl`), status: 'idle', cwd: recipes },
    );
    openTab(win.webContents, { background: true });
    openTab(win.webContents, { background: true });

    // Each new tab's id, by the session its reader follows.
    const tabOf = `(id) => PastelTerm.tabs.ids().find((t) => PastelTerm.tabs.get(t)?.update?.sessionId === id && PastelTerm.tabs.get(t).update.replies.length) ?? null`;
    const loaded = await waitFor(async () => {
      const ids = await js(`[${JSON.stringify(GARDEN_ID)}, ${JSON.stringify(RECIPE_ID)}].map(${tabOf})`) as (string | null)[];
      return ids.every(Boolean) ? ids as string[] : null;
    }, 15000);
    check(loaded, `both fixture tabs have their replies: ${JSON.stringify(loaded)}`);
    if (!loaded) return;
    const [gardenTab, recipeTab] = loaded;

    await resizeTo(kit, win, WIDTH);
    await js('PastelTerm.sessionsBoard.resetFilters()'); // the lane shows in the Sessions view
    await js('PastelTerm.waiting.open()');
    await win.webContents.capturePage(); // warm-up: the run's first offscreen frame can be stale

    for (const theme of THEMES) {
      applyTheme(theme, { persist: false });
      await wait(300);
      if (!(await js("PastelTerm.waiting.isOpen()"))) await js('PastelTerm.waiting.open()');
      await js('PastelTerm.waiting.refresh()');
      const m = await js(MEASURE) as Measure;
      log(`waiting ${theme}: ${JSON.stringify(m)}`);
      const ours = m.rows.filter((r) => r.tabId === gardenTab || r.tabId === recipeTab);
      check(m.visible && m.aboveCards && m.title === 'Waiting on you' && m.readerHidden && m.pressed === 'true', `${theme} the lane tops the Board, open over the reader, Board pressed`);
      check(!m.waitingButton, `${theme} no separate Waiting dock button`);
      check(m.rows.length >= 2 && m.badge === String(m.rows.length), `${theme} the Board button's badge counts the lane: "${m.badge}"`);
      check(JSON.stringify(ours.map((r) => r.tabId)) === JSON.stringify([gardenTab, recipeTab]), `${theme} rows from both sessions, newest first, open Decides only`);
      check(ours[0]?.text === 'Morning or evening reminders?' && ours[1]?.text === 'Round amounts to the nearest quarter cup?', `${theme} row text from each reply`);
      check(!m.rows.some((r) => /^Drafting the reminder|^Nothing, waiting/i.test(r.text)), `${theme} Doing lines stay on the cards, not the lane`);
      check(ours.every((r) => r.session && r.ago.endsWith('ago')), `${theme} every row names its session and how long ago`);
      await capture(`waiting-${theme}`);
    }

    // A row opens its own tab and flashes the reply.
    const replyId = await js(`PastelTerm.waiting.shownItems().find((i) => i.tabId === ${JSON.stringify(recipeTab)})?.replyId ?? null`);
    await js(`document.querySelectorAll('.flash').forEach((n) => n.classList.remove('flash')); document.querySelector('#waiting .waiting-row[data-tab-id="${recipeTab}"]').click()`);
    const jumped = await waitFor(async () => {
      const state = await js(`({ active: PastelTerm.tabs.active()?.id, open: PastelTerm.waiting.isOpen(), flashed: Boolean(document.querySelector('[data-reply-id="' + CSS.escape(${JSON.stringify(String(replyId))}) + '"].flash')) })`) as { active: string; open: boolean; flashed: boolean };
      return state.active === recipeTab && !state.open && state.flashed ? state : null;
    }, 3000);
    log(`waiting jump: ${JSON.stringify(jumped)}`);
    check(jumped, `clicking a row activates its tab (${recipeTab}), closes the Board and flashes its reply`);
  } finally {
    extraTabFixtures.length = 0;
    if (await js('PastelTerm.waiting.isOpen()')) await js('PastelTerm.waiting.close()');
    const opened: string[] = (await js('PastelTerm.tabs.ids()')).filter((id: string) => !startTabs.includes(id));
    for (const id of opened) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(id)})`);
    const closedAgain = await waitFor(async () => ((await js('PastelTerm.tabs.ids()')).length === startTabs.length ? true : null), 8000);
    check(closedAgain, `test tabs closed again: ${JSON.stringify(await js('PastelTerm.tabs.ids()'))}`);
    if (startActive) await js(`PastelTerm.tabs.activate(${JSON.stringify(startActive)})`);
    fs.rmSync(dir, { recursive: true, force: true });
    applyTheme('paleSky', { persist: false }); // back to the baseline look for the steps after
    resizeOffscreen(win, startWidth, startHeight);
  }
}
