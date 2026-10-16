// Claude's own test runs, read from a session log: Bash calls whose command runs tests, typechecks or lints,
// paired with their results. Reads only what was appended since the last read, per log. Also counts file edits,
// so an auto run knows a turn changed files. testing-ipc.ts calls this behind the folder gate.
import fs from 'node:fs';
import { parseEntry, type ContentItem } from './transcript-entry';
import { parseText, keepOutput, shortenPaths } from './testing-parse';
import { resolveRunner } from './testing-runner';
import { isTestCommand, matchStage, runnerOf, type PipelineRun, type StageConfig, type StageResult } from '../shared/testing';

export interface ClaudeCall { id: string; command: string; at: number; output: string; isError: boolean; sessionId: string }

interface LogState { offset: number; rest: string; pending: Map<string, { command: string; at: number }>; calls: ClaudeCall[]; edits: number }

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const CHECK_SCRIPT = /\b(npm|pnpm|yarn|bun)\s+(?:run\s+)?(typecheck|type-check|lint|check)\b/;
const MAX_CALLS = 400; // per log, newest kept
const CHUNK = 1 << 20;

// Commands worth keeping: tests, plus the typecheck and lint a pipeline usually starts with.
export const isCheckCommand = (command: string): boolean =>
  isTestCommand(command) || runnerOf(command) === 'tsc' || runnerOf(command) === 'eslint' || CHECK_SCRIPT.test(command);

const states = new Map<string, LogState>();

const textOf = (content: unknown): string => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.map((part: { type?: string; text?: string }) => (part?.type === 'text' ? part.text ?? '' : '')).join('\n') : '');

const itemsOf = (content: unknown): ContentItem[] => (Array.isArray(content) ? content as ContentItem[] : []);

function readLine(state: LogState, line: string, sessionId: string): void {
  if (!line.includes('"tool_use"') && !line.includes('"tool_result"')) return;
  let entry;
  try { entry = parseEntry(line); } catch { return; }
  const at = Date.parse(entry.timestamp ?? '') || Date.now();
  for (const item of itemsOf(entry.message?.content)) {
    if (item.type === 'tool_use' && item.name && EDIT_TOOLS.has(item.name)) state.edits += 1;
    if (item.type === 'tool_use' && item.name === 'Bash' && item.id && typeof item.input?.command === 'string' && isCheckCommand(item.input.command)) {
      state.pending.set(item.id, { command: item.input.command, at });
    }
    if (item.type === 'tool_result' && item.tool_use_id && state.pending.has(item.tool_use_id)) {
      const call = state.pending.get(item.tool_use_id);
      state.pending.delete(item.tool_use_id);
      if (call) state.calls.push({ id: item.tool_use_id, command: call.command, at: call.at, output: textOf(item.content), isError: item.is_error === true, sessionId });
    }
  }
}

export interface LogScan { calls: ClaudeCall[]; edits: number }

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
  try { size = (await fs.promises.stat(file)).size; } catch { return { calls: state?.calls ?? [], edits: state?.edits ?? 0 }; }
  if (!state || size < state.offset) {
    state = { offset: 0, rest: '', pending: new Map(), calls: [], edits: 0 };
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
  }
  return { calls: state.calls, edits: state.edits };
}

export const forgetLogs = (): void => states.clear();

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
    durationMs: parsed.durationMs,
    counts: parsed.counts,
    tests: parsed.tests,
    output: failed ? keepOutput(call.output) : '',
    runner: parsed.runner ?? runner,
  };
  return { id: `claude-${call.id}`, by: 'claude', trigger: 'transcript', startedAt: call.at, finishedAt: call.at, state: failed ? 'failed' : 'passed', stages: [result], totals: parsed.counts, sessionId: call.sessionId };
}
