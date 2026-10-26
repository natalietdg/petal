// Claude's own test runs, read from a session log: Bash calls whose command runs tests, typechecks or lints,
// paired with their results. Reads only what was appended since the last read, per log. Also counts file edits,
// so an auto run knows a turn changed files, and writes to a task's suite file, so Petal knows which session made them.
// testing-ipc.ts calls this behind the folder gate.
import fs from 'node:fs';
import { parseEntry, type ContentItem } from './transcript-entry';
import { promptText, trimTo } from './prompts';
import { parseText, keepOutput, shortenPaths } from './testing-parse';
import { resolveRunner } from './testing-runner';
import { isTestCommand, matchStage, runnerOf, type PipelineRun, type StageConfig, type StageResult } from '../shared/testing';

// at: the tool_use's timestamp; endAt: its tool_result's. prompt: her prompt that turn answered. cwd: Claude's folder then.
export interface ClaudeCall { id: string; command: string; at: number; endAt: number; output: string; isError: boolean; sessionId: string; prompt: string; cwd: string | null }

interface Pending { command: string; at: number; prompt: string; cwd: string | null }
// A tool call that names .petal/suites/<taskId>.json, read as a write to that task's suite.
// Every file edit and shell line, so the test lock can tell who changed a locked file.
export interface FileTouch { target: string; at: number; sessionId: string; kind: 'edit' | 'bash'; cwd: string | null }
interface LogState { offset: number; rest: string; pending: Map<string, Pending>; calls: ClaudeCall[]; seen: Set<string>; edits: number; prompt: string; touches: FileTouch[] }

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const CHECK_SCRIPT = /\b(npm|pnpm|yarn|bun)\s+(?:run\s+)?(typecheck|type-check|lint|check)\b/;
const MAX_CALLS = 400; // per log, newest kept
const MAX_TOUCHES = 400;
const PROMPT_KEEP = 200;
const CHUNK = 1 << 20;

// Commands worth keeping: tests, plus the typecheck and lint a pipeline usually starts with.
export const isCheckCommand = (command: string): boolean =>
  isTestCommand(command) || runnerOf(command) === 'tsc' || runnerOf(command) === 'eslint' || CHECK_SCRIPT.test(command);

const states = new Map<string, LogState>();

const textOf = (content: unknown): string => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.map((part: { type?: string; text?: string }) => (part?.type === 'text' ? part.text ?? '' : '')).join('\n') : '');

const itemsOf = (content: unknown): ContentItem[] => (Array.isArray(content) ? content as ContentItem[] : []);

// Only the conversation's own entries count: Claude Code also logs request copies with no timestamp
// ("api-request-blob") that repeat earlier tool calls, which once filed each call twice at "now".
function readLine(state: LogState, line: string, sessionId: string): void {
  if (!line.includes('"tool_use"') && !line.includes('"tool_result"') && !line.includes('"type":"user"')) return;
  let entry;
  try { entry = parseEntry(line); } catch { return; }
  const at = Date.parse(entry.timestamp ?? '');
  if (!at || entry.isSidechain || (entry.type !== 'assistant' && entry.type !== 'user')) return;
  const prompt = promptText(entry);
  if (prompt) state.prompt = trimTo(prompt, PROMPT_KEEP);
  const cwd = typeof entry.cwd === 'string' ? entry.cwd : null;
  for (const item of itemsOf(entry.message?.content)) {
    if (item.type === 'tool_use' && item.name && EDIT_TOOLS.has(item.name)) state.edits += 1;
    if (item.type === 'tool_use' && item.input && (EDIT_TOOLS.has(item.name ?? '') || item.name === 'Bash')) { // a Read names the file but changes nothing
      const target = item.name === 'Bash' ? item.input.command : item.input.file_path ?? item.input.notebook_path;
      if (typeof target === 'string') state.touches.push({ target, at, sessionId, kind: item.name === 'Bash' ? 'bash' : 'edit', cwd });
    }
    if (item.type === 'tool_use' && item.name === 'Bash' && item.id && !state.seen.has(item.id) && typeof item.input?.command === 'string' && isCheckCommand(item.input.command)) {
      state.pending.set(item.id, { command: item.input.command, at, prompt: state.prompt, cwd });
    }
    if (item.type === 'tool_result' && item.tool_use_id && state.pending.has(item.tool_use_id)) {
      const call = state.pending.get(item.tool_use_id);
      state.pending.delete(item.tool_use_id);
      state.seen.add(item.tool_use_id);
      if (call) state.calls.push({ id: item.tool_use_id, command: call.command, at: call.at, endAt: Math.max(call.at, at), output: textOf(item.content), isError: item.is_error === true, sessionId, prompt: call.prompt, cwd: call.cwd });
    }
  }
}

