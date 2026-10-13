// Subagent scan on a fake transcript folder, and the pill text. Nothing here reads ~/.claude.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activeSubagentFiles, activeSubagents, FALLBACK_TASK, snapshot, SUBAGENT_WINDOW_MS, subagentTask } from '../src/main/sessions-monitor';
import { agentsBadgeText, sessionsPillText } from '../src/shared/ipc';
import type { SessionFile } from '../src/main/claude-session';
import type { TranscriptEntry } from '../src/main/transcript-entry';
import { allowClaudeFolder, removeTempDirs, tempDir, writeJsonl } from './helpers';

beforeEach(allowClaudeFolder); // the panel snapshot reads session logs only once she allows it
afterEach(removeTempDirs);

// Subagent transcripts start with the delegated prompt as a sidechain user turn.
const delegated = (text: string): TranscriptEntry => ({ type: 'user', isSidechain: true, message: { role: 'user', content: text } });
const reading = (file: string): TranscriptEntry => ({
  type: 'assistant',
  isSidechain: true,
  message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: { file_path: `/repo/${file}` } }] },
});

function agentFile(dir: string, id: string, entries: TranscriptEntry[], { ageMs = 0, description }: { ageMs?: number; description?: string } = {}): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = writeJsonl(path.join(dir, `agent-${id}.jsonl`), entries);
  if (description !== undefined) fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description }));
  const when = new Date(Date.now() - ageMs);
  fs.utimesSync(file, when, when);
  return file;
}

describe('subagent task', () => {
  it('prefers the Agent description from the meta file', () => {
    const dir = tempDir();
    const file = agentFile(dir, 'a1', [delegated('Long delegated prompt')], { description: 'Show background agents' });
    expect(subagentTask(file)).toBe('Show background agents');
  });

  it('falls back to the first real line of the delegated prompt, trimmed to 70', () => {
    const dir = tempDir();
    const long = `${'Sweep every repo for the flag '.repeat(4)}\nsecond line`;
    const file = agentFile(dir, 'a2', [delegated(`<system-reminder>ctx</system-reminder>\n\n${long}`)]);
    const task = subagentTask(file);
    expect(task.length).toBe(70);
    expect(task.endsWith('…')).toBe(true);
    expect(task.startsWith('Sweep every repo for the flag')).toBe(true);
    expect(task).not.toContain('second line');
  });

  it('says "Background agent" when neither is there', () => {
    const dir = tempDir();
    const file = agentFile(dir, 'a3', [reading('x.ts')]);
    expect(subagentTask(file)).toBe(FALLBACK_TASK);
  });
});

describe('active subagents', () => {
  it('keeps only agents written in the last 2 minutes, newest first, with their latest step', () => {
    const dir = tempDir();
    agentFile(dir, 'old', [delegated('Finished long ago')], { ageMs: SUBAGENT_WINDOW_MS + 5_000 });
    agentFile(dir, 'mid', [delegated('Older one'), reading('a.ts')], { ageMs: 60_000 });
    agentFile(dir, 'new', [delegated('Newest one')], { ageMs: 1_000 });
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a transcript');

    const rows = activeSubagents(dir);
    expect(rows.map((r) => r.id)).toEqual(['new', 'mid']);
    expect(rows[0]).toMatchObject({ task: 'Newest one', activity: 'Working' });
    expect(rows[1]).toMatchObject({ task: 'Older one', activity: 'Reading a.ts' });
  });

  it('rereads activity when the file grows, keeping the task', () => {
    const dir = tempDir();
    const file = agentFile(dir, 'grow', [delegated('Grow test')]);
    expect(activeSubagents(dir)[0].activity).toBe('Working');
    fs.appendFileSync(file, `${JSON.stringify(reading('b.ts'))}\n`);
    expect(activeSubagents(dir)[0]).toMatchObject({ task: 'Grow test', activity: 'Reading b.ts' });
  });

  it('is empty for a missing folder', () => {
    expect(activeSubagentFiles(path.join(tempDir(), 'nope'))).toEqual([]);
  });

  it('counts active agents across sessions in the collapsed snapshot', () => {
    const root = tempDir();
    const session = (n: number, status: string): SessionFile => ({ pid: 0, sessionId: `s${n}`, cwd: '/tmp/petal-test', kind: 'interactive', status });
    agentFile(path.join(root, 's1'), 'x1', [delegated('One')]);
    agentFile(path.join(root, 's1'), 'x2', [delegated('Two')]);
    agentFile(path.join(root, 's1'), 'x3', [delegated('Idle')], { ageMs: SUBAGENT_WINDOW_MS + 1_000 });
    agentFile(path.join(root, 's2'), 'y1', [delegated('Three')]);
    const sessions = [session(1, 'busy'), session(2, 'idle'), session(3, 'idle')];

    const { counts, rows } = snapshot({ detailed: false }, sessions, (s) => path.join(root, s.sessionId));
    expect(counts).toEqual({ total: 3, busy: 1, agents: 3 });
    expect(rows).toBeUndefined();
  });
});

describe('pill text', () => {
  it('appends agents only when some are active', () => {
    expect(sessionsPillText({ busy: 1, total: 5, agents: 3 })).toBe('Sessions · 1 busy · 5 open · 3 agents');
    expect(sessionsPillText({ busy: 0, total: 2, agents: 1 })).toBe('Sessions · 0 busy · 2 open · 1 agent');
    expect(sessionsPillText({ busy: 2, total: 4, agents: 0 })).toBe('Sessions · 2 busy · 4 open');
  });

  it('badge pluralises', () => {
    expect(agentsBadgeText(1)).toBe('1 agent');
    expect(agentsBadgeText(4)).toBe('4 agents');
  });
});
