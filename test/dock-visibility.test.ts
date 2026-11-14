// Which optional dock buttons show, and when mentions turn on.
import { describe, expect, it } from 'vitest';
import { buttonShown, libraryOn, mentionsOn, type DockFacts } from '../src/shared/dock-visibility';

const facts = (over: Partial<DockFacts> = {}): DockFacts => ({ sessions: 1, libraryOn: false, hasSuite: null, ...over });

describe('buttonShown', () => {
  it('always shows Board, the hub, even with one session', () => {
    expect(buttonShown('board-button', facts(), false)).toBe(true);
  });

  it('shows Library only once it is on', () => {
    expect(buttonShown('library-button', facts({ sessions: 5 }), false)).toBe(false);
    expect(buttonShown('library-button', facts({ libraryOn: true }), false)).toBe(true);
  });

  it('shows Testing once a suite is known, and falls back to 2+ sessions while unknown', () => {
    expect(buttonShown('testing-button', facts({ hasSuite: true }), false)).toBe(true);
    expect(buttonShown('testing-button', facts({ hasSuite: false, sessions: 3 }), false)).toBe(false);
    expect(buttonShown('testing-button', facts({ sessions: 1 }), false)).toBe(false);
    expect(buttonShown('testing-button', facts({ sessions: 2 }), false)).toBe(true);
  });

  it('keeps any button whose view is open', () => {
    expect(buttonShown('library-button', facts(), true)).toBe(true);
    expect(buttonShown('testing-button', facts({ hasSuite: false }), true)).toBe(true);
  });
});

describe('libraryOn', () => {
  it('is on when it builds itself or already holds notes', () => {
    expect(libraryOn({ autoBuild: false, entries: [] })).toBe(false);
    expect(libraryOn({ autoBuild: true, entries: [] })).toBe(true);
    expect(libraryOn({ autoBuild: false, entries: [{}] })).toBe(true);
  });
});

describe('mentionsOn', () => {
  it('needs two sessions', () => {
    expect(mentionsOn(1)).toBe(false);
    expect(mentionsOn(2)).toBe(true);
  });
});
