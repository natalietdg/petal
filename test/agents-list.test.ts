// The Agents list and live timeline on a temp folder of made-up subagent files. Nothing here reads ~/.claude.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENTS_LISTED, AgentTimeline, listAgents, type TimelineUpdate } from '../src/main/agents';
import { STALLED_AFTER_MS } from '../src/main/agent-steps';
import type { TranscriptEntry } from '../src/main/transcript-entry';
import { removeTempDirs, tempDir, writeJsonl } from './helpers';

afterEach(removeTempDirs);

const prompt = (text: string): TranscriptEntry => ({ type: 'user', isSidechain: true, timestamp: new Date(Date.now() - 300_000).toISOString(), message: { role: 'user', content: text } });
const read = (file: string, id = 't1'): TranscriptEntry => ({ type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: `/r/${file}` } }] } });
const done = (text: string): TranscriptEntry => ({ type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' } });

function agent(dir: string, id: string, entries: TranscriptEntry[], { ageMs = 0, description }: { ageMs?: number; description?: string } = {}): string {
  const file = writeJsonl(path.join(dir, `agent-${id}.jsonl`), entries);
  if (description) fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify({ description }));
  const when = new Date(Date.now() - ageMs);
  fs.utimesSync(file, when, when);
  return file;
}

describe('agents list', () => {
  it('orders running, stalled, finished, with step, tool calls and elapsed start', async () => {
    const dir = tempDir();
    agent(dir, 'fin', [prompt('Write the notes'), read('a.ts'), done('All done.')], { description: 'Notes pass', ageMs: 60_000 });
    agent(dir, 'run', [prompt('Fix print'), read('print.css', 'x1'), read('print.ts', 'x2')], { description: 'Print fixes', ageMs: 5_000 });
    agent(dir, 'stuck', [prompt('Hang here'), read('b.ts')], { ageMs: STALLED_AFTER_MS + 60_000 });
    const { agents, running } = await listAgents(dir);
    expect(agents.map((a) => [a.id, a.status])).toEqual([['run', 'running'], ['stuck', 'stalled'], ['fin', 'finished']]);
    expect(running).toBe(1);
    expect(agents[0]).toMatchObject({ task: 'Print fixes', step: 'Reading print.ts', toolCalls: 2 });
    expect(agents[1]).toMatchObject({ task: 'Hang here', step: 'Reading b.ts' });
    expect(agents[0]?.startedAt).toBeLessThan(agents[0]?.updatedAt ?? 0);
  });

  it('counts only appended tool calls on a reread, and finishes when the report lands', async () => {
    const dir = tempDir();
    const file = agent(dir, 'grow', [prompt('Grow'), read('one.ts', 'g1')]);
    expect((await listAgents(dir)).agents[0]).toMatchObject({ toolCalls: 1, status: 'running' });
    fs.appendFileSync(file, `${JSON.stringify(read('two.ts', 'g2'))}\n${JSON.stringify(done('Report'))}\n`);
    expect((await listAgents(dir)).agents[0]).toMatchObject({ toolCalls: 2, status: 'finished', step: 'Reading two.ts' });
  });

  it('keeps agents from earlier days and an empty folder is empty', async () => {
    const dir = tempDir();
    agent(dir, 'old', [prompt('Yesterday'), done('Done.')], { ageMs: 48 * 3600_000 });
    const { agents, total } = await listAgents(dir);
    expect(agents.map((a) => [a.id, a.status, a.task])).toEqual([['old', 'finished', 'Yesterday']]);
    expect(total).toBe(1);
    expect(await listAgents(path.join(dir, 'missing'))).toEqual({ agents: [], running: 0, total: 0 });
  });

  it('reads only the newest AGENTS_LISTED, counts the rest, running first', async () => {
    const dir = tempDir();
    const extra = 5;
    for (let i = 0; i < AGENTS_LISTED + extra; i++) agent(dir, `f${i}`, [prompt(`Filler ${i}`), done('Done.')], { ageMs: 3600_000 + i * 60_000 });
    agent(dir, 'live', [prompt('Still going'), read('x.ts')], { ageMs: 1_000 });
    const { agents, running, total } = await listAgents(dir);
    expect(total).toBe(AGENTS_LISTED + extra + 1);
    expect(agents).toHaveLength(AGENTS_LISTED);
    expect(running).toBe(1);
    expect(agents[0]?.id).toBe('live');
    expect(agents[1]?.id).toBe('f0'); // newest finished next
    expect(agents.some((a) => a.id === `f${AGENTS_LISTED + extra - 1}`)).toBe(false); // the oldest is counted, not read
  });
});

describe('agent timeline', () => {
  it('starts with the whole file and pushes only appended rows', async () => {
    const dir = tempDir();
    const file = agent(dir, 'live', [prompt('Follow me'), read('a.ts')]);
    const updates: TimelineUpdate[] = [];
    const timeline = new AgentTimeline(file, (u) => updates.push(u));
    expect((await timeline.start()).items.map((i) => i.kind)).toEqual(['prompt', 'step']);
    fs.appendFileSync(file, `${JSON.stringify(done('Finished.'))}\n`);
    await timeline.poll();
    timeline.stop();
    expect(updates.at(-1)).toEqual({ items: [{ kind: 'report', markdown: 'Finished.', at: undefined }], finished: true });
  });

  it('a rewritten log clears the rows shown so far instead of repeating them', async () => {
    const dir = tempDir();
    const file = agent(dir, 'rewritten', [prompt('Follow me'), read('a.ts'), read('b.ts', 't2')]);
    const updates: TimelineUpdate[] = [];
    const timeline = new AgentTimeline(file, (u) => updates.push(u));
    expect((await timeline.start()).items).toHaveLength(3);
    writeJsonl(file, [prompt('Again')]); // shorter than what was read: a rewrite
    await timeline.poll();
    timeline.stop();
    expect(updates[0]).toEqual({ items: [], finished: false, reset: true });
    expect(updates.slice(1).flatMap((u) => u.items).map((i) => i.kind)).toEqual(['prompt']);
  });
});
