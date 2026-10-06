// One `ps` listing per tick, shared by every tab's ReaderFeed, instead of one per tab.
import { listProcesses, type ProcessRow } from './claude-session';

const TICK_MS = 1000;

export interface ProcessListener {
  // Fixture feeds never look at processes, so they don't make the poll run `ps`.
  readonly needsProcesses: boolean;
  tick(processes: readonly ProcessRow[]): Promise<void> | void;
}

const listeners = new Set<ProcessListener>();
let timer: NodeJS.Timeout | null = null;
let polling = false;

async function poll(): Promise<void> {
  if (polling) return; // a slow `ps` never stacks up ticks
  polling = true;
  try {
    const current = [...listeners];
    const processes = current.some((l) => l.needsProcesses) ? await listProcesses() : [];
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
  timer ??= setInterval(poll, TICK_MS);
}

export function unsubscribe(listener: ProcessListener): void {
  listeners.delete(listener);
  if (!listeners.size && timer) {
    clearInterval(timer);
    timer = null;
  }
}
