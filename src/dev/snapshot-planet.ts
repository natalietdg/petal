// Planetarium: the dome shows today's planet, hover names it, click opens the card with facts and tomorrow's planet, Esc closes it.
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { captureRoom } from './snapshot-tarot';
import { localDayNumber } from '../renderer/scenes/daily';
import { planetLabel } from '../renderer/scenes/planet-facts';

const STATE = `(() => {
  const scene = document.querySelector('#cat .scene-planetarium');
  const tip = document.querySelector('.planet-tip');
  const popover = document.querySelector('.planet-popover');
  const visible = (el) => Boolean(el && !el.hidden && el.getBoundingClientRect().height > 0);
  const lit = scene ? [...scene.querySelectorAll('rect[class^="sc-pl-"]')].filter((r) => /^sc-pl-(mercury|venus|earth|mars|jupiter|saturn|uranus|neptune)-/.test(r.getAttribute('class')) && getComputedStyle(r).display !== 'none') : [];
  return {
    scene: Boolean(scene),
    plPlanet: document.documentElement.dataset.plPlanet,
    shownPlanets: [...new Set(lit.map((r) => r.getAttribute('class').split('-')[2]))],
    tipShown: visible(tip),
    tip: tip ? tip.innerText : '',
    popoverShown: visible(popover),
    popover: popover ? popover.innerText : '',
  };
})()`;
const SCENE_RECT = "document.querySelector('#cat .scene-planetarium rect:nth-of-type(400)')";
const hover = `${SCENE_RECT}.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`;
const click = `${SCENE_RECT}.dispatchEvent(new MouseEvent('click', { bubbles: true }))`;
const escape = "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))";

export async function planetCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, applyTheme } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} planet: ${what}`);
  const today = planetLabel(localDayNumber(new Date()));
  const before = await js("document.getElementById('cat').dataset.scene");

  await js("PastelTerm.cat.setScene('planetarium')");
  const drawn = await waitFor(async () => {
    const now = await js(STATE);
    return now.scene && now.shownPlanets.length === 1 ? now : null;
  }, 5000);
  const state = drawn ?? await js(STATE);
  check(state.plPlanet === today.planet && state.shownPlanets.join() === today.planet, `only today's planet shows (${today.facts.name}): shown=${JSON.stringify(state.shownPlanets)} data-pl-planet=${state.plPlanet}`);

  await js(hover);
  const tipped = await waitFor(async () => {
    const now = await js(STATE);
    return now.tipShown ? now : null;
  }, 3000);
  const tip = tipped ?? await js(STATE);
  check(tipped && tip.tip.trim() === today.tip, `hover shows "${today.tip}": ${JSON.stringify(tip.tip)}`);
  await captureRoom(kit, win, 'planet-tip-paleSky');

  await js(click);
  await wait(200);
  const opened = await js(STATE);
  check(opened.popoverShown && !opened.tipShown && opened.popover.includes(today.facts.name) && today.facts.lines.every((line) => opened.popover.includes(line)) && opened.popover.includes(today.tomorrow),
    `click opens the card with ${today.facts.name}, its facts and "${today.tomorrow}": ${JSON.stringify(opened.popover)}`);
  check(!/[–—]/.test(opened.popover), 'the card has no em dashes');
  for (const id of ['paleSky', 'nightPastel']) {
    applyTheme(id, { persist: false });
    await captureRoom(kit, win, `planet-popover-${id}`);
  }
  applyTheme('paleSky', { persist: false });

  await js(escape);
  await wait(200);
  check(!(await js(STATE)).popoverShown, 'Esc closes the card');

  await js(`PastelTerm.cat.setScene(${JSON.stringify(before ?? 'none')})`);
}
