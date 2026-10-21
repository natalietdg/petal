// The reader's "PRs (N)" tab, under the pinned conclusion: every PR the session made or named, folded until clicked.
// Hidden while the session has none.
import { el } from './dom';
import { onPrsChanged, prsFor } from './prs-data';
import { panelParts } from './prs-panel';
import { prsTabText, type SessionPrsView } from '../shared/session-prs';

export const slot = Object.assign(el('section', 'prs-slot'), { id: 'reader-prs', hidden: true });
slot.setAttribute('aria-label', 'Pull requests in this session');
const tab = el('button', 'prs-tab');
tab.type = 'button';
const tabText = el('span', 'prs-tab-text');
const chevron = el('span', 'prs-tab-chevron');
chevron.setAttribute('aria-hidden', 'true');
tab.append(tabText, chevron);
const panel = Object.assign(el('div', 'prs-panel'), { id: 'reader-prs-panel', hidden: true });
tab.setAttribute('aria-controls', panel.id);
slot.append(tab, panel);

const open = new Set<string>(); // sessions whose panel she opened
let shown: { sessionId: string; key: string } | null = null;
let rendered: SessionPrsView | null = null;
let onPaint: () => void = () => undefined;

// Rebuilding moves her note editors out and back in, which blurs them; the one she was typing in gets its cursor back.
function rebuildPanel(view: SessionPrsView): void {
  const active = document.activeElement;
  const typing = active instanceof HTMLTextAreaElement && panel.contains(active) ? { field: active, start: active.selectionStart, end: active.selectionEnd } : null;
  panel.replaceChildren(...panelParts(view));
  if (typing && panel.contains(typing.field)) {
    typing.field.focus({ preventScroll: true });
    typing.field.setSelectionRange(typing.start, typing.end);
  }
}

function render(view: SessionPrsView | null): void {
  rendered = view;
  const count = view?.prs.length ?? 0;
  slot.hidden = count === 0;
  if (!view || !count) return onPaint();
  const expanded = open.has(view.sessionId);
  tabText.textContent = prsTabText(count);
  chevron.textContent = expanded ? '▾' : '▸';
  tab.setAttribute('aria-expanded', String(expanded));
  tab.title = expanded ? 'Hide this session’s PRs' : 'Show this session’s PRs: services, main checks, deploy order and notes';
  panel.hidden = !expanded;
  if (expanded) rebuildPanel(view);
  onPaint();
}

const repaint = (): void => { if (shown) render(prsFor(shown.sessionId, shown.key)); };

// key changes whenever the session's log may hold something new (a reply or a tool result).
export function paint(sessionId: string | null, key: string): void {
  if (!sessionId) { shown = null; if (rendered) render(null); return; }
  shown = { sessionId, key };
  const view = prsFor(sessionId, key);
  if (view !== rendered) render(view); // the reader repaints per streamed line; an unchanged answer keeps the panel as is
}

// Called after each repaint, so the banners bar can name the tab.
export const afterPaint = (callback: () => void): void => { onPaint = callback; };

tab.addEventListener('click', () => {
  if (!shown) return;
  if (open.has(shown.sessionId)) open.delete(shown.sessionId); else open.add(shown.sessionId);
  repaint();
});
onPrsChanged((sessionId) => { if (shown?.sessionId === sessionId) repaint(); });
