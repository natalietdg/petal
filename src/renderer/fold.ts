// Folding a reply's ## sections under their headings, so the summary is what she reads first.
import { el } from './dom';
import { allOpen, isOpen, layoutReply, newFold, setAll, toggleSection, type BlockKind, type FoldState } from '../shared/reply-fold';

const MAX_REMEMBERED = 200; // replies whose opened sections this window remembers; never saved
const folds = new Map<string, FoldState>();

// Survives the reader redrawing the same reply while it streams, so what she opened stays open.
function foldFor(key: string): FoldState {
  const known = folds.get(key);
  if (known) return known;
  const fresh = newFold();
  folds.set(key, fresh);
  if (folds.size > MAX_REMEMBERED) folds.delete(folds.keys().next().value ?? key);
  return fresh;
}

function kindOf(node: Element): BlockKind {
  if (node.nodeName === 'H2') return 'heading';
  if (node.classList.contains('status-block')) return 'strip';
  if (node.classList.contains('headline')) return 'headline';
  return node.nodeName === 'P' ? 'paragraph' : 'other';
}

// Before sections are wrapped: Doing / Recommend / Next moves up under the abstract. No ## means no change.
export function liftSummary(root: HTMLElement): boolean {
  const blocks = [...root.children];
  const layout = layoutReply(blocks.map(kindOf));
  if (!layout.sections) return false;
  root.append(...layout.order.map((i) => blocks[i] as Element));
  return true;
}

function paint(section: Element, open: boolean): void {
  section.classList.toggle('folded', !open);
  section.querySelector(':scope > h2 > .fold-toggle')?.setAttribute('aria-expanded', String(open));
}

// After sections are wrapped: each heading becomes a row that opens its section; one control opens them all.
export function foldSections(root: HTMLElement, key: string): void {
  const sections = [...root.querySelectorAll<HTMLElement>(':scope > .story-section')];
  const first = sections[0];
  if (!first) return;
  const state = foldFor(key);
  const all = el('button', 'fold-all');
  all.type = 'button';
  const label = () => { all.textContent = allOpen(state, sections.length) ? 'Collapse all' : 'Expand all'; };
  sections.forEach((section, index) => {
    const heading = section.querySelector<HTMLElement>(':scope > h2');
    if (!heading) return;
    const toggle = el('button', 'fold-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', (heading.textContent ?? '').trim());
    heading.append(toggle);
    heading.classList.add('foldable');
    // The whole row opens it; a link inside the heading still goes to its page.
    heading.addEventListener('click', (event) => {
      if ((event.target as Element).closest('a')) return;
      toggleSection(state, index);
      paint(section, isOpen(state, index));
      label();
    });
    paint(section, isOpen(state, index));
  });
  all.addEventListener('click', () => {
    setAll(state, !allOpen(state, sections.length));
    sections.forEach((section, index) => paint(section, isOpen(state, index)));
    label();
  });
  label();
  const bar = el('div', 'fold-bar');
  bar.append(all);
  first.before(bar);
}
