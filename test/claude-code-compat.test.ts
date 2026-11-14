// Claude Code compatibility: pins every on-disk format assumption Petal's reader makes, against sanitised fixtures.
// A failure here names the assumption a Claude Code update broke. Fixtures: test/fixtures/claude-code (no real data).
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { assistantText, ReplyCollector } from '../src/main/replies';
import { isAgentMessage, isUserTurn, queuedPromptText, rawPromptText } from '../src/main/prompts';
import { parseEntry, type TranscriptEntry } from '../src/main/transcript-entry';
import { readHead, readTail } from '../src/main/jsonl-window';
import { TranscriptTail, type TranscriptView } from '../src/main/transcript';
import { TurnTracker, turnOpenAfter } from '../src/main/turn-state';
import { activeSubagentFiles, oldestIdle, subagentTask } from '../src/main/sessions-monitor';
import { SESSION_ID } from '../src/main/session-id';
import { replyJson } from '../src/main/claude-reply';
import { readTurns } from '../src/main/handoff';
import { pageOfTurns, turnsFor } from '../src/main/history-turns';
import { allowClaudeFolder, removeTempDirs } from './helpers';

const FIXTURES = path.join(__dirname, 'fixtures', 'claude-code');
const SESSION_ID_1 = '0f3c2a1e-5b7d-4c9e-8a1f-2d3e4f5a6b7c';
const CWD = '/Users/example/projects/demo-app';
const PROJECT = path.join(FIXTURES, 'projects', '-Users-example-projects-demo-app');
const TRANSCRIPT = path.join(PROJECT, `${SESSION_ID_1}.jsonl`);
const SUBAGENTS = path.join(PROJECT, SESSION_ID_1, 'subagents');

const entries = (): TranscriptEntry[] => fs.readFileSync(TRANSCRIPT, 'utf8').split('\n').filter(Boolean).map(parseEntry);
const byUuid = (uuid: string): TranscriptEntry => {
  const found = entries().find((entry) => entry.uuid === uuid);
  if (!found) throw new Error(`fixture has no entry ${uuid}`);
  return found;
};
const collect = (list: TranscriptEntry[]): ReplyCollector => {
  const collector = new ReplyCollector();
  for (const entry of list) collector.add(entry);
  return collector;
};

// The session-file readers resolve ~/.claude through $CLAUDE_CONFIG_DIR; point it at the fixtures behind an allowed gate.
type SessionModule = typeof import('../src/main/claude-session');
type MonitorModule = typeof import('../src/main/sessions-monitor');
let session: SessionModule;
let monitor: MonitorModule;
const savedConfigDir = process.env.CLAUDE_CONFIG_DIR;

beforeAll(async () => {
  process.env.CLAUDE_CONFIG_DIR = FIXTURES;
  vi.resetModules();
  allowClaudeFolder();
  session = await import('../src/main/claude-session');
  monitor = await import('../src/main/sessions-monitor');
});

afterAll(() => {
  if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
  vi.resetModules();
  removeTempDirs();
});

describe('sessions/<pid>.json', () => {
  it('sessions/<pid>.json: sessionId and cwd are read', () => {
    expect(session.readSessionFile(41001)).toMatchObject({ pid: 41001, sessionId: SESSION_ID_1, cwd: CWD });
  });

  it('sessions/<pid>.json: kind, status, name and updatedAt are read', () => {
    expect(session.readSessionFile(41001)).toMatchObject({ kind: 'interactive', status: 'busy', name: 'demo-app', updatedAt: 1763100600000 });
    expect(session.readSessionFile(41002)).toMatchObject({ kind: 'bg', status: 'idle' });
  });

  it('sessions/<pid>.json: sessionId is a lowercase UUID', () => {
    expect(SESSION_ID.test(session.readSessionFile(41001)?.sessionId ?? '')).toBe(true);
  });

  it('sessions/<pid>.json: status "busy" counts as busy and "idle" is offered as oldest idle', () => {
    const files = [41001, 41002].map((pid) => session.readSessionFile(pid)).filter((s) => s !== null);
    const snap = monitor.snapshot({ detailed: false }, files, () => path.join(FIXTURES, 'no-subagents'));
    expect(snap.counts).toEqual({ total: 2, busy: 1, agents: 0 });
    expect(oldestIdle(files)?.pid).toBe(41002);
  });

  it('sessions/<pid>.json: a missing file reads as no session', () => {
    expect(session.readSessionFile(99999)).toBeNull();
  });
});

