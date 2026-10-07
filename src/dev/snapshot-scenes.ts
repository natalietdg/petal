// Her rule: every scene keeps something visibly moving, even while Claude rests.
// For each scene in the menu, lists the scene's running animations idle and busy; idle must have one that shows.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { SCENE_CHOICES } from '../main/menu';
import { setFixtureStatus, type Kit } from './snapshot';
import type { ReaderFeed } from '../main/reader-feed';

interface SceneAnimation {
  name: string;
  target: string;
  cells: number;
}

// Running animations on painted elements inside the scene's SVGs; empty groups and the cat's own moves don't count.
const RUNNING_IN_SCENE = `(() => document.getAnimations().flatMap((animation) => {
  const target = animation.effect && animation.effect.target;
  if (!target || animation.playState !== 'running' || !target.closest('#cat svg.scene')) return [];
  const cells = target.tagName === 'rect' ? 1 : target.querySelectorAll('rect').length;
  const box = target.getBoundingClientRect();
  if (!cells || !box.width || !box.height) return [];
  return [{ name: animation.animationName || 'unnamed', target: target.getAttribute('class') || target.tagName, cells }];
}))()`;

const FRAMES = 12;
const FRAME_GAP_MS = 450;
// Fewer sprite cells than this changing over ~5s is too small to notice (every scene measured 30+ when visible).
const MIN_VISIBLE_CELLS = 20;
const CAT_PARTS = "document.querySelectorAll('#cat .cat-sprite, #cat .cat-prop, #cat .cat-z')";

// An occluded window can capture as all-zero pixels; such frames prove nothing either way.
const isBlank = (bitmap: Buffer): boolean => !bitmap.some((byte) => byte !== 0);

// Pixel proof the motion shows: sprite cells whose colour changes in any frame against the first, cat hidden.
// null when the window could not be captured.
async function cellsThatMove(win: BrowserWindow, js: Kit['js'], wait: Kit['wait'], file: string): Promise<number | null> {
  const box = await js("(() => { const r = document.getElementById('cat').getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()");
  const first = await win.webContents.capturePage(box);
  const base = first.toBitmap();
  if (isBlank(base)) return null;
  fs.writeFileSync(file, first.toPNG());
  const changed = new Uint8Array(base.length / 4);
  for (let frame = 1; frame < FRAMES; frame += 1) {
    await wait(FRAME_GAP_MS);
    const image = await win.webContents.capturePage(box);
    const next = image.toBitmap();
    if (next.length !== base.length || isBlank(next)) continue;
    if (frame === FRAMES - 1) fs.writeFileSync(file.replace(/\.png$/, '-later.png'), image.toPNG());
    for (let i = 0; i < changed.length; i += 1) {
      const o = i * 4;
      if (Math.abs(next[o] - base[o]) + Math.abs(next[o + 1] - base[o + 1]) + Math.abs(next[o + 2] - base[o + 2]) > 24) changed[i] = 1;
    }
  }
  const scale = first.getSize().width / box.width;
  const cellPx = (3 * scale) ** 2; // a sprite cell is 3 CSS px square
  return Math.round(changed.reduce((sum, bit) => sum + bit, 0) / cellPx);
}

// One line per distinct animation, e.g. "petal-fall on sc-pa ×12".
function summarise(animations: SceneAnimation[]): string {
  const counts = new Map<string, number>();
  for (const { name, target, cells } of animations) counts.set(`${name} on ${target}`, (counts.get(`${name} on ${target}`) ?? 0) + cells);
  return [...counts].map(([what, cells]) => `${what} ×${cells}`).join(', ') || 'nothing';
}

export async function sceneMotionCheck(kit: Kit, { feed, win }: { feed: ReaderFeed; win: BrowserWindow }): Promise<void> {
  const { js, log, wait, waitFor } = kit;
  const scenes = SCENE_CHOICES.map(([id]) => id).filter((id) => id !== 'none');
  await js(`${CAT_PARTS}.forEach((el) => { el.style.visibility = 'hidden'; })`);
  for (const [status, busy] of [['idle', false], ['busy', true]] as const) {
    setFixtureStatus(feed, status);
    const shown = await waitFor(async () => (await js("document.getElementById('cat').classList.contains('busy')")) === busy || null, 5000);
    if (!shown) log(`FAIL scene motion: the cat never went ${status}`);
    for (const id of scenes) {
      await js(`PastelTerm.cat.setScene(${JSON.stringify(id)}); ${CAT_PARTS}.forEach((el) => { el.style.visibility = 'hidden'; })`);
      // Two frames plus a beat, or the first capture can still show the previous scene. An occluded window never fires rAF.
      await js('new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(resolve)); setTimeout(resolve, 1000); })');
      await wait(500);
      const animations: SceneAnimation[] = await js(RUNNING_IN_SCENE);
      const drawn = await js(`document.querySelectorAll('#cat svg.scene-${id}').length`);
      const moved = await cellsThatMove(win, js, wait, path.join(kit.outDir, `snapshot-scene-${status}-${id}.png`));
      // Only idle is the rule; busy is logged to show what work adds on top.
      const verdict = status === 'busy' ? 'info' : drawn && animations.length ? 'ok' : 'FAIL';
      log(`${verdict} scene motion ${status} ${id}: ${moved === null ? 'pixels not capturable' : `~${moved} cells move`}; ${summarise(animations)}`);
      // Pixels only advise: a covered or off-screen window captures stale frames, so they can't gate.
      if (status === 'idle' && moved !== null && moved < MIN_VISIBLE_CELLS) log(`note scene motion idle ${id}: only ~${moved} cells changed on screen; check the window was visible`);
    }
  }
  setFixtureStatus(feed, 'idle');
  await js("PastelTerm.cat.setScene('none')"); // re-renders the cat, visible again
}
