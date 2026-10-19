// A playing CSS animation redraws at 60 fps even between steps (~5% CPU for the cat alone).
// Infinite ones are held at playbackRate 0 (still "running") and moved on here only when their look changes.
import { clockShouldRun } from './motion-clock-gate';
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
const looping = (): Animation[] => (animations ??= document.getAnimations().filter(isInfinite));

function take(animation: Animation, now: number): Held {
  const entry = { ...stepTiming(animation), offsetMs: Number(animation.currentTime ?? 0), takenAt: now, step: null };
  held.set(animation, entry);
  return entry;
}

// Reads first, then writes: any read after a write forces a style recalc per animation.
function step(now: number): void {
  const list = looping();
  const entries = list.map((animation) => held.get(animation) ?? take(animation, now));
  list.forEach((animation, i) => {
    const entry = entries[i];
    const time = entry.offsetMs + (now - entry.takenAt);
    const next = stepAt(entry, time);
    if (next === entry.step) return; // looks the same: no write, no frame
    if (entry.step === null) animation.playbackRate = 0;
    entry.step = next;
    animation.currentTime = time;
  });
}

const cat = document.getElementById('cat');
let blurredAt: number | null = document.hasFocus() ? null : performance.now();

// Hidden, nothing looping, or left in the background while Claude rests: no ticks at all.
function wanted(now: number): boolean {
  return clockShouldRun({
    visible: document.visibilityState === 'visible',
    loops: looping().length,
    unfocusedMs: blurredAt === null ? 0 : now - blurredAt,
    working: cat?.classList.contains('busy') ?? false,
  });
}

function stop(): void {
  clearInterval(timer);
  timer = undefined;
}

function tick(): void {
  const now = performance.now();
  if (wanted(now)) step(now);
  else stop();
}

function start(): void {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  tick();
}

const refresh = (): void => (wanted(performance.now()) ? start() : stop());

// New animations are taken over at once, clock running or not, so none plays at 60 fps; one step per burst (a scene switch starts hundreds).
let soon: ReturnType<typeof setTimeout> | undefined;
function tickSoon(): void {
  relist();
  if (!soon) soon = setTimeout(() => { soon = undefined; step(performance.now()); refresh(); });
}
document.addEventListener('animationstart', tickSoon);
document.addEventListener('animationcancel', relist); // a cancelled animation must never be written again; the next tick stops if none are left
// Busy/idle keeps an animation's name but can swap its timing (h-glow 3.6s -> 1.8s) with no event: re-read it.
const forget = (): void => { held = new WeakMap(); relist(); refresh(); };
if (cat) new MutationObserver(forget).observe(cat, { attributes: true, attributeFilter: ['class'] });
document.addEventListener('visibilitychange', refresh);
window.addEventListener('blur', () => { blurredAt = performance.now(); });
window.addEventListener('focus', () => { blurredAt = null; refresh(); });
refresh();
