// The banner at the top of a concluded session, in the reader and in History's preview.
// Folds to one line; which sessions she folded is remembered until Petal quits.
import { el } from './dom';
import { timeOf } from './format';
import { CONCLUSION_FIELDS, conclusionGist, type Conclusion } from '../shared/conclusion';

const LABELS = { conclusion: 'Conclusion', result: 'Result', impact: 'Impact' } as const;
const folded = new Set<string>();

const whenOf = (at: string | null): string => {
  if (!at) return 'Concluded';
  const day = new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' });
  return `Concluded · ${day} ${timeOf(at)}`;
};

export function conclusionBanner(sessionId: string, conclusion: Conclusion): HTMLElement {
  const banner = el('section', 'conclusion-banner');
  banner.dataset.sessionId = sessionId;
  banner.setAttribute('aria-label', 'Session conclusion');
  const head = el('button', 'conclusion-head');
  head.type = 'button';
  const chevron = el('span', 'conclusion-chevron');
  chevron.setAttribute('aria-hidden', 'true');
  head.append(el('span', 'conclusion-when', whenOf(conclusion.at)));
  if (conclusion.title) head.append(el('span', 'conclusion-title', conclusion.title));
  head.append(el('span', 'conclusion-gist', conclusionGist(conclusion)), chevron);

  const rows = el('div', 'conclusion-rows');
  for (const field of CONCLUSION_FIELDS) {
    if (!conclusion[field]) continue;
    rows.append(el('span', `conclusion-label conclusion-label-${field}`, LABELS[field]), el('p', 'conclusion-text', conclusion[field]));
  }
  banner.append(head, rows);

  const paint = () => {
    const isFolded = folded.has(sessionId);
    banner.classList.toggle('folded', isFolded);
    head.setAttribute('aria-expanded', String(!isFolded));
    head.title = isFolded ? 'Show the conclusion' : 'Fold to one line';
  };
  head.addEventListener('click', () => {
    if (folded.has(sessionId)) folded.delete(sessionId);
    else folded.add(sessionId);
    paint();
  });
  paint();
  return banner;
}

// Fills (or empties) a slot with the session's banner.
export function paintConclusion(slot: HTMLElement, sessionId: string | null | undefined, conclusion: Conclusion | null | undefined): void {
  const key = JSON.stringify([sessionId, conclusion]);
  if (slot.dataset.shown === key) return; // reader updates arrive per streamed line; keep the same banner
  slot.dataset.shown = key;
  slot.replaceChildren(...(sessionId && conclusion ? [conclusionBanner(sessionId, conclusion)] : []));
  slot.hidden = !slot.childElementCount;
}
