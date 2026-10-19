import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAT_CHOICES } from '../src/main/menu';
import { CATS } from '../src/renderer/cat-art';
import { AWAY_PAUSE_MS, clockShouldRun, type ClockInputs } from '../src/renderer/motion-clock-gate';

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'cat.css'), 'utf8');
const watched: ClockInputs = { visible: true, loops: 3, unfocusedMs: 0, working: false };

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
