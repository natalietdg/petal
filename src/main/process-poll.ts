// One `ps` listing per tick, shared by every tab's ReaderFeed, instead of one per tab.
// A claude starting or exiting always prints to its terminal, so a quiet Petal reuses the last listing.
import { listProcesses, type ProcessRow } from './claude-session';

const TICK_MS = 1000;
const QUIET_RELIST_MS = 15_000; // no terminal output: re-list this often anyway, for a claude killed from outside

export interface ProcessListener {
  // Fixture feeds never look at processes, so they don't make the poll run `ps`.
  readonly needsProcesses: boolean;
  tick(processes: readonly ProcessRow[]): Promise<void> | void;
}

const listeners = new Set<ProcessListener>();
let timer: NodeJS.Timeout | null = null;
let polling = false;
let listing: { rows: ProcessRow[]; at: number } | null = null;
let outputSinceListing = true;

// Any tab's terminal printed something: the next tick lists processes again.
export function noteTerminalOutput(): void {
  outputSinceListing = true;
}

export function shouldRelist(now: number, last: { at: number } | null, output: boolean): boolean {
  return output || !last || now - last.at >= QUIET_RELIST_MS;
}

async function currentProcesses(): Promise<ProcessRow[]> {
  const now = Date.now();
  if (listing && !shouldRelist(now, listing, outputSinceListing)) return listing.rows;
  outputSinceListing = false; // output during the listing marks the next tick
  listing = { rows: await listProcesses(), at: now };
  return listing.rows;
}

async function poll(): Promise<void> {
  if (polling) return; // a slow `ps` never stacks up ticks
  polling = true;
  try {
    const current = [...listeners];
    const processes = current.some((l) => l.needsProcesses) ? await currentProcesses() : [];
    await Promise.all(current.map(async (listener) => {
      try {
        await listener.tick(processes);
      } catch (error) {
        console.error('[petal] reader tick failed:', error); // one tab's failure never stops the others
      }
    }));
  } finally {
    polling = false;
  }
}

export function subscribe(listener: ProcessListener): void {
  listeners.add(listener);
  outputSinceListing = true; // a new tab lists at once
  timer ??= setInterval(poll, TICK_MS);
}

export function unsubscribe(listener: ProcessListener): void {
  listeners.delete(listener);
  if (!listeners.size && timer) {
    clearInterval(timer);
    timer = null;
    listing = null;
  }
}
