// The Agents dropdown rows: running first then newest, done/stalled labels, start time and duration.
import { describe, expect, it } from 'vitest';
import { duration, elapsed, menuOrder, menuRows } from '../src/renderer/agents-menu-rows';
import type { AgentSummary } from '../src/main/agents';

const NOW = 1_000_000_000;
const agent = (id: string, status: AgentSummary['status'], startedAgoMs: number, updatedAgoMs = 0): AgentSummary =>
  ({ id, task: `Task ${id}`, status, startedAt: NOW - startedAgoMs, updatedAt: NOW - updatedAgoMs, toolCalls: 0, step: '' });

describe('agents menu order', () => {
  it('puts running agents first even when older, then the rest newest first', () => {
    const list = [agent('oldDone', 'finished', 900_000), agent('oldRun', 'running', 600_000), agent('newDone', 'finished', 60_000), agent('stuck', 'stalled', 300_000), agent('newRun', 'running', 10_000)];
    expect(menuOrder(list).map((a) => a.id)).toEqual(['newRun', 'oldRun', 'newDone', 'stuck', 'oldDone']);
  });

  it('keeps arrival order on equal start times and never mutates its input', () => {
    const list = [agent('a', 'finished', 5_000), agent('b', 'finished', 5_000)];
    expect(menuOrder(list).map((a) => a.id)).toEqual(['a', 'b']);
    expect(menuOrder([]).length).toBe(0);
    menuOrder([...list].reverse());
    expect(list.map((a) => a.id)).toEqual(['a', 'b']);
  });
});

describe('agents menu rows', () => {
  it('labels finished as done and keeps running and stalled', () => {
    const rows = menuRows([agent('f', 'finished', 60_000), agent('r', 'running', 30_000), agent('s', 'stalled', 50_000)], NOW, () => 'T');
    expect(rows.map((r) => [r.id, r.status])).toEqual([['r', 'running'], ['s', 'stalled'], ['f', 'done']]);
  });

  it('times a running agent to now and a stopped one to its last write', () => {
    expect(duration(agent('r', 'running', 240_000, 5_000), NOW)).toBe('4m');
    expect(duration(agent('f', 'finished', 600_000, 540_000), NOW)).toBe('1m');
    expect(duration(agent('s', 'stalled', 45_000, 0), NOW)).toBe('45s');
    const [row] = menuRows([agent('r', 'running', 240_000)], NOW, (at) => `at ${at}`);
    expect(row.time).toBe(`at ${NOW - 240_000} · 4m`);
  });

  it('formats elapsed time in seconds, minutes, then hours', () => {
    expect(elapsed(-5)).toBe('0s');
    expect(elapsed(59_000)).toBe('59s');
    expect(elapsed(90_000)).toBe('2m');
    expect(elapsed(65 * 60_000)).toBe('1h 5m');
  });
});
