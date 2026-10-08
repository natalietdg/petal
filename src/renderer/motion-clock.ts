// Idle CPU guard for every infinite CSS animation (cat, scenes, pulses).
// A playing animation makes Chromium draw at 60 fps even when its steps() value hasn't changed:
// measured ~5% CPU per window for the cat alone. Instead each animation is held at playbackRate 0
// (still "running", but never ticked) and this clock moves it on only when its look changes.
// The clock stops while the window is hidden; covered windows aren't seen.
import { stepAt, stepTiming, type StepTiming } from './motion-steps';

const TICK_MS = 180; // ~5.5 fps: one frame per step of the fastest scene motion (winter fire, 180 ms)

interface Held extends StepTiming {
  offsetMs: number; // the animation's own phase (negative delays) when the clock took it over
  takenAt: number;
  step: number | null; // last stretch written; null until the first write
}

let held = new WeakMap<Animation, Held>();
let timer: ReturnType<typeof setInterval> | undefined;
// The infinite animations, re-listed only when one starts or is cancelled: listing ~500 every tick costs more than the writes.
let animations: Animation[] | null = null;

const isInfinite = (animation: Animation): boolean => animation.effect?.getTiming().iterations === Infinity;
const relist = (): void => { animations = null; };

function take(animation: Animation, now: number): Held {
  const entry = { ...stepTiming(animation), offsetMs: Number(animation.currentTime ?? 0), takenAt: now, step: null };
  held.set(animation, entry);
  return entry;
}

// Reads first, then writes: any read after a write forces a style recalc per animation.
function tick(): void {
  const now = performance.now();
  animations ??= document.getAnimations().filter(isInfinite);
  const entries = animations.map((animation) => held.get(animation) ?? take(animation, now));
  animations.forEach((animation, i) => {
    const entry = entries[i];
    const time = entry.offsetMs + (now - entry.takenAt);
    const step = stepAt(entry, time);
    if (step === entry.step) return; // looks the same: no write, no frame
    if (entry.step === null) animation.playbackRate = 0;
    entry.step = step;
    animation.currentTime = time;
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
// One tick for a whole burst of starts (a scene switch starts hundreds), not one per event.
let soon: ReturnType<typeof setTimeout> | undefined;
function tickSoon(): void {
  relist();
  if (timer && !soon) soon = setTimeout(() => { soon = undefined; tick(); });
}
document.addEventListener('animationstart', tickSoon);
document.addEventListener('animationcancel', relist); // a cancelled animation must never be written again
// Busy/idle keeps an animation's name but can swap its timing (h-glow 3.6s -> 1.8s) with no event: re-read it.
const forget = (): void => { held = new WeakMap(); relist(); };
const cat = document.getElementById('cat');
if (cat) new MutationObserver(forget).observe(cat, { attributes: true, attributeFilter: ['class'] });
document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? start() : stop()));
if (document.visibilityState === 'visible') start();
