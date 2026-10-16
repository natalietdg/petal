// A concluded session's conclusion, in the reader and in History's preview: a one-line summary pinned at the top,
// the full Conclusion / Result / Impact at the bottom; clicking the summary scrolls to the full one.
// Both end in Petal's This session line: Library notes, test runs and the test loop, with links to each.
import { el } from './dom';
import { timeOf } from './format';
import { CONCLUSION_FIELDS, conclusionGist, type Conclusion } from '../shared/conclusion';
import { hasInfo, libraryText, loopText, testsText, type LibraryLine, type SessionInfo, type TestsLine } from '../shared/session-info';

export const OPEN_NOTE_EVENT = 'petal:open-note'; // detail: the note's slug; library.ts opens it
export const OPEN_TEST_RUN_EVENT = 'petal:open-test-run'; // detail: the run id; testing.ts opens it
const MAX_TITLES = 3; // more open the Library itself

const LABELS = { conclusion: 'Conclusion', result: 'Result', impact: 'Impact' } as const;

const whenOf = (at: string | null): string => {
  if (!at) return 'Concluded';
  const day = new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' });
  return `Concluded · ${day} ${timeOf(at)}`;
};

const headParts = (conclusion: Conclusion): HTMLElement[] => [
  el('span', 'conclusion-when', whenOf(conclusion.at)),
  ...(conclusion.title ? [el('span', 'conclusion-title', conclusion.title)] : []),
];

function link(text: string, title: string, event: string, detail: string | null): HTMLButtonElement {
  const button = el('button', 'conclusion-session-link', text);
  button.type = 'button';
  button.title = title;
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent(event, { detail }));
  });
  return button;
}

function libraryPart(line: LibraryLine, compact: boolean): HTMLElement {
  const part = el('span', 'conclusion-session-part', libraryText(line));
  if (line.state !== 'done' || compact) return part; // the pin keeps to counts; the full banner names the notes
  const notes = [...line.added, ...line.updated];
  if (!notes.length) return part;
  part.append(': ');
  notes.slice(0, MAX_TITLES).forEach((note, i) => {
    if (i) part.append(', ');
    part.append(link(note.title, `Open “${note.title}” in the Library`, OPEN_NOTE_EVENT, note.slug));
  });
  if (notes.length > MAX_TITLES) part.append(', ', link(`${notes.length - MAX_TITLES} more`, 'Open the Library', OPEN_NOTE_EVENT, null));
  return part;
}

const testsPart = (tests: TestsLine): HTMLElement => {
  const part = el('span', 'conclusion-session-part');
  part.append(link(testsText(tests), 'Open this run in Testing', OPEN_TEST_RUN_EVENT, tests.last.id));
  return part;
};

// "This session  Library +2 notes: A, B · Tests: 3 runs · last Unit failed (…) · Test loop: done, 3 bugs fixed".
export function sessionLine(info: SessionInfo | null | undefined, { compact = false } = {}): HTMLElement | null {
  if (!hasInfo(info)) return null;
  const line = el('p', compact ? 'conclusion-session conclusion-session-pinned' : 'conclusion-session');
  const parts = [
    ...(info.library ? [libraryPart(info.library, compact)] : []),
    ...(info.tests ? [testsPart(info.tests)] : []),
    ...(info.loop ? [el('span', 'conclusion-session-part', loopText(info.loop))] : []),
  ];
  line.append(el('span', 'conclusion-session-label', 'This session'));
  parts.forEach((part, i) => line.append(...(i ? [el('span', 'conclusion-session-dot', '·')] : []), part));
  line.querySelectorAll('.conclusion-session-dot').forEach((dot) => dot.setAttribute('aria-hidden', 'true'));
  return line;
}

export function conclusionBanner(conclusion: Conclusion, info: SessionInfo | null = null): HTMLElement {
  const banner = el('section', 'conclusion-banner');
  banner.setAttribute('aria-label', 'Session conclusion');
  const head = el('div', 'conclusion-head');
  head.append(...headParts(conclusion));
  const rows = el('div', 'conclusion-rows');
  for (const field of CONCLUSION_FIELDS) {
    if (!conclusion[field]) continue;
    rows.append(el('span', `conclusion-label conclusion-label-${field}`, LABELS[field]), el('p', 'conclusion-text', conclusion[field]));
  }
  const line = sessionLine(info);
  banner.append(head, rows, ...(line ? [line] : []));
  return banner;
}

function conclusionSummary(conclusion: Conclusion, full: HTMLElement): HTMLElement {
  const summary = el('button', 'conclusion-banner conclusion-summary');
  summary.type = 'button';
  summary.title = 'Show the full conclusion';
  summary.append(...headParts(conclusion), el('span', 'conclusion-gist', conclusionGist(conclusion)));
  summary.addEventListener('click', () => full.scrollIntoView({ block: 'start' }));
  return summary;
}

// Fills (or empties) the pinned slot and the full slot with the session's conclusion and its This session line.
export function paintConclusion(pin: HTMLElement, full: HTMLElement, conclusion: Conclusion | null | undefined, info: SessionInfo | null = null): void {
  const shownInfo = conclusion && hasInfo(info) ? info : null;
  const key = JSON.stringify([conclusion ?? null, shownInfo]);
  if (pin.dataset.shown === key && full.dataset.shown === key) return; // reader updates arrive per streamed line; keep the same banners
  pin.dataset.shown = full.dataset.shown = key;
  full.replaceChildren(...(conclusion ? [conclusionBanner(conclusion, shownInfo)] : []));
  const pinLine = sessionLine(shownInfo, { compact: true });
  pin.replaceChildren(...(conclusion ? [conclusionSummary(conclusion, full), ...(pinLine ? [pinLine] : [])] : []));
  pin.hidden = full.hidden = !conclusion;
}