export interface LogScan { calls: ClaudeCall[]; edits: number; touches: FileTouch[] }

const scanning = new Map<string, Promise<unknown>>(); // one scan per log at a time, so offsets never race

// Reads what the log gained since last time; a log that shrank (rewritten) is read again from the start.
// Async, a chunk per read: a first scan of a long log never holds up the main thread.
export function scanLog(file: string, sessionId: string): Promise<LogScan> {
  const run = (scanning.get(file) ?? Promise.resolve()).then(() => readAppended(file, sessionId));
  const settled = run.catch(() => undefined);
  scanning.set(file, settled);
  void settled.then(() => { if (scanning.get(file) === settled) scanning.delete(file); });
  return run;
}

async function readAppended(file: string, sessionId: string): Promise<LogScan> {
  let state = states.get(file);
  let size: number;
  try { size = (await fs.promises.stat(file)).size; } catch { return { calls: state?.calls ?? [], edits: state?.edits ?? 0, touches: state?.touches ?? [] }; }
  if (!state || size < state.offset) {
    state = { offset: 0, rest: '', pending: new Map(), calls: [], seen: new Set(), edits: 0, prompt: '', touches: [] };
    states.set(file, state);
  }
  if (size > state.offset) {
    const handle = await fs.promises.open(file, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(CHUNK, size - state.offset));
      while (state.offset < size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - state.offset), state.offset);
        if (bytesRead <= 0) break;
        state.offset += bytesRead;
        const lines = (state.rest + buffer.toString('utf8', 0, bytesRead)).split('\n');
        state.rest = lines.pop() ?? '';
        for (const line of lines) readLine(state, line, sessionId);
      }
    } finally {
      await handle.close();
    }
    if (state.calls.length > MAX_CALLS) state.calls = state.calls.slice(-MAX_CALLS);
    if (state.touches.length > MAX_TOUCHES) state.touches = state.touches.slice(-MAX_TOUCHES);
  }
  return { calls: state.calls, edits: state.edits, touches: state.touches };
}

export const forgetLogs = (): void => states.clear();

const wallTime = (call: ClaudeCall): number | null => (call.endAt > call.at ? call.endAt - call.at : null);

// One Claude call as a one-stage run, put on the stage whose command matches.
export function claudeRun(call: ClaudeCall, stages: StageConfig[], scripts: Record<string, string> = {}, root: string | null = null): PipelineRun {
  const runner = runnerOf(call.command);
  const parsed = root ? shortenPaths(parseText(call.output, runner), root) : parseText(call.output, runner);
  const exitCode = Number(/^Exit code (\d+)/m.exec(call.output)?.[1] ?? (call.isError ? 1 : 0));
  const failed = call.isError || exitCode !== 0 || parsed.counts.failed > 0;
  const stage = matchStage(call.command, stages, (command) => resolveRunner(command, scripts).runner);
  const result: StageResult = {
    stageId: stage?.id ?? null,
    name: stage?.name ?? 'Claude’s run',
    command: call.command,
    status: failed ? 'failed' : 'passed',
    exitCode,
    durationMs: wallTime(call) ?? parsed.durationMs, // the command's own time, from the log, as her runs measure theirs
    counts: parsed.counts,
    tests: parsed.tests,
    output: failed ? keepOutput(call.output) : '',
    runner: parsed.runner ?? runner,
  };
  return {
    id: `claude-${call.id}`, by: 'claude', trigger: 'transcript', startedAt: call.at, finishedAt: call.endAt, state: failed ? 'failed' : 'passed',
    stages: [result], totals: parsed.counts, sessionId: call.sessionId, prompt: call.prompt, ...(call.cwd ? { cwd: call.cwd } : {}),
  };
}
