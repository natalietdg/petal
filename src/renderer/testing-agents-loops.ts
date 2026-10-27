// This window's copy of main's loops and drafts, keyed by repo and task, read from main on demand.
import { isIpcError } from './dom';
import { IDLE_GIVE_UP_MS } from '../shared/test-loop';
import { isRunning } from '../shared/agent-loop';
import type { AgentRole } from '../shared/agent-names';
import type { TokenUsage } from '../shared/token-usage';
import type { AgentAction } from '../shared/agent-actions';
import type { LoopFacts, LoopView } from '../shared/testing';
import type { Reply } from '../shared/types';

export interface AgentLoop extends LoopView {
  root: string;
  taskId: string;
  actions: Record<AgentRole, AgentAction[]>;
  tokens: Record<AgentRole, TokenUsage | null>;
  replies: Record<AgentRole, Reply[]>; // newest first, from its transcript or live terminal (agent-log)
  stopping: boolean;
  inputs: Pick<LoopFacts, 'names'> | null; // from main's last read; null until then
}

export const keyOf = (root: string, taskId: string): string => `${root}:${taskId}`;
export const atWork = (r: AgentLoop): boolean => isRunning(r) || [r.tester, r.fixer].some((a) => a && a.state !== 'ended' && a.state !== 'closed');
const blank = <T>(make: () => T): Record<AgentRole, T> => ({ tester: make(), fixer: make() });

// Stopping: asked here, or main stopped the loop and an agent is still finishing its turn before its stop message.
export const isStopping = (r: AgentLoop): boolean => r.stopping
  || (r.stoppedAt !== null && Date.now() - r.stoppedAt < IDLE_GIVE_UP_MS && [r.tester, r.fixer].some((a) => a?.state === 'working'));

export type LoopStore = ReturnType<typeof createLoopStore>;

// `changed` runs after any adopt or drop that altered this window's copy.
export function createLoopStore(changed: () => void) {
  const loops = new Map<string, AgentLoop>(); // `${root}:${taskId}` -> its loop or draft, this window's copy
  const shownViews = new Map<string, string>(); // `${root}:${taskId}` -> main's last view of it, to redraw only on change

  // Main's view of a loop becomes this window's copy, keeping what only this window reads (logs, tokens); true when it changed.
  function adopt(root: string, taskId: string, next: LoopView): boolean {
    const k = keyOf(root, taskId);
    const text = JSON.stringify(next);
    if (shownViews.get(k) === text) return false;
    shownViews.set(k, text);
    const local = loops.get(k);
    loops.set(k, { ...next, root, taskId, actions: local?.actions ?? blank(() => []), tokens: local?.tokens ?? blank(() => null), replies: local?.replies ?? blank(() => []), stopping: local?.stopping ?? false, inputs: local?.inputs ?? null });
    return true;
  }

  // A loop main no longer has (its store was replaced or pruned) leaves this window's copy too.
  function drop(k: string): boolean {
    shownViews.delete(k);
    return loops.delete(k);
  }

  // Testing's refresh hands over all of the project's loops, so lanes rebuild on open.
  function adoptAll(root: string, views: Record<string, LoopView>): void {
    let altered = false;
    for (const [taskId, next] of Object.entries(views)) altered = adopt(root, taskId, next) || altered;
    for (const r of [...loops.values()]) if (r.root === root && !(r.taskId in views)) altered = drop(keyOf(r.root, r.taskId)) || altered;
    if (altered) changed();
  }

  // Main's loops into this window's copy; a read asked for mid-read runs right after it.
  let reading = false;
  let readAgain = false;
  async function read(): Promise<void> {
    if (reading) { readAgain = true; return; }
    reading = true;
    try {
      const known = [...loops.values()].map((r) => ({ root: r.root, taskId: r.taskId }));
      const reply = await window.pastel.testing.loops({ known });
      if (isIpcError(reply)) return;
      let altered = false;
      const listed = new Set<string>();
      for (const f of reply.loops) {
        listed.add(keyOf(f.root, f.taskId));
        altered = adopt(f.root, f.taskId, f.loop) || altered;
        const r = loops.get(keyOf(f.root, f.taskId));
        if (r) r.inputs = { names: f.names };
      }
      for (const k of known.map((x) => keyOf(x.root, x.taskId))) if (!listed.has(k)) altered = drop(k) || altered;
      if (altered) changed();
    } finally {
      reading = false;
      if (readAgain) { readAgain = false; void read(); }
    }
  }

  return { loops, adoptAll, read };
}
