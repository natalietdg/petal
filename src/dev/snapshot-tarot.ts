// Tarot Room: the scene renders with today's card face, hover shows its tip, click opens the reading, Esc and an outside click close it.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
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

// The cat's box plus whatever tarot tip or popover is open above it.
async function captureRoom(kit: Kit, win: BrowserWindow, name: string): Promise<void> {
  await kit.wait(400);
  const box = await kit.js(`(() => {
    const rects = ['#cat', '.tarot-tip:not([hidden])', '.tarot-popover:not([hidden])'].map((s) => document.querySelector(s)).filter(Boolean).map((el) => el.getBoundingClientRect());
    const x = Math.min(...rects.map((r) => r.left)) - 20, y = Math.min(...rects.map((r) => r.top)) - 20;
    return { x: Math.floor(x), y: Math.floor(y), width: Math.ceil(Math.max(...rects.map((r) => r.right)) - x + 20), height: Math.ceil(Math.max(...rects.map((r) => r.bottom)) - y + 20) };
  })()`);
  const file = path.join(kit.outDir, `snapshot-${name}.png`);
  fs.writeFileSync(file, (await win.webContents.capturePage(box)).toPNG());
  kit.log(`captured ${name}: ${file}`);
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
  await wait(200);
  check(!(await js(STATE)).popoverShown, 'Esc closes the reading');

  await js(click);
  await wait(200);
  const reopened = (await js(STATE)).popoverShown;
  await js(clickOutside);
  await wait(200);
  check(reopened && !(await js(STATE)).popoverShown, 'a click outside closes the reading');

  await js(`PastelTerm.cat.setScene(${JSON.stringify(before ?? 'none')})`);
}
