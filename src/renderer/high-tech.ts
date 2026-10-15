// High tech mode: a HUD palette over the whole app (data-hightech on <html>, styled in high-tech.css), the terminal
// colours swapped to match, and Focus drawn as a framed panel with a readout. Saved in config.json; main broadcasts changes.
import * as focusMode from './focus-mode';
import * as overlays from './overlays';
import * as sessionsBoard from './sessions-board';
import * as tabs from './tabs';
import { byId, el } from './dom';
import hudThemes from '../high-tech-themes.json';
import { HIGH_TECH_OFF, type HighTech } from '../shared/high-tech';
import type { Theme } from '../shared/types';

const BOOT_MS = 900; // the sweep's length in high-tech.css
const root = document.documentElement;
const listeners = new Set<(state: HighTech) => void>();

let state: HighTech = { ...HIGH_TECH_OFF };
let base: Theme | null = null;
let paint: (theme: Theme) => void = () => undefined;
let bootTimer: ReturnType<typeof setTimeout> | undefined;

export const isOn = (): boolean => state.on;
export const current = (): HighTech => ({ ...state });
export const onChange = (listener: (next: HighTech) => void): void => { listeners.add(listener); };

// The HUD palette while on; her own theme otherwise.
export const themeFor = (theme: Theme): Theme => (state.on ? hudThemes[state.palette] : theme);

// Focus mode's frame: four corner brackets and a one-line readout, shown only by high-tech.css.
const frame = el('div', 'hud-frame');
const readoutName = el('span', 'hud-session');
const readoutStatus = el('span', 'hud-status');
const readout = el('div', 'hud-readout');
readout.append(el('span', 'hud-tag', 'Focus'), readoutName, readoutStatus);
for (const corner of ['tl', 'tr', 'bl', 'br']) frame.append(el('span', `hud-corner hud-${corner}`));
frame.append(readout);
frame.id = 'hud-frame';
frame.setAttribute('aria-hidden', 'true'); // the reader header already names the session for screen readers
byId('reader-area').append(frame);

const STATUS_WORDS = { busy: 'Working', live: 'Idle', ended: 'Ended', none: 'No session' } as const;

// Session name and status from the active tab; app.ts calls it whenever the reader follows a tab.
export function refreshReadout(): void {
  const update = tabs.active()?.update;
  const key = update?.busy ? 'busy' : update?.state ?? 'none';
  readoutName.textContent = update?.label ?? 'Petal';
  readoutStatus.textContent = STATUS_WORDS[key];
  readoutStatus.dataset.status = key;
}

function boot(): void {
  clearTimeout(bootTimer);
  root.classList.remove('hud-boot');
  void root.offsetWidth; // restart the sweep when it is switched on twice in a row
  root.classList.add('hud-boot');
  bootTimer = setTimeout(() => root.classList.remove('hud-boot'), BOOT_MS);
}

function render(): void {
  if (state.on) root.dataset.hightech = state.palette;
  else delete root.dataset.hightech;
  if (base) paint(themeFor(base));
}

export function set(next: HighTech): void {
  const switchedOn = next.on && !state.on;
  state = { ...next };
  render();
  if (switchedOn) boot();
  refreshReadout();
  for (const listener of listeners) listener(current());
}

// Her own theme changed (menu or Customize); the HUD palette still wins while on.
export function setBase(theme: Theme): void {
  base = theme;
  render();
}

// Startup: app.ts paints themeFor(base) itself, before the first terminal exists; paint is for later changes.
export function init(options: { base: Theme; state: HighTech; paint: (theme: Theme) => void }): void {
  base = options.base;
  paint = options.paint;
  state = { ...options.state };
  if (state.on) root.dataset.hightech = state.palette;
  if (state.on) boot();
}

// Launch: the board is the start screen while on, unless a launch screen (welcome, Get started) is already up.
export function openStartScreen(): boolean {
  if (!state.on || overlays.current()) return false;
  sessionsBoard.open();
  return sessionsBoard.isOpen();
}

focusMode.onChange(refreshReadout);
window.pastel.onHighTech(set);
