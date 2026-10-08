// Pet size in Customize: her chosen scale, saved in config.json. The reader may shrink her below it, never above.
import type { Choice } from './types';

export const PET_SIZES = ['small', 'normal', 'large'] as const;
export type PetSize = (typeof PET_SIZES)[number];

// Small is 2px per sprite pixel, the size she used to shrink to.
export const PET_SCALE: Readonly<Record<PetSize, number>> = { small: 0.6667, normal: 1, large: 1.25 };

export const PET_SIZE_CHOICES: readonly Choice[] = [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']];

export const isPetSize = (value: unknown): value is PetSize => PET_SIZES.some((size) => size === value);
