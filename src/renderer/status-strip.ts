// The Doing / Recommend / Next strip, plus the factory Station bar, shown in the reader's header and atop History's preview.
import { el } from './dom';
import { parseStation, stationBarHtml, type StationProgress } from '../shared/station-line';
import { hasStatus, parseStatus, STATUS_KEYS, STATUS_TITLES, type StatusLines } from '../shared/status-lines';

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

function stationRow(station: StationProgress): HTMLElement {
  const row = el('div', 'status-row status-station');
  row.append(el('span', 'status-chip', 'Station'));
  row.insertAdjacentHTML('beforeend', stationBarHtml(station)); // built from escaped text only
  return row;
}

// Replies newest first: the newest one carrying any status or Station line drives the whole strip.
function newestLines(newestFirst: readonly string[]): { lines: StatusLines; station: StationProgress | null } | null {
  for (const markdown of newestFirst) {
    const lines = parseStatus(markdown);
    const station = parseStation(markdown);
    if (hasStatus(lines) || station) return { lines, station };
  }
  return null;
}

// Replies newest first; hidden when none carries a status line.
export function paintStrip(strip: HTMLElement, newestFirst: readonly string[]): void {
  const found = newestLines(newestFirst);
  strip.hidden = !found;
  strip.replaceChildren(...(found ? [...rows(found.lines), ...(found.station ? [stationRow(found.station)] : [])] : []));
}
