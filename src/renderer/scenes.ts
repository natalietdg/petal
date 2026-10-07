// Pixel scenes behind the cat, at 3px per sprite pixel, drawn from simple shapes.
// Each scene is its own file in scenes/; this is the registry and the SVG renderer.
import type { CellClass, Scene } from './scenes/kit';
import bakery from './scenes/bakery';
import beach from './scenes/beach';
import cherry from './scenes/cherry';
import howl from './scenes/howl';
import midcentury from './scenes/midcentury';
import night from './scenes/night';
import planetarium from './scenes/planetarium';
import rug from './scenes/rug';
import starlit from './scenes/starlit';
import study from './scenes/study';
import tarot from './scenes/tarot';
import winter from './scenes/winter';

// Each scene paints a cell with a class letter (see .sc-* in cat.css), or null for empty.
// `moving` cells go in their own group so a scene can animate just those.
const SCENES: Record<string, Scene> = { cherry, beach, night, starlit, planetarium, rug, winter, bakery, howl, study, midcentury, tarot };

const rect = (x: number, y: number, cell: CellClass): string => `<rect x="${x}" y="${y}" width="1" height="1" class="sc-${cell}"/>`;

export interface SceneLayers {
  back: string;
  front: string;
}

// Returns the scene as two layers: `back` sits behind the cat, `front` (if the scene has one) in front of her.
export function svg(id: string): SceneLayers {
  const scene = has(id) ? SCENES[id] : undefined;
  if (!scene) return { back: '', front: '' };
  const [width, height] = scene.size;
  const back: string[] = [];
  const front: string[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = scene.paint(x, y);
      if (cell) (scene.front?.(x, y) ? front : back).push(rect(x, y, cell));
    }
  }
  const moving = scene.moving.map(([x, y, cell]) => rect(x, y, cell)).join('');
  const crab = (scene.crab ?? []).map(([x, y, cell]) => rect(x, y, cell)).join('');
  const variants = Object.entries(scene.variants ?? {})
    .map(([key, cells]) => `<g class="scene-variant" data-variant="${key}">${cells.map(([x, y, cell]) => rect(x, y, cell)).join('')}</g>`).join('');
  const open = (layer: string) => `<svg class="scene scene-${id} scene-${layer}" viewBox="0 0 ${width} ${height}" width="${width * 3}" height="${height * 3}" shape-rendering="crispEdges" aria-hidden="true">`;
  return {
    back: `${open('back')}${back.join('')}${variants}<g class="scene-moving">${moving}</g>${crab ? `<g class="scene-crab">${crab}</g>` : ''}</svg>`,
    front: front.length ? `${open('front')}${front.join('')}</svg>` : '',
  };
}

export const has = (id: string): boolean => Object.hasOwn(SCENES, id);
