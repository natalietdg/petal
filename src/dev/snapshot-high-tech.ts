// High tech mode: the switch sets data-hightech and the View menu tick, the board is the start screen, Focus gets
// the HUD frame and readout, reply body text keeps a reading font at AA contrast in both palettes, and off restores the look.
import { Menu } from 'electron';
import * as configStore from '../main/config-store';
import hudThemes from '../high-tech-themes.json';
import { HIGH_TECH_PALETTES, type HighTechPalette } from '../shared/high-tech';
import type { Kit } from './snapshot';

const MIN_RATIO = 4.5;
const MIN_BODY_PX = 16;

// The page's look in one read: attribute, reader colours, body text font and contrast, terminal background.
const LOOK = `(() => {
  const rgb = (s) => (s.match(/\\d+(\\.\\d+)?/g) ?? []).slice(0, 3).map(Number);
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const body = [...document.querySelectorAll('#latest p')].find((p) => !p.closest('.headline, .story-head .headline, .status') && p.textContent.trim().length > 10) ?? document.getElementById('latest');
  const text = getComputedStyle(body);
  const bg = getComputedStyle(document.getElementById('reader')).backgroundColor;
  return {
    attr: document.documentElement.dataset.hightech ?? null,
    bg, fg: text.color, font: text.fontFamily, size: parseFloat(text.fontSize),
    ratio: Math.round(ratio(rgb(text.color), rgb(bg)) * 100) / 100,
    term: PastelTerm.tabs.active()?.term.options.theme?.background ?? null,
  };
})()`;

const FRAME = `(() => {
  const frame = document.getElementById('hud-frame');
  return {
    shown: getComputedStyle(frame).display !== 'none',
    corners: [...frame.querySelectorAll('.hud-corner')].filter((c) => getComputedStyle(c).borderTopWidth !== '0px' || getComputedStyle(c).borderBottomWidth !== '0px').length,
    readout: frame.querySelector('.hud-readout')?.innerText.trim() ?? '',
    session: frame.querySelector('.hud-session')?.textContent ?? '',
    dockHidden: getComputedStyle(document.getElementById('sessions-dock')).display === 'none',
  };
})()`;

const highTechMenuItem = () => Menu.getApplicationMenu()?.items.find((item) => item.label === 'View')?.submenu?.items.find((item) => item.label === 'High Tech Mode');

export async function highTechCheck({ js, log, waitFor, wait, capture }: Kit): Promise<void> {
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} high tech ${what}`);
  const saved = configStore.load().highTech;
  await js('PastelTerm.overlays.hideCurrent()');
  const before = await js(LOOK);
  check(before.attr === null && !saved.on, `starts off: ${JSON.stringify({ attr: before.attr, saved })}`);

  configStore.save({ highTech: { on: true, palette: 'cyan' } });
  const on = await waitFor(() => js('document.documentElement.dataset.hightech ?? null'), 5000);
  check(on === 'cyan', `switching on sets data-hightech: ${on}`);
  check(highTechMenuItem()?.checked === true, 'View › High Tech Mode is ticked');

  const board = await js('PastelTerm.highTech.openStartScreen() && PastelTerm.sessionsBoard.isOpen()');
  check(board === true, `start screen is the Sessions board: ${board}`);
  await capture('high-tech-board');
  await js('PastelTerm.sessionsBoard.close()');

  for (const palette of HIGH_TECH_PALETTES) await paletteCheck(palette);

  configStore.save({ highTech: { on: false } });
  await waitFor(async () => (await js('document.documentElement.dataset.hightech ?? null')) === null, 5000);
  await wait(300);
  const after = await js(LOOK);
  const restored = after.attr === null && after.bg === before.bg && after.fg === before.fg && after.font === before.font && after.term === before.term;
  check(restored, `switching off restores the previous look: before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
  check(highTechMenuItem()?.checked === false, 'View › High Tech Mode is unticked again');
  configStore.save({ highTech: saved });

  async function paletteCheck(palette: HighTechPalette): Promise<void> {
    configStore.save({ highTech: { palette } });
    await waitFor(async () => (await js('document.documentElement.dataset.hightech ?? null')) === palette, 5000);
    await wait(300);
    const look = await js(LOOK);
    const theme = hudThemes[palette];
    check(look.term === theme.terminal.background, `${palette} terminal uses the HUD palette: ${look.term}`);
    check(look.ratio >= MIN_RATIO, `${palette} reply body contrast ${look.ratio}:1 (want ${MIN_RATIO}) ${look.fg} on ${look.bg}`);
    check(!/SF Mono|Menlo|monospace/.test(look.font) && look.size >= MIN_BODY_PX, `${palette} reply body keeps a reading font: ${look.font} ${look.size}px`);

    await js('PastelTerm.focusMode.set(true)');
    await wait(400);
    const frame = await js(FRAME);
    const label = await js('PastelTerm.tabs.active()?.update?.label ?? "Petal"');
    check(frame.shown && frame.corners === 4 && frame.dockHidden, `${palette} focus shows the HUD frame: ${JSON.stringify(frame)}`);
    check(frame.session === label && frame.readout.length > 0, `${palette} focus readout names the session "${frame.session}" (want "${label}")`);
    await capture(`high-tech-focus-${palette}`);
    await js('PastelTerm.focusMode.set(false)');
    const gone = await js(FRAME);
    check(!gone.shown, `${palette} the frame leaves with focus mode`);
  }
}
