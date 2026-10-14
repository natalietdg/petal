import { describe, expect, it } from 'vitest';
import { STEP_IDS, allDone, needsReopen, cleanDone, factsFrom, stepStates, toSave, toggle, type LiveFacts, type TabFacts } from '../src/shared/get-started';

const NONE: LiveFacts = { claudeInstalled: false, tabCount: 1, claudeRunning: false, sessionStarted: false, replied: false, pastSessions: false, folderOff: false };
const plainTab: TabFacts = { state: 'none', sessionId: null, replies: 0 };
const done = (saved: string[], facts: LiveFacts) => stepStates(saved, facts).filter((s) => s.done).map((s) => s.id);

describe('Get started facts from the tabs', () => {
  it('a fresh install: one plain tab, nothing running, nothing read', () => {
    expect(factsFrom([plainTab], false)).toEqual(NONE);
  });

  it('a claude process without a session file yet counts as running, not signed in', () => {
    const f = factsFrom([plainTab, { state: 'live', sessionId: null, replies: 0 }], true);
    expect(f).toMatchObject({ tabCount: 2, claudeRunning: true, sessionStarted: false, replied: false });
  });

  it('a session file means sign-in is behind her; a reply means she asked', () => {
    expect(factsFrom([{ state: 'live', sessionId: 's', replies: 0 }], true)).toMatchObject({ sessionStarted: true, replied: false });
    expect(factsFrom([{ state: 'ended', sessionId: null, replies: 2 }], true)).toMatchObject({ sessionStarted: true, replied: true, claudeRunning: true });
  });
});

describe('step states', () => {
  it('nothing done on a fresh install', () => {
    expect(done([], NONE)).toEqual([]);
    expect(allDone(stepStates([], NONE))).toBe(false);
  });

  it('install ticks itself when claude is found', () => {
    const states = stepStates([], { ...NONE, claudeInstalled: true });
    expect(states[0]).toEqual({ id: 'install', done: true, auto: true, unseen: false });
  });

  it('Add Session ticks from a second tab or a running claude', () => {
    expect(done([], { ...NONE, tabCount: 2 })).toEqual(['add-session']);
    expect(done([], { ...NONE, claudeRunning: true })).toEqual(['add-session']);
  });

  it('a reply in the reader ticks every later step it implies', () => {
    const facts = factsFrom([plainTab, { state: 'live', sessionId: 's', replies: 1 }], true);
    expect(done([], facts)).toEqual([...STEP_IDS]);
    expect(allDone(stepStates([], facts))).toBe(true);
  });

  it('hand ticks count, in checklist order', () => {
    expect(done(['ask', 'sign-in'], NONE)).toEqual(['sign-in', 'ask']);
  });
});

describe('an experienced user', () => {
  it('past conversations in History tick every step but install, with no tab running yet', () => {
    expect(factsFrom([plainTab], true, true).pastSessions).toBe(true);
    expect(done([], factsFrom([plainTab], false, true))).toEqual(['add-session', 'sign-in', 'ask']);
    expect(allDone(stepStates([], factsFrom([plainTab], true, true)))).toBe(true);
  });
});

describe('ticking by hand', () => {
  it('toggles a step Petal has not seen', () => {
    const once = toggle([], 'sign-in', NONE);
    expect(once).toEqual(['sign-in']);
    expect(toggle(once, 'sign-in', NONE)).toEqual([]);
  });

  it('a step Petal saw done cannot be unticked', () => {
    expect(toggle(['install'], 'install', { ...NONE, claudeInstalled: true })).toEqual(['install']);
  });
});

describe('what is saved', () => {
  it('keeps steps Petal saw, so they survive a relaunch', () => {
    const facts = factsFrom([plainTab, { state: 'live', sessionId: 's', replies: 0 }], true);
    expect(toSave(stepStates([], facts), [])).toEqual(['add-session', 'sign-in']);
  });

  it('never keeps install from the live check alone, only from her own tick', () => {
    expect(toSave(stepStates([], { ...NONE, claudeInstalled: true }), [])).toEqual([]);
    expect(toSave(stepStates(['install'], NONE), ['install'])).toEqual(['install']);
  });

  it('cleanDone drops unknown ids and repeats', () => {
    expect(cleanDone(['ask', 'x', 'ask', 3, 'install'])).toEqual(['install', 'ask']);
    expect(cleanDone('install')).toEqual([]);
  });
});

describe('with the Claude folder off', () => {
  const OFF: LiveFacts = { ...NONE, folderOff: true };
  const unseen = (facts: LiveFacts) => stepStates([], facts).filter((s) => s.unseen).map((s) => s.id);

  it('sign-in and ask are marked unseen until ticked by hand', () => {
    expect(factsFrom([plainTab], true, false, true).folderOff).toBe(true);
    expect(unseen(OFF)).toEqual(['sign-in', 'ask']);
    expect(unseen(NONE)).toEqual([]);
    expect(toggle([], 'ask', OFF)).toEqual(['ask']);
  });

  it('launch does not reopen Get started for unseen steps alone', () => {
    const seenDone = { ...OFF, claudeInstalled: true, tabCount: 2 };
    expect(allDone(stepStates([], seenDone))).toBe(false);
    expect(needsReopen(stepStates([], seenDone))).toBe(false);
    expect(needsReopen(stepStates([], OFF))).toBe(true); // install still open
  });

  it('with reading on, an open sign-in still reopens it', () => {
    expect(needsReopen(stepStates([], { ...NONE, claudeInstalled: true, tabCount: 2 }))).toBe(true);
  });
});
