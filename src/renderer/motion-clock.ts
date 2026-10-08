// Idle CPU guard for every infinite CSS animation (cat, scenes, pulses).
// A playing animation makes Chromium draw at 60 fps even when its steps() value hasn't changed:
// measured ~5% CPU per window for the cat alone. Instead each animation is held at playbackRate 0
// (still "running", but never ticked) and this clock advances them together a few times a second.
// The clock stops while the window is hidden; covered windows aren't seen.

const TICK_MS = 120; // ~8 fps: finer than the fastest step in any scene (winter's fire, 180 ms)

interface Held {
  offsetMs: number; // the animation's own phase (negative delays) when the clock took it over
  takenAt: number;
}

const held = new WeakMap<Animation, Held>();
let timer: ReturnType<typeof setInterval> | undefined;

const isInfinite = (animation: Animation): boolean => animation.effect?.getTiming().iterations === Infinity;

function take(animation: Animation, now: number): Held {
  const entry = { offsetMs: Number(animation.currentTime ?? 0), takenAt: now };
  held.set(animation, entry);
  return entry;
}

// Advances every infinite animation to where it would be at full speed.
// Reads first, then writes: any read after a write forces a style recalc per animation.
function tick(): void {
  const now = performance.now();
  const infinite = document.getAnimations().filter(isInfinite);
  const entries = infinite.map((animation) => held.get(animation) ?? take(animation, now));
  infinite.forEach((animation, i) => {
    if (entries[i].takenAt === now) animation.playbackRate = 0;
    animation.currentTime = entries[i].offsetMs + (now - entries[i].takenAt);
  });
}

function start(): void {
  if (timer) return;
  tick();
  timer = setInterval(tick, TICK_MS);
}

function stop(): void {
  clearInterval(timer);
  timer = undefined;
}

// New animations (a scene switch, the cat going busy) are taken over at once instead of on the next tick.
document.addEventListener('animationstart', () => { if (timer) tick(); });
document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? start() : stop()));
if (document.visibilityState === 'visible') start();
