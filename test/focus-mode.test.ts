import { describe, expect, it, vi } from 'vitest';
import { focusReader, type FocusTarget } from '../src/renderer/focus-reader';

const target = (): FocusTarget & { attrs: Set<string> } => {
  const attrs = new Set<string>();
  return { attrs, tabIndex: 0, focus: vi.fn(), blur: vi.fn(), hasAttribute: (name) => attrs.has(name) };
};

describe('focus mode keyboard', () => {
  it('entering blurs the terminal and focuses the reader, without making it a Tab stop', () => {
    const xterm = target();
    const reader = target();
    focusReader(xterm, { contains: (node) => node === xterm }, reader);
    expect(xterm.blur).toHaveBeenCalled();
    expect(reader.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(reader.tabIndex).toBe(-1);
  });

  it('leaves focus elsewhere alone, and an existing tabindex as it is', () => {
    const button = target();
    const reader = target();
    reader.attrs.add('tabindex');
    reader.tabIndex = 0;
    focusReader(button, { contains: () => false }, reader);
    expect(button.blur).not.toHaveBeenCalled();
    expect(reader.tabIndex).toBe(0);
    expect(reader.focus).toHaveBeenCalled();
    focusReader(null, { contains: () => false }, reader);
    expect(reader.focus).toHaveBeenCalledTimes(2);
  });
});
