// Stop's show/hide rules and the one key it types.
import { describe, expect, it } from 'vitest';
import { STOPPING_MS, stopPhase, type StopInputs } from '../src/shared/stop-claude';
import { keysFor } from '../src/main/prompt-keys';
import { ACCEL, guideAccelerators, keyChips } from '../src/shared/shortcuts';

const working: StopInputs = { live: true, busy: true, asking: false, stoppingUntil: null, now: 1000 };

describe('stopPhase', () => {
  it('offers Stop while Claude is busy with nothing asking', () => {
    expect(stopPhase(working)).toBe('offered');
  });

  it('hides it when idle, waiting (not busy), ended or with no Claude', () => {
    expect(stopPhase({ ...working, busy: false })).toBe('hidden');
    expect(stopPhase({ ...working, live: false })).toBe('hidden');
    expect(stopPhase({ ...working, live: false, busy: false })).toBe('hidden');
  });

  it('hides it while a picker, permission prompt or menu is on screen, since Esc would cancel it', () => {
    expect(stopPhase({ ...working, asking: true })).toBe('hidden');
    expect(stopPhase({ ...working, asking: true, stoppingUntil: 5000 })).toBe('hidden');
  });

  it('says Stopping... after a click until Claude stops or the limit passes', () => {
    const until = working.now + STOPPING_MS;
    expect(stopPhase({ ...working, stoppingUntil: until })).toBe('stopping');
    expect(stopPhase({ ...working, stoppingUntil: until, now: until - 1 })).toBe('stopping');
    expect(stopPhase({ ...working, stoppingUntil: until, busy: false })).toBe('hidden');
    expect(stopPhase({ ...working, stoppingUntil: until, now: until })).toBe('offered');
    expect(STOPPING_MS).toBe(3000);
  });
});

describe('interrupt keys', () => {
  it('is exactly one Esc', () => {
    expect(keysFor({ kind: 'interrupt' })).toEqual(['\x1b']);
  });

  it('other answers are unchanged', () => {
    expect(keysFor({ kind: 'menu', step: { cancel: true } })).toEqual(['\x1b']);
    expect(keysFor({ kind: 'permission', option: 2 })).toEqual(['2']);
  });
});

describe('⌘.', () => {
  it('is in the guide and draws as ⌘ .', () => {
    expect(ACCEL.stopClaude).toBe('CmdOrCtrl+.');
    expect(guideAccelerators()).toContain(ACCEL.stopClaude);
    expect(keyChips(ACCEL.stopClaude)).toEqual(['⌘', '.']);
  });
});
