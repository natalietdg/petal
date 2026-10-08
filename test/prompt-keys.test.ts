// Keystrokes for each click; the sequences match what a real Claude Code 2.1.293 accepted.
import { describe, expect, it } from 'vitest';
import { keysFor, permissionKeys, pickerKeys } from '../src/main/prompt-keys';

describe('pickerKeys', () => {
  it('an option is its digit: answers a single-select tab, toggles a multiSelect box, 1/2 submit/cancel on review', () => {
    expect(pickerKeys({ pick: 1 })).toEqual(['1']);
    expect(pickerKeys({ pick: 3 })).toEqual(['3']);
  });

  it('typed text: the free-text digit, the text without controls, Enter', () => {
    expect(pickerKeys({ other: 3, text: 'teal' })).toEqual(['3', 'teal', '\r']);
    expect(pickerKeys({ other: 3, text: 'ki\x1bwi\r\nnow' })).toEqual(['3', 'ki wi now', '\r']);
  });

  it('Next is →, Back is ←', () => {
    expect(pickerKeys({ move: 'next' })).toEqual(['\x1b[C']);
    expect(pickerKeys({ move: 'back' })).toEqual(['\x1b[D']);
  });

  it('the live two-tab run, step by step: Apple, Plum, Next, teal, Submit', () => {
    const steps = [{ pick: 1 }, { pick: 3 }, { move: 'next' }, { other: 3, text: 'teal' }, { pick: 1 }];
    expect(steps.flatMap((step) => pickerKeys(step) ?? ['REFUSED'])).toEqual(['1', '3', '\x1b[C', '3', 'teal', '\r', '1']);
  });

  it('refuses anything else', () => {
    for (const bad of [null, undefined, 1, 'next', {}, { pick: 0 }, { pick: 10 }, { pick: 1.5 }, { pick: '1' }, { move: 'up' },
      { other: 3, text: ' \x1b ' }, { other: 3 }, { other: 0, text: 'x' }]) expect(pickerKeys(bad)).toBeNull();
  });
});

describe('permissionKeys / keysFor', () => {
  it('a permission option is its digit; anything else is refused', () => {
    expect(permissionKeys(1)).toEqual(['1']);
    expect(permissionKeys(3)).toEqual(['3']);
    for (const bad of [0, 10, 1.5, '1', null, undefined]) expect(permissionKeys(bad)).toBeNull();
  });

  it('routes each kind', () => {
    expect(keysFor({ kind: 'permission', option: 2 })).toEqual(['2']);
    expect(keysFor({ kind: 'picker', step: { move: 'next' } })).toEqual(['\x1b[C']);
  });
});
