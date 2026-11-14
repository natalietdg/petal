// When the motion clock may tick at all. Pure, so it is unit-tested without a DOM.

export const AWAY_PAUSE_MS = 60_000; // unfocused this long with Claude resting: nobody is watching her
export const IDLE_PAUSE_MS = 30_000; // no key, click, pointer or wheel this long with Claude resting: scenes freeze on their frame

export interface ClockInputs {
  visible: boolean; // document.visibilityState: false when hidden, minimised or fully covered
  loops: number; // infinite animations on the page
  unfocusedMs: number; // 0 while the window has focus
  idleMs: number; // since the last input or Claude busy/idle change
  working: boolean; // Claude is working: the pet keeps moving even in a window left in the background
}

export function clockShouldRun({ visible, loops, unfocusedMs, idleMs, working }: ClockInputs): boolean {
  if (!visible || loops === 0) return false;
  if (working) return true;
  return unfocusedMs < AWAY_PAUSE_MS && idleMs < IDLE_PAUSE_MS;
}
