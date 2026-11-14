// Tarot Room: the scene renders with today's card face, hover shows its tip, click opens the reading, Esc and an outside click close it.
// Customize › Look has no birthday field: everyone shares the day's card.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { unclippedCheck } from './snapshot-divider';
import { cardFor } from '../renderer/scenes/tarot-deck';

const STATE = `(() => {
  const root = document.documentElement;
  const scene = document.querySelector('#cat .scene-tarot');
  const faces = [...document.querySelectorAll('#cat .scene-tarot .scene-variant')];
  const shown = faces.filter((g) => getComputedStyle(g).display !== 'none').map((g) => g.dataset.variant);
  const tip = document.querySelector('.tarot-tip');
  const popover = document.querySelector('.tarot-popover');
  return {
    scene: Boolean(scene),
    rects: scene ? scene.querySelectorAll('rect').length : 0,
    faces: faces.length,
    shown,
    trCard: root.dataset.trCard,
    tipShown: Boolean(tip && !tip.hidden && tip.getBoundingClientRect().height > 0),
    tip: tip ? tip.innerText : '',
    popoverShown: Boolean(popover && !popover.hidden && popover.getBoundingClientRect().height > 0),
    popover: popover ? popover.innerText : '',
  };
})()`;
const SCENE_RECT = "document.querySelector('#cat .scene-tarot rect:nth-of-type(400)')";
const hover = `${SCENE_RECT}.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`;
const click = `${SCENE_RECT}.dispatchEvent(new MouseEvent('click', { bubbles: true }))`;
const escape = "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))";
const clickOutside = "document.getElementById('reader').dispatchEvent(new MouseEvent('click', { bubbles: true }))";

// The unfocused snapshot window hands back the previous frame once; take and drop one capture first.
async function settle(kit: Kit, win: BrowserWindow): Promise<void> {
  win.webContents.invalidate();
  await kit.wait(400);
  await win.webContents.capturePage();
  await kit.wait(400);
}

// The cat's box plus whatever scene tip or card is open above it.
export async function captureRoom(kit: Kit, win: BrowserWindow, name: string): Promise<void> {
  await settle(kit, win);
  const box = await kit.js(`(() => {
    const rects = ['#cat', '.scene-tip:not([hidden])', '.scene-popover:not([hidden])'].map((s) => document.querySelector(s)).filter(Boolean).map((el) => el.getBoundingClientRect());
    const x = Math.min(...rects.map((r) => r.left)) - 20, y = Math.min(...rects.map((r) => r.top)) - 20;
    return { x: Math.floor(x), y: Math.floor(y), width: Math.ceil(Math.max(...rects.map((r) => r.right)) - x + 20), height: Math.ceil(Math.max(...rects.map((r) => r.bottom)) - y + 20) };
  })()`);
  const file = path.join(kit.outDir, `snapshot-${name}.png`);
  fs.writeFileSync(file, (await win.webContents.capturePage(box)).toPNG());
  kit.log(`captured ${name}: ${file}`);
}

// The birthday field is gone from Customize › Look, and the reading never shows a birth card.
async function noBirthdayCheck(kit: Kit, check: (ok: unknown, what: string) => void): Promise<void> {
  const { js, wait, waitFor } = kit;
  await js("PastelTerm.customize.open('look')");
  await waitFor(() => js("Boolean(document.querySelector('#customize-body .cz-card'))"), 5000);
  const field = await js("Boolean(document.querySelector('#customize-body .cz-date, #customize-body .cz-birthday'))");
  const text = await js("document.getElementById('customize-body').innerText");
  check(!field && !/birthday|date of birth/i.test(text), `Customize › Look has no birthday field: field=${field}`);
  await js('PastelTerm.customize.close()');
  await js(click);
  await wait(200);
  const opened = await js(STATE);
  await unclippedCheck(kit, 'tarot popover', '.scene-popover:not([hidden])');
  check(opened.popoverShown && !/birth card/i.test(opened.popover), `the reading has no birth card line: ${JSON.stringify(opened.popover)}`);
  await js(escape);
  await wait(200);
}

export async function tarotCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, applyTheme } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} tarot: ${what}`);
  const today = cardFor(new Date());
  const before = await js("document.getElementById('cat').dataset.scene");

  await js("PastelTerm.cat.setScene('tarot')");
  const drawn = await waitFor(async () => {
    const now = await js(STATE);
    return now.scene && now.shown.length === 1 ? now : null;
  }, 5000);
  const state = drawn ?? await js(STATE);
  check(state.rects > 1000 && state.faces === 22, `scene renders with all 22 faces drawn: ${state.rects} rects, ${state.faces} faces`);
  check(state.trCard === String(today.number) && state.shown.join() === String(today.number), `only today's face shows (${today.numeral} ${today.name}): shown=${JSON.stringify(state.shown)} data-tr-card=${state.trCard}`);
  for (const id of ['paleSky', 'nightPastel']) {
    applyTheme(id, { persist: false });
    await captureRoom(kit, win, `tarot-${id}`);
  }
  applyTheme('paleSky', { persist: false });

  await js(hover);
  const tipped = await waitFor(async () => {
    const now = await js(STATE);
    return now.tipShown ? now : null;
  }, 3000);
  const tip = tipped ?? await js(STATE);
  check(tipped && tip.tip.includes(today.name) && tip.tip.includes(today.reading), `hover tip shows today's name and reading: ${JSON.stringify(tip.tip)}`);
  await captureRoom(kit, win, 'tarot-tip-paleSky');

  await js(click);
  await wait(200);
  const opened = await js(STATE);
  check(opened.popoverShown && !opened.tipShown && opened.popover.includes(today.name) && opened.popover.includes(today.numeral) && opened.popover.includes(today.reading),
    `click opens the reading with numeral, name and reading: ${JSON.stringify(opened.popover)}`);
  for (const id of ['paleSky', 'nightPastel']) {
    applyTheme(id, { persist: false });
    await captureRoom(kit, win, `tarot-popover-${id}`);
  }
  applyTheme('paleSky', { persist: false });

  await js(escape);
  check(await waitFor(async () => !(await js(STATE)).popoverShown || null, 3000), 'Esc closes the reading');

  await js(click);
  await wait(200);
  const reopened = (await js(STATE)).popoverShown;
  await js(clickOutside);
  check(reopened && await waitFor(async () => !(await js(STATE)).popoverShown || null, 3000), 'a click outside closes the reading');

  await noBirthdayCheck(kit, check);

  await js(`PastelTerm.cat.setScene(${JSON.stringify(before ?? 'none')})`);
}
