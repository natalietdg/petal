// High tech mode: a HUD look over the whole app, on or off, in one of two palettes. Saved in config.json.
import type { Choice } from './types';

export const HIGH_TECH_PALETTES = ['cyan', 'amber'] as const;
export type HighTechPalette = (typeof HIGH_TECH_PALETTES)[number];

export interface HighTech {
  on: boolean;
  palette: HighTechPalette;
}

export const HIGH_TECH_OFF: Readonly<HighTech> = Object.freeze({ on: false, palette: 'cyan' });

export const isHighTechPalette = (value: unknown): value is HighTechPalette => HIGH_TECH_PALETTES.some((id) => id === value);

// Customize chips; ids match the keys of src/high-tech-themes.json.
export const HIGH_TECH_PALETTE_CHOICES: readonly Choice[] = [['cyan', 'Cyan hologram'], ['amber', 'Amber tactical']];
export const HIGH_TECH_SWITCH_CHOICES: readonly Choice[] = [['off', 'Off'], ['on', 'On']];
