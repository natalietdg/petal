// Scenes that change once a day: the local calendar day as a number, and a tick that notices a new one.

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

// The local date as a UTC day count, so a DST shift never skips or repeats a day.
export const localDayNumber = (date: Date): number => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;

// Calls `apply` with today's day number now, then again each time the local day changes; returns a stop function.
// Checked each minute rather than timed to midnight: a sleeping laptop delays timers.
export function everyDay(apply: (day: number) => void, now: () => Date = () => new Date()): () => void {
  let shown: number | undefined;
  const check = (): void => {
    const day = localDayNumber(now());
    if (day === shown) return;
    shown = day;
    apply(day);
  };
  check();
  const timer = setInterval(check, MINUTE_MS);
  return () => clearInterval(timer);
}
