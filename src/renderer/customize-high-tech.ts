// Customize › Look: the High tech mode switch and its palette. Saving reaches main, which tells every window.
import * as highTech from './high-tech';
import { card, note, save } from './customize-kit';
import { chips } from './customize-look';
import { HIGH_TECH_PALETTE_CHOICES, HIGH_TECH_SWITCH_CHOICES, type HighTech } from '../shared/high-tech';

let shown: { mode: HTMLElement; palette: HTMLElement } | null = null;

const tick = (group: HTMLElement, id: string): void => {
  for (const chip of group.querySelectorAll<HTMLElement>('[data-choice]')) chip.setAttribute('aria-checked', String(chip.dataset.choice === id));
};

// The View menu can flip it while Customize is open.
highTech.onChange((state: HighTech) => {
  if (!shown?.mode.isConnected) return;
  tick(shown.mode, state.on ? 'on' : 'off');
  tick(shown.palette, state.palette);
});

export function highTechCard(): HTMLDivElement {
  const state = highTech.current();
  const mode = chips('High tech mode', HIGH_TECH_SWITCH_CHOICES, state.on ? 'on' : 'off', (id) => void save({ highTech: { on: id === 'on' } }));
  const palette = chips('High tech palette', HIGH_TECH_PALETTE_CHOICES, state.palette, (id) => void save({ highTech: { palette: id } }));
  shown = { mode, palette };
  return card(
    'High tech mode',
    mode,
    palette,
    note('A heads-up display look for the whole app, and Petal opens on the Sessions board. Replies keep their reading font. Also in View › High Tech Mode.'),
  );
}
