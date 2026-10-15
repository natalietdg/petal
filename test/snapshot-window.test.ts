import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, Rectangle } from 'electron';

type Listener = () => void;
const displays: { bounds: Rectangle }[] = [];
const screenListeners: Record<string, Listener[]> = {};

vi.mock('electron', () => ({
  screen: {
    getAllDisplays: () => displays,
    on: (event: string, fn: Listener) => { (screenListeners[event] ??= []).push(fn); },
  },
}));

const { resizeOffscreen, showOffscreen, onAnyDisplay } = await import('../src/main/snapshot-window');

// The gate A layout: built-in at the origin, a 1080p display to its right and 98px higher.
const TWO = [{ bounds: { x: 0, y: 0, width: 1512, height: 982 } }, { bounds: { x: 1512, y: -98, width: 1920, height: 1080 } }];

// Records every opacity and bounds change, and fails the test the moment it is opaque on a display.
function fakeWindow(start: Rectangle) {
  let bounds = { ...start };
  let opacity = 1;
  const on: Record<string, Listener[]> = {};
  const emit = (event: string) => (on[event] ?? []).forEach((fn) => fn());
  const seenOnDisplay: Rectangle[] = [];
  const watch = () => { if (opacity > 0 && onAnyDisplay(bounds)) seenOnDisplay.push({ ...bounds }); };
  const win = {
    isDestroyed: () => false,
    getBounds: () => ({ ...bounds }),
    getOpacity: () => opacity,
    setOpacity: (o: number) => { opacity = o; watch(); },
    setPosition: (x: number, y: number) => { bounds = { ...bounds, x, y }; watch(); emit('move'); },
    setContentBounds: (b: Rectangle) => { bounds = { ...b }; watch(); emit('resize'); },
    setContentSize: (width: number, height: number) => { bounds = { ...bounds, width, height }; watch(); emit('resize'); },
    setIgnoreMouseEvents: () => {},
    showInactive: () => { watch(); emit('show'); },
    on: (event: string, fn: Listener) => { (on[event] ??= []).push(fn); },
  };
  // macOS relocating the window by itself: AppKit reports the move in the same turn as the frame change.
  const macosMoves = (to: Partial<Rectangle>) => { bounds = { ...bounds, ...to }; emit('move'); watch(); };
  // A relocation no event reported yet: the next resize must not trust this position.
  const silentlyMoves = (to: Partial<Rectangle>) => { bounds = { ...bounds, ...to }; };
  return { win: win as unknown as BrowserWindow, macosMoves, silentlyMoves, seenOnDisplay, opacity: () => opacity, bounds: () => bounds };
}

describe('snapshot window stays off every display', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    displays.splice(0, displays.length, ...TWO);
    for (const key of Object.keys(screenListeners)) delete screenListeners[key];
  });
  afterEach(() => vi.useRealTimers());

  it('resizes at the off-screen spot even when the window was pulled onto a display', () => {
    const w = fakeWindow({ x: 3632, y: -98, width: 1280, height: 900 });
    showOffscreen(w.win);
    vi.advanceTimersByTime(1000);
    expect(w.opacity()).toBe(1);
    w.silentlyMoves({ x: 272, y: 0 }); // the 02:50:49 sample: macOS put it on her main display
    resizeOffscreen(w.win, 990, 900);
    expect(w.bounds()).toEqual({ x: 3632, y: -98, width: 990, height: 900 });
    expect(w.opacity()).toBe(0); // transparent until it has held the spot
    vi.advanceTimersByTime(600);
    expect(w.opacity()).toBe(1);
    expect(w.seenOnDisplay).toEqual([]);
  });

  it('hides before macOS moves it onto the remaining display when one is removed', () => {
    const w = fakeWindow({ x: 3632, y: -98, width: 990, height: 900 });
    showOffscreen(w.win);
    vi.advanceTimersByTime(1000);
    displays.splice(0, displays.length, { bounds: { x: 0, y: 0, width: 1920, height: 1080 } });
    screenListeners['display-removed'].forEach((fn) => fn());
    w.macosMoves({ x: 272, y: 0 });
    expect(w.bounds().x).toBe(2120); // re-parked past the lone 1920px display
    vi.advanceTimersByTime(2000);
    expect(w.opacity()).toBe(1);
    expect(w.seenOnDisplay).toEqual([]);
  });

  it('stays transparent while macOS keeps moving it during the settle beat', () => {
    const w = fakeWindow({ x: 3632, y: -98, width: 1280, height: 900 });
    showOffscreen(w.win);
    resizeOffscreen(w.win, 800, 900);
    vi.advanceTimersByTime(300);
    w.macosMoves({ x: 3700 }); // still off-screen, but not where it was parked
    vi.advanceTimersByTime(300);
    expect(w.opacity()).toBe(0);
    vi.advanceTimersByTime(600);
    expect(w.opacity()).toBe(1);
    expect(w.seenOnDisplay).toEqual([]);
  });

  it('a window that cannot leave the display is never shown', () => {
    const w = fakeWindow({ x: 3632, y: -98, width: 1280, height: 900 });
    showOffscreen(w.win);
    (w.win as unknown as { setPosition: () => void }).setPosition = () => {}; // macOS refuses every move
    w.macosMoves({ x: 272, y: 0 });
    vi.advanceTimersByTime(5000);
    expect(w.opacity()).toBe(0);
    expect(w.seenOnDisplay).toEqual([]);
  });
});
