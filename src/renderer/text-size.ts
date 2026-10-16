// Text sizes: the terminal font and the reader's text, set by View › Bigger / Smaller Text / Actual Size and Customize › Look.
// The keys act on the pane she last clicked or typed in; clicking the reader hands keystrokes back to the shell, so DOM focus alone can't tell.
import * as tabs from './tabs';
import * as layout from './layout';
import * as focusMode from './focus-mode';
import { byId, isIpcError } from './dom';
import { READER_PERCENT, TERMINAL_FONT, clampSize, stepSize, type TextPane, type TextStep } from '../shared/text-size';
import type { Config } from '../main/config-store';

export type TextSizes = Config['text'];

const terminalPane = byId('terminal-pane');
const RANGES = { terminal: TERMINAL_FONT, reader: READER_PERCENT } as const;
const KEYS = { terminal: 'terminalFontSize', reader: 'readerPercent' } as const;

let sizes: TextSizes = { terminalFontSize: TERMINAL_FONT.initial, readerPercent: READER_PERCENT.initial };
let lastPane: TextPane | null = null; // null until she clicks or types somewhere
let savesInFlight = 0;
const listeners = new Set<(sizes: TextSizes) => void>();

export const current = (): TextSizes => ({ ...sizes });
export const value = (pane: TextPane): number => sizes[KEYS[pane]];

function apply(next: TextSizes): void {
  const changed = next.terminalFontSize !== sizes.terminalFontSize || next.readerPercent !== sizes.readerPercent;
  sizes = { ...next };
  document.documentElement.style.setProperty('--reader-scale', String(sizes.readerPercent / 100));
  tabs.setFontSize(sizes.terminalFontSize);
  if (changed) for (const listener of listeners) listener(current());
}

// Saves in order; another window's echo is ignored while ours are in flight, and the last save's answer wins.
async function persist(): Promise<void> {
  savesInFlight += 1;
  const result = await window.pastel.config.save({ text: { ...sizes } });
  savesInFlight -= 1;
  if (savesInFlight === 0 && !isIpcError(result)) apply(result.text);
}

export function set(pane: TextPane, size: number): void {
  apply({ ...sizes, [KEYS[pane]]: clampSize(RANGES[pane], size) });
  void persist();
}

export const step = (pane: TextPane, by: TextStep): void => set(pane, stepSize(RANGES[pane], value(pane), by));
export const reset = (pane: TextPane): void => step(pane, 0);

const terminalShown = (): boolean => !layout.isTerminalMinimised() && !focusMode.isOn();

// The terminal when she last clicked or typed there (or, before any of that, when it holds focus); otherwise the reader.
export function targetPane(): TextPane {
  if (!terminalShown()) return 'reader';
  if (lastPane) return lastPane;
  return terminalPane.contains(document.activeElement) ? 'terminal' : 'reader';
}

export const onChange = (listener: (sizes: TextSizes) => void): (() => boolean) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const paneOf = (target: EventTarget | null): TextPane => (target instanceof Node && terminalPane.contains(target) ? 'terminal' : 'reader');
window.addEventListener('pointerdown', (event) => { lastPane = paneOf(event.target); }, { capture: true });
// Shortcuts (⌘ keys) don't move it: ⌘= after a reader click lands in the shell's textarea but means the reader.
window.addEventListener('keydown', (event) => { if (!event.metaKey) lastPane = paneOf(event.target); }, { capture: true });

window.pastel.onTextSizeStep((by) => step(targetPane(), by));
window.pastel.onTextSizeChanged((next) => { if (savesInFlight === 0) apply(next); });

// The saved sizes, before the first tab opens so its pty starts at the saved grid; none keeps today's sizes.
export const restore = (saved: TextSizes | undefined): void => apply(saved ?? sizes);
