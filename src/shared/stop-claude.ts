// The Stop button's rules: when a working Claude may be sent one Esc, and what the button says meanwhile.

export type StopPhase = 'hidden' | 'offered' | 'stopping';

// Longest the button says "Stopping..." while Claude still reads as working.
export const STOPPING_MS = 3000;

export const STOP_TEXT = {
  label: 'Stop',
  stopping: 'Stopping...',
  name: 'Stop Claude',
  title: 'Stop Claude (Esc in the terminal)',
} as const;

export interface StopInputs {
  live: boolean; // Claude is running in the tab
  busy: boolean; // its session file says busy, not idle or waiting
  asking: boolean; // a picker, permission prompt or menu is on its screen
  stoppingUntil: number | null; // set by a click, cleared once Claude stops
  now: number;
}

// Esc cancels whatever is asking, so Stop only shows while Claude works with nothing on screen for her.
export function stopPhase({ live, busy, asking, stoppingUntil, now }: StopInputs): StopPhase {
  if (!live || !busy || asking) return 'hidden';
  return stoppingUntil !== null && now < stoppingUntil ? 'stopping' : 'offered';
}
