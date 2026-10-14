// Ids match the data-reading values styled in renderer/magazine.css and print.css; order sets ⌥⌘1–4.
import type { Choice } from './types';

export const READING_CHOICES: readonly Choice[] = [
  ['newspaper', 'Newspaper'], ['editorial', 'Magazine · Editorial'], ['lifestyle', 'Magazine · Lifestyle'], ['print', 'Magazine · Print'],
];
export const isReadingChoice = (id: string): boolean => READING_CHOICES.some(([choice]) => choice === id);
