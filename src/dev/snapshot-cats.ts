// Hoshi and any private local cats, each at 3x and 10x, light and dark, in two scenes; plus a check that she draws.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { LOCAL_CATS } from '../shared/local-cats';
import type { Kit } from './snapshot';

const CATS = ['hoshi', ...LOCAL_CATS.map(({ id }) => id)];
const THEMES = ['paleSky', 'nightPastel'];
const SCENES = ['cherry', 'night'];
const ZOOMS = [['3x', 1], ['10x', 10 / 3]] as const; // the sprite draws at 3px per pixel; 10x scales the corner

const drawn = `(() => {
  const cat = document.getElementById('cat');
  return { cat: cat.dataset.cat, cells: cat.querySelectorAll('.cat-sprite rect').length, sparkle: cat.querySelectorAll('.cat-prop .sparkle rect').length,
    prop: cat.querySelectorAll('.cat-prop rect').length, tip: cat.querySelector('.cat-tip').textContent };
})()`;

export async function catGallery(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, log, wait, applyTheme } = kit;
  const before = await js("({ cat: document.getElementById('cat').dataset.cat, scene: document.getElementById('cat').dataset.scene })");
  log(`cat gallery: ${CATS.join(', ')} (${LOCAL_CATS.length} local)`);
  for (const id of CATS) {
    await js(`PastelTerm.cat.setCat(${JSON.stringify(id)})`);
    const state = await js(drawn);
    log(`${state.cat === id && state.cells > 100 && state.prop > 0 && (id !== 'hoshi' || state.sparkle > 0) ? 'ok' : 'FAIL'} cat ${id} draws with her toy (Hoshi: and its sparkles): ${JSON.stringify(state)}`);
    for (const theme of THEMES) {
      applyTheme(theme, { persist: false });
      for (const scene of SCENES) {
        await js(`PastelTerm.cat.setScene(${JSON.stringify(scene)})`);
        for (const [zoom, scale] of ZOOMS) {
          await js(`document.getElementById('cat').style.transform = ${scale === 1 ? "''" : `'scale(${scale})'`}`);
          await wait(400);
          const box = await js("(() => { const r = document.getElementById('cat').getBoundingClientRect(); return { x: Math.max(0, Math.floor(r.x)), y: Math.max(0, Math.floor(r.y)), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()");
          const file = path.join(kit.outDir, `snapshot-cat-${id}-${theme}-${scene}-${zoom}.png`);
          fs.writeFileSync(file, (await win.webContents.capturePage(box)).toPNG());
        }
      }
    }
    log(`captured cat ${id}: ${THEMES.length * SCENES.length * ZOOMS.length} frames`);
  }
  await js("document.getElementById('cat').style.transform = ''");
  await js(`PastelTerm.cat.setCat(${JSON.stringify(before.cat)}); PastelTerm.cat.setScene(${JSON.stringify(before.scene ?? 'none')})`);
  applyTheme('paleSky', { persist: false });
}
