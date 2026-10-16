// The Doing / Recommend / Next strip, plus one progress bar (the test loop's, else the factory Station's),
// shown in the reader's header and atop History's preview.
import { el } from './dom';
import { parseStation, stationBarHtml, type StationProgress } from '../shared/station-line';
import { loopBarHtml, parseLoop, type LoopProgress } from '../shared/loop-line';
import { parseTask, TASK_STATE_WORDS, type TaskLine } from '../shared/task-line';
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

function loopRow(loop: LoopProgress): HTMLElement {
  const row = el('div', 'status-row status-station status-loop');
  row.append(el('span', 'status-chip', 'Loop'));
  row.insertAdjacentHTML('beforeend', loopBarHtml(loop)); // built from escaped text only
  return row;
}

function taskRow(task: TaskLine): HTMLElement {
  const row = el('div', 'status-row status-task');
  const text = el('span', 'status-text', `${task.title} · ${TASK_STATE_WORDS[task.state]}`);
  text.title = text.textContent ?? '';
  row.append(el('span', 'status-chip', 'Task'), text);
  return row;
}

type Found = { lines: StatusLines; station: StationProgress | null; loop: LoopProgress | null; task: TaskLine | null };

// Replies newest first: the newest one carrying any status, Station or Loop line drives the whole strip.
function newestLines(newestFirst: readonly string[]): Found | null {
  for (const markdown of newestFirst) {
    const lines = parseStatus(markdown);
    const station = parseStation(markdown);
    const loop = parseLoop(markdown);
    const task = parseTask(markdown);
    if (hasStatus(lines) || station || loop || task) return { lines, station, loop, task };
  }
  return null;
}

// One bar: a Loop line wins over a Station line in the same reply.
const barRow = (found: Found): HTMLElement[] => (found.loop ? [loopRow(found.loop)] : found.station ? [stationRow(found.station)] : []);

// Replies newest first; hidden when none carries a status line.
export function paintStrip(strip: HTMLElement, newestFirst: readonly string[]): void {
  const found = newestLines(newestFirst);
  strip.hidden = !found;
  strip.replaceChildren(...(found ? [...rows(found.lines), ...barRow(found), ...(found.task ? [taskRow(found.task)] : [])] : []));
}
