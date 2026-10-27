// A locked test changed with no Claude session seen editing it: asks Keep or Restore instead of putting it back.
import { el } from './dom';
import { when } from './testing-view';
import { restoredText, type RestoredFlag } from '../shared/test-lock';

export type ResolveUnconfirmed = (path: string, keep: boolean) => void;

export function unconfirmedRow(flag: RestoredFlag, resolve: ResolveUnconfirmed | undefined): HTMLElement {
  const item = el('li', 'tst-lock-flag tst-lock-unconfirmed');
  item.append(el('span', null, `${restoredText(flag, { tester: '', fixer: '' })} · ${when(flag.at)} `));
  if (!resolve) return item;
  const button = (label: string, keep: boolean): HTMLButtonElement => {
    const node = el('button', `tst-link tst-lock-${keep ? 'keep' : 'restore'}`, label);
    node.type = 'button';
    node.addEventListener('click', () => resolve(flag.path, keep));
    return node;
  };
  item.append(button('Keep', true), el('span', null, ' · '), button('Restore', false));
  return item;
}