describe('projects/<slug>/<sessionId>.jsonl location', () => {
  it('project slug: every non-alphanumeric in cwd becomes "-"', () => {
    expect(session.projectSlug(CWD)).toBe('-Users-example-projects-demo-app');
  });

  it('transcript path: projects/<slug>/<sessionId>.jsonl under the Claude folder', () => {
    expect(session.transcriptPath({ cwd: CWD, sessionId: SESSION_ID_1 })).toBe(TRANSCRIPT);
    expect(fs.existsSync(TRANSCRIPT)).toBe(true);
  });

  it('subagents: <sessionId>/subagents/agent-<id>.jsonl beside the transcript', () => {
    expect(monitor.subagentsDir({ pid: 41001, sessionId: SESSION_ID_1, cwd: CWD })).toBe(SUBAGENTS);
  });
});

describe('transcript lines', () => {
  it('jsonl: every line is one JSON object with a type', () => {
    const all = entries();
    expect(all.length).toBe(19);
    expect(all.every((entry) => typeof entry.type === 'string')).toBe(true);
  });

  it('user prompt: type "user", message.content as a string or text blocks, is a turn', () => {
    expect(rawPromptText(byUuid('u-prompt-1'))).toBe('Why is the build slow?');
    expect(rawPromptText(byUuid('u-prompt-2'))).toBe('Ship it today?');
  });

  it('assistant reply: type "assistant", message.content text blocks are the reply', () => {
    expect(assistantText(byUuid('a-text-1'))).toBe('Let me check the config.');
  });

  it('assistant thinking and tool_use blocks carry no reply text', () => {
    expect(assistantText(byUuid('a-think-1'))).toBe('');
    expect(assistantText(byUuid('a-tool-1'))).toBe('');
  });

  it('tool_result: a user line holding a tool_result block is not a prompt', () => {
    expect(isUserTurn(byUuid('u-result-1'))).toBe(false);
    expect(isUserTurn(byUuid('u-result-2'))).toBe(false);
  });

  it('sidechain: isSidechain lines are neither prompts nor replies', () => {
    expect(isUserTurn(byUuid('u-side-1'))).toBe(false);
    expect(assistantText(byUuid('a-side-1'))).toBe('');
  });

  it('summary and custom-title lines are neither prompts nor replies', () => {
    const [summary, title] = entries();
    expect(summary).toMatchObject({ type: 'summary', summary: 'Demo app: slow build' });
    expect(title).toMatchObject({ type: 'custom-title', customTitle: 'Build speed' });
    for (const entry of [summary, title]) {
      expect(rawPromptText(entry)).toBe('');
      expect(assistantText(entry)).toBe('');
    }
  });

  it('isMeta and isCompactSummary user lines are not her prompts', () => {
    expect(isUserTurn(byUuid('u-meta-1'))).toBe(false);
    expect(isUserTurn(byUuid('u-compact-1'))).toBe(false);
  });

  it('api-request-blob lines with text are not replies', () => {
    const blob = entries().find((entry) => entry.type === 'api-request-blob');
    expect(blob && assistantText(blob)).toBe('');
  });

  it('queued_command attachment: a message sent while Claude works is read as a prompt', () => {
    const queued = entries().find((entry) => entry.type === 'attachment');
    expect(queued && queuedPromptText(queued)).toBe('Also update the changelog.');
    expect(queued && isAgentMessage(queued)).toBe(false);
  });
});

