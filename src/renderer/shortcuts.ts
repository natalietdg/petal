// Shortcuts guide: every key, word and gesture, drawn from shared/shortcuts.ts. ⌘/, Help › Keyboard Shortcuts or Customize › Get started open it.
import * as overlays from './overlays';
import { byId, el } from './dom';
import { GUIDE, type GuideRow } from '../shared/shortcuts';

const view = byId('shortcuts');

function combo(chips: readonly string[]): HTMLElement {
  const run = el('span', 'sc-combo');
  run.append(...chips.map((chip) => el('kbd', 'sc-key', chip)));
  return run;
}

// Combos of several keys read "or"; single keys (the arrows) just sit side by side.
function trigger(row: GuideRow): HTMLElement {
  const cell = el('dt', 'sc-trigger');
  if (row.word) cell.append(el('code', 'sc-word', row.word));
  else if (row.gesture) cell.append(el('span', 'sc-gesture', row.gesture));
  const combos = row.keys ?? [];
  const joiner = combos.some((keys) => keys.length > 1) ? 'or' : null;
  combos.forEach((keys, index) => {
    if (index > 0 && joiner) cell.append(el('span', 'sc-or', joiner));
    cell.append(combo(keys));
  });
  return cell;
}

function render(): void {
  const pane = el('div', 'welcome-pane sc-pane');
  pane.append(el('h1', 'welcome-title', 'Shortcuts'), el('p', 'welcome-line', 'Keys, words Petal listens for, and a few mouse moves.'));
  for (const group of GUIDE) {
    const section = el('section', 'sc-group');
    section.dataset.group = group.title;
    const list = el('dl', 'sc-list');
    for (const row of group.rows) {
      const item = el('div', 'sc-row');
      item.append(trigger(row), el('dd', 'sc-does', row.does));
      list.append(item);
    }
    section.append(el('h2', 'sc-group-title', group.title), list);
    pane.append(section);
  }
  const footer = el('footer', 'welcome-footer');
  const done = el('button', 'welcome-start sc-close', 'Close');
  done.type = 'button';
  done.addEventListener('click', close);
  footer.append(done, el('p', 'welcome-note', '⌘/ or Help › Keyboard Shortcuts brings this back.'));
  view.replaceChildren(pane, footer);
  done.focus({ preventScroll: true });
}

export const isOpen = (): boolean => overlays.isOpen('shortcuts');
export function open(): void { if (overlays.show('shortcuts')) render(); }
export function close(): void { overlays.hide('shortcuts'); }
export const toggle = (): void => (isOpen() ? close() : open());

window.pastel.onToggleShortcuts(toggle);
