// Which tabs the tab bar counts: agent terminals live in Testing, so the bar, cycling and closing skip them.
import type { TabId } from '../shared/types';

export const stripOrder = (all: readonly TabId[], agents: ReadonlySet<TabId>): TabId[] => all.filter((id) => !agents.has(id));

// Where cycling lands, wrapping; null when there is nowhere else to go.
export function cycleTarget(order: readonly TabId[], activeId: TabId | null, delta: number): TabId | null {
  if (order.length < 2 || activeId === null || !order.includes(activeId)) return null;
  return order[(order.indexOf(activeId) + delta + order.length) % order.length] ?? null;
}

// The tab shown after closing `id`: the one to its right, else its left.
export function neighbourOf(order: readonly TabId[], id: TabId): TabId | null {
  const index = order.indexOf(id);
  if (index < 0) return null;
  return order[index + 1] ?? order[index - 1] ?? null;
}