describe('replies and turn boundaries', () => {
  it('reader: assistant text between two prompts joins into one reply, tool noise and sidechains left out', () => {
    const oldest = collect(entries()).newestFirst().at(-1);
    expect(oldest).toMatchObject({
      id: 'a-text-1',
      prompt: 'Why is the build slow?',
      markdown: 'Let me check the config.\n\nThe build type-checks twice. Drop the second check.',
    });
  });

  it('reader: each prompt (including a queued one) starts a new reply', () => {
    const collector = collect(entries());
    expect(collector.newestFirst().map((r) => [r.prompt, r.markdown])).toEqual([
      ['Also update the changelog.', 'Changelog updated.'],
      ['Ship it today?', 'Yes. Tests pass, so it can ship today.'],
      ['Why is the build slow?', 'Let me check the config.\n\nThe build type-checks twice. Drop the second check.'],
    ]);
    expect(collector.promptCount).toBe(3);
    expect(collector.waiting()).toEqual([]);
  });

  it('busy/done: turn stays open through thinking, tool_use and tool_result; end_turn text closes it', () => {
    expect(turnOpenAfter(byUuid('u-prompt-1'))).toBe(true);
    expect(turnOpenAfter(byUuid('a-think-1'))).toBe(true);
    expect(turnOpenAfter(byUuid('a-tool-1'))).toBe(true);
    expect(turnOpenAfter(byUuid('u-result-1'))).toBe(true);
    expect(turnOpenAfter(byUuid('a-final-1'))).toBe(false);
    expect(turnOpenAfter(byUuid('a-side-1'))).toBeNull(); // a subagent finishing never closes her turn
  });

  it('busy/done: the whole fixture ends with the turn closed', () => {
    const tracker = new TurnTracker();
    const all = entries();
    const toolAt = all.findIndex((entry) => entry.uuid === 'a-tool-1');
    for (const entry of all.slice(0, toolAt + 1)) tracker.add(entry);
    expect(tracker.open).toBe(true);
    for (const entry of all.slice(toolAt + 1)) tracker.add(entry);
    expect(tracker.open).toBe(false);
  });

  it('live tail: TranscriptTail reads the file into the same replies, done', async () => {
    const views: TranscriptView[] = [];
    const tail = new TranscriptTail(TRANSCRIPT, (view) => views.push(view));
    await tail.poll();
    tail.stop();
    expect(views.at(-1)).toMatchObject({ promptCount: 3, waiting: [], turnOpen: false });
    expect(views.at(-1)?.replies.map((r) => r.id)).toEqual(['a-final-3', 'a-final-2', 'a-text-1']);
  });

  it('history: past turns are her prompts with Claude text only (queued messages stay in the turn)', async () => {
    const turns = await readTurns(TRANSCRIPT);
    expect(turns).toEqual([
      { prompt: 'Why is the build slow?', reply: ['Let me check the config.', 'The build type-checks twice. Drop the second check.'] },
      { prompt: 'Ship it today?', reply: ['Yes. Tests pass, so it can ship today.', 'Changelog updated.'] },
    ]);
    const page = pageOfTurns(await turnsFor(TRANSCRIPT), undefined);
    expect(page).toMatchObject({ start: 0, total: 2 });
    expect(page.turns[1]?.reply).toBe('Yes. Tests pass, so it can ship today.\n\nChangelog updated.');
  });

  it('jsonl window: head and tail slices parse whole lines only', () => {
    const size = fs.statSync(TRANSCRIPT).size;
    expect(readTail(TRANSCRIPT, size)).toMatchObject({ covered: true });
    expect(readTail(TRANSCRIPT, size).entries).toHaveLength(19);
    const tail = readTail(TRANSCRIPT, 700);
    expect(tail.covered).toBe(false);
    expect(tail.entries.at(-1)?.uuid).toBe('a-final-3');
    expect(readHead(TRANSCRIPT, 200).entries[0]).toMatchObject({ type: 'summary' });
  });
});

describe('subagents', () => {
  it('subagents: agent-<id>.jsonl is listed by id while recently written', () => {
    const file = path.join(SUBAGENTS, 'agent-a9f8e7d6.jsonl');
    const now = fs.statSync(file).mtimeMs + 1000;
    expect(activeSubagentFiles(SUBAGENTS, now).map((f) => f.id)).toEqual(['a9f8e7d6']);
  });

  it('subagents: agent-<id>.meta.json description names the task', () => {
    expect(subagentTask(path.join(SUBAGENTS, 'agent-a9f8e7d6.jsonl'))).toBe('Time the build');
  });
});

describe('headless claude -p --output-format json', () => {
  it('headless: the JSON inside the result envelope is read', () => {
    const stdout = fs.readFileSync(path.join(FIXTURES, 'headless-result.json'), 'utf8');
    expect(replyJson(stdout)).toEqual({ title: 'Build speed', tags: ['build'] });
  });

  it('headless: is_error true surfaces the result as an error', () => {
    const stdout = fs.readFileSync(path.join(FIXTURES, 'headless-error.json'), 'utf8');
    expect(() => replyJson(stdout)).toThrow(/Claude error: Credit balance is too low/);
  });
});
