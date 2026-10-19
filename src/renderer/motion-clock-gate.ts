// When the motion clock may tick at all. Pure, so it is unit-tested without a DOM.

export const AWAY_PAUSE_MS = 60_000; // unfocused this long with Claude resting: nobody is watching her

export interface ClockInputs {
  visible: boolean; // document.visibilityState: false when hidden, minimised or fully covered
  loops: number; // infinite animations on the page
  unfocusedMs: number; // 0 while the window has focus
  working: boolean; // Claude is working: the pet keeps moving even in a window left in the background
}

export function clockShouldRun({ visible, loops, unfocusedMs, working }: ClockInputs): boolean {
  if (!visible || loops === 0) return false;
  return working || unfocusedMs < AWAY_PAUSE_MS;
}
