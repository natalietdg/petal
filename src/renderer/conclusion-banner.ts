// A concluded session's conclusion, in the reader and in History's preview: a one-line summary pinned at the top,
// the full Conclusion / Result / Impact at the bottom; clicking the summary scrolls to the full one.
import { el } from './dom';
import { timeOf } from './format';
import { CONCLUSION_FIELDS, conclusionGist, type Conclusion } from '../shared/conclusion';

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

export function conclusionBanner(conclusion: Conclusion): HTMLElement {
  const banner = el('section', 'conclusion-banner');
  banner.setAttribute('aria-label', 'Session conclusion');
  const head = el('div', 'conclusion-head');
  head.append(...headParts(conclusion));
  const rows = el('div', 'conclusion-rows');
  for (const field of CONCLUSION_FIELDS) {
    if (!conclusion[field]) continue;
    rows.append(el('span', `conclusion-label conclusion-label-${field}`, LABELS[field]), el('p', 'conclusion-text', conclusion[field]));
  }
  banner.append(head, rows);
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

// Fills (or empties) the pinned slot and the full slot with the session's conclusion.
export function paintConclusion(pin: HTMLElement, full: HTMLElement, conclusion: Conclusion | null | undefined): void {
  const key = JSON.stringify(conclusion ?? null);
  if (pin.dataset.shown === key && full.dataset.shown === key) return; // reader updates arrive per streamed line; keep the same banners
  pin.dataset.shown = full.dataset.shown = key;
  full.replaceChildren(...(conclusion ? [conclusionBanner(conclusion)] : []));
  pin.replaceChildren(...(conclusion ? [conclusionSummary(conclusion, full)] : []));
  pin.hidden = full.hidden = !conclusion;
}
