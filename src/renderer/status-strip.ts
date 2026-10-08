// The Doing / Recommend / Next strip, shown in the reader's header and atop History's preview.
import { el } from './dom';
import { newestStatus, STATUS_KEYS, STATUS_TITLES, type StatusLines } from '../shared/status-lines';

export function createStrip(): HTMLDivElement {
  const strip = el('div', 'status-strip');
  strip.hidden = true;
  strip.setAttribute('aria-label', 'What Claude is doing');
  return strip;
}

function rows(lines: StatusLines): HTMLElement[] {
  return STATUS_KEYS.flatMap((key) => {
    const sentence = lines[key];
    if (!sentence) return [];
    const row = el('div', `status-row status-${key}`);
    const text = el('span', 'status-text', sentence);
    text.title = sentence; // the strip cuts long lines; hover shows them whole
    row.append(el('span', 'status-chip', STATUS_TITLES[key]), text);
    return [row];
  });
}

// Replies newest first; hidden when none carries a status line.
export function paintStrip(strip: HTMLElement, newestFirst: readonly string[]): void {
  const lines = newestStatus(newestFirst);
  strip.hidden = !lines;
  strip.replaceChildren(...(lines ? rows(lines) : []));
}
