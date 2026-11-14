import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAT_CHOICES } from '../src/main/menu';
import { CATS } from '../src/renderer/cat-art';
import { AWAY_PAUSE_MS, IDLE_PAUSE_MS, clockShouldRun, type ClockInputs } from '../src/renderer/motion-clock-gate';

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'cat.css'), 'utf8');
const watched: ClockInputs = { visible: true, loops: 3, unfocusedMs: 0, idleMs: 0, working: false };

describe('motion clock gate', () => {
  it('ticks while the window is seen and something loops', () => {
    expect(clockShouldRun(watched)).toBe(true);
  });

  it('stops when nothing loops, so an idle Petal with no scene costs no ticks', () => {
    expect(clockShouldRun({ ...watched, loops: 0 })).toBe(false);
    expect(clockShouldRun({ ...watched, loops: 0, working: true })).toBe(false);
  });

  it('stops when the window is hidden or minimised, working or not', () => {
    expect(clockShouldRun({ ...watched, visible: false })).toBe(false);
    expect(clockShouldRun({ ...watched, visible: false, working: true })).toBe(false);
  });

  it('pauses once the window has been in the background for the away limit while Claude rests', () => {
    expect(clockShouldRun({ ...watched, unfocusedMs: AWAY_PAUSE_MS - 1 })).toBe(true);
    expect(clockShouldRun({ ...watched, unfocusedMs: AWAY_PAUSE_MS })).toBe(false);
  });

  it('keeps moving in a background window while Claude works', () => {
    expect(clockShouldRun({ ...watched, unfocusedMs: AWAY_PAUSE_MS * 10, working: true })).toBe(true);
  });

  it('pauses a focused, visible window after the idle limit with no input while Claude rests', () => {
    expect(clockShouldRun({ ...watched, idleMs: IDLE_PAUSE_MS - 1 })).toBe(true);
    expect(clockShouldRun({ ...watched, idleMs: IDLE_PAUSE_MS })).toBe(false);
  });

  it('keeps moving through a long idle while Claude works, and never when hidden', () => {
    expect(clockShouldRun({ ...watched, idleMs: IDLE_PAUSE_MS * 10, working: true })).toBe(true);
    expect(clockShouldRun({ ...watched, idleMs: 0, visible: false, working: true })).toBe(false);
  });
});

// Wizard's Loft (howl.css) was the heaviest idle scene: every animation must be one the clock holds.
describe("Wizard's Loft animations", () => {
  const loft = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'scenes', 'howl.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...loft.matchAll(/animation:\s*([^;}]+)/g)].map((m) => m[1].trim());

  it('are all infinite and stepped, so the clock takes them over and the gate stops them', () => {
    expect(rules.length).toBeGreaterThanOrEqual(15);
    for (const rule of rules) expect(rule, rule).toMatch(/steps\(\d+\).*infinite/);
  });

  it('has no transitions or animation-duration overrides that would run outside the clock', () => {
    expect(loft).not.toMatch(/transition\s*:/);
    expect(loft).not.toMatch(/animation-(duration|iteration-count)\s*:/);
  });
});

describe('the pet at rest', () => {
  // Rules that loop forever on the pet herself (scenes are separate and loop on purpose).
  const petLoops = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^([^{}@]+)\{[^}]*animation:[^;}]*infinite/gm)]
    .map((m) => m[1].trim())
    .filter((selector) => !selector.includes('.scene'));

  it('every looping pet animation needs her awake or busy, so a dozing pet lets the clock stop', () => {
    expect(petLoops.length).toBeGreaterThan(10);
    for (const selector of petLoops) {
      for (const part of selector.split(',')) expect(part, part).toMatch(/#cat\.(awake|busy)|\.cat-portrait/);
    }
  });

  it('the dozing z drifts a while and then rests instead of looping', () => {
    expect(css).toMatch(/animation: cat-z [^;]*steps\(4\) \d+,/);
    expect(css).not.toMatch(/animation: cat-z [^;]*infinite/);
  });
});

describe('No pet', () => {
  it('is in the Pet menu and Customize picker, first like No Scene, and is never a cat id', () => {
    expect(CAT_CHOICES[0]).toEqual(['none', 'No pet']);
    expect(Object.hasOwn(CATS, 'none')).toBe(false);
  });
});
