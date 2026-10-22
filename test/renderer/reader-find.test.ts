// @vitest-environment jsdom
// ⌘F in the reader: matches across inline formatting, skips hidden parts, and the bar's keys step and close.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

type Find = typeof import('../../src/renderer/reader-find');
let find: Find;
let openFromMenu: () => void = () => undefined;

beforeAll(async () => {
  document.body.innerHTML = '<div id="reader-area"><main id="reader"><div class="reader-column"><div id="replies-view"></div></div></main></div><button id="elsewhere">x</button>';
  Object.assign(window, { pastel: { onFindInReader: (callback: () => void) => { openFromMenu = callback; } } });
  Element.prototype.scrollIntoView = () => undefined;
  Element.prototype.getClientRects = () => [new DOMRect()] as unknown as DOMRectList; // jsdom has no layout: the reader counts as shown
  find = await import('../../src/renderer/reader-find');
});

const view = (): HTMLElement => document.getElementById('replies-view') as HTMLElement;
const input = (): HTMLInputElement => document.querySelector('.find-input') as HTMLInputElement;
const count = (): string => document.querySelector('.find-count')?.textContent ?? '';
const key = (name: string, shiftKey = false): void => {
  input().dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true }));
};
const type = (text: string): void => {
  input().value = text;
  input().dispatchEvent(new Event('input'));
};

beforeEach(() => {
  find.closeBar();
  view().innerHTML = '<p>Alpha <strong>be</strong>ta alpha.</p><p hidden>alpha hidden</p><section class="story-section folded"><h2>Folded</h2><div class="section-body"><p>ALPHA folded</p></div></section>';
  const section = view().querySelector('.story-section') as HTMLElement;
  section.querySelector('h2')?.addEventListener('click', () => section.classList.toggle('folded')); // as fold.ts wires it
});

describe('findMatches', () => {
  it('matches case-insensitively, across bold, and skips hidden parts', () => {
    const ranges = find.findMatches(view(), 'alpha');
    expect(ranges.map((r) => r.toString())).toEqual(['Alpha', 'alpha', 'ALPHA']);
    expect(find.findMatches(view(), 'beta').map((r) => r.toString())).toEqual(['beta']);
    expect(find.findMatches(view(), '')).toEqual([]);
  });

  it('labels the count plainly', () => {
    expect(find.countLabel(2, 12, 'x')).toBe('3 of 12');
    expect(find.countLabel(0, 0, 'x')).toBe('No matches');
    expect(find.countLabel(0, 0, '')).toBe('');
  });
});

describe('the find bar', () => {
  it('opens from the menu, steps with Enter and Shift+Enter, and opens a folded section it lands in', () => {
    document.getElementById('elsewhere')?.focus();
    openFromMenu();
    expect(find.isOpen()).toBe(true);
    expect(document.activeElement).toBe(input());
    type('alpha');
    expect(count()).toBe('1 of 3');
    key('Enter');
    expect(count()).toBe('2 of 3');
    key('Enter');
    expect(count()).toBe('3 of 3');
    expect(view().querySelector('.story-section')?.classList.contains('folded')).toBe(false);
    key('Enter');
    expect(count()).toBe('1 of 3');
    key('Enter', true);
    expect(count()).toBe('3 of 3');
  });

  it('says No matches, and Esc closes it and gives focus back', () => {
    const elsewhere = document.getElementById('elsewhere') as HTMLButtonElement;
    elsewhere.focus();
    find.open();
    type('zebra');
    expect(count()).toBe('No matches');
    let reachedDocument = false;
    const listener = () => { reachedDocument = true; };
    document.addEventListener('keydown', listener);
    key('Escape');
    document.removeEventListener('keydown', listener);
    expect(find.isOpen()).toBe(false);
    expect(reachedDocument).toBe(false);
    expect(document.activeElement).toBe(elsewhere);
  });
});
