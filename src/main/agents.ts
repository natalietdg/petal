// A session's subagents for the Agents dropdown and panel (read only): listed from meta + jsonl tails, one followed live.
import fs from 'node:fs';
import path from 'node:path';
import { readHead, readTail } from './jsonl-window';
import { FALLBACK_TASK, subagentTask } from './sessions-monitor';
import { agentStatus, finishedAfter, isFinished, latestStep, NO_STEP, STALLED_AFTER_MS, timelineItems, type AgentStatus, type TimelineItem } from './agent-steps';
import { JsonlTail } from './transcript';
import { parseEntry, type TranscriptEntry } from './transcript-entry';

const TAIL_BYTES = 64 * 1024;
const WIDE_TAIL_BYTES = 256 * 1024; // a handback with a long report can fill the first window
const HEAD_BYTES = 64 * 1024;
const COUNT_CHUNK = 256 * 1024;
const TOOL_USE_MARK = Buffer.from('"type":"tool_use"');
const TIMELINE_KEEP = 400;
const STATUS_ORDER: Record<AgentStatus, number> = { running: 0, stalled: 1, finished: 2 };

export interface AgentSummary {
  id: string;
  task: string;
  status: AgentStatus;
  startedAt: number;
  updatedAt: number;
  toolCalls: number;
  step: string;
}

export interface AgentsList {
  agents: AgentSummary[]; // the newest AGENTS_LISTED, plus any still running
  running: number;
  total: number; // every agent in the session, any day
}

export const AGENTS_LISTED = 50; // older ones are counted from a stat, never read

export const agentFile = (dir: string, agentId: string): string => path.join(dir, `agent-${agentId}.jsonl`);
export const isAgentId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);

// Counts tool calls in [from, to) by byte search; appends are counted once, so a long run stays cheap.
// Async, a chunk per read: a first listing of a long agent log never holds up the main thread.
async function countToolUses(file: string, from: number, to: number): Promise<number> {
  let count = 0;
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(file, 'r');
    const chunk = Buffer.alloc(Math.min(COUNT_CHUNK, Math.max(0, to - from)));
    let carry = Buffer.alloc(0);
    for (let pos = from; pos < to;) {
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, to - pos), pos);
      if (!bytesRead) break;
      pos += bytesRead;
      const data = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
      for (let i = data.indexOf(TOOL_USE_MARK); i !== -1; i = data.indexOf(TOOL_USE_MARK, i + TOOL_USE_MARK.length)) count++;
      carry = data.subarray(Math.max(0, data.length - TOOL_USE_MARK.length + 1)); // a mark split across chunks
    }
  } catch {
    // Unreadable now; the next listing retries.
  } finally {
    await handle?.close().catch(() => undefined);
  }
  return count;
}

function startedAt(file: string, fallback: number): number {
  const first = readHead(file, HEAD_BYTES).entries.find((entry) => entry.timestamp);
  const ms = first?.timestamp ? Date.parse(first.timestamp) : NaN;
  return Number.isFinite(ms) ? ms : fallback;
}

function tailEntries(file: string): TranscriptEntry[] {
  const entries = readTail(file, TAIL_BYTES).entries;
  return entries.some((entry) => entry.type === 'assistant') ? entries : readTail(file, WIDE_TAIL_BYTES).entries;
}

interface Cached {
  mtime: number;
  size: number;
  task: string;
  startedAt: number;
  finished: boolean;
  step: string;
  toolCalls: number;
}

// Reread only when a file's mtime or size moves (like session-organizer.loadCached).
const cache = new Map<string, Cached>();

async function describe(file: string, mtime: number, size: number, birth: number): Promise<Cached> {
  const before = cache.get(file);
  if (before && before.mtime === mtime && before.size === size) return before;
  const grew = before && before.size <= size;
  const toolCalls = (grew ? before.toolCalls : 0) + await countToolUses(file, grew ? before.size : 0, size);
  const entries = tailEntries(file);
  const next: Cached = {
    mtime,
    size,
    task: before && before.task !== FALLBACK_TASK ? before.task : subagentTask(file), // meta can land after the first write
    startedAt: before?.startedAt ?? startedAt(file, birth),
    finished: isFinished(entries),
    step: latestStep(entries) ?? before?.step ?? NO_STEP,
    toolCalls,
  };
  cache.set(file, next);
  return next;
}

// Running first, then stalled, then finished, newest first; every day of the session.
// Hundreds of agents stay cheap: all are stat'ed, only the newest AGENTS_LISTED (and any running) are read.
export async function listAgents(dir: string, now = Date.now()): Promise<AgentsList> {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((name) => /^agent-[\w-]+\.jsonl$/.test(name));
  } catch {
    return { agents: [], running: 0, total: 0 };
  }
  const files: { name: string; file: string; stat: fs.Stats }[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      files.push({ name, file, stat: fs.statSync(file) });
    } catch {
      // deleted between readdir and stat
    }
  }
  files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  const agents: AgentSummary[] = [];
  for (const [index, { name, file, stat }] of files.entries()) {
    const mayRun = now - stat.mtimeMs <= STALLED_AFTER_MS;
    if (index >= AGENTS_LISTED && !mayRun) {
      cache.delete(file);
      continue;
    }
    const d = await describe(file, stat.mtimeMs, stat.size, stat.birthtimeMs);
    const id = name.replace(/^agent-|\.jsonl$/g, '');
    agents.push({ id, task: d.task, status: agentStatus(d.finished, d.mtime, now), startedAt: d.startedAt, updatedAt: d.mtime, toolCalls: d.toolCalls, step: d.step });
  }
  agents.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.updatedAt - a.updatedAt);
  return { agents, running: agents.filter((a) => a.status === 'running').length, total: files.length };
}

export interface TimelineUpdate {
  items: TimelineItem[];
  finished: boolean;
  reset?: boolean; // the log was rewritten: drop the rows shown so far, these items start afresh
}

export interface TimelineStart extends TimelineUpdate {
  dropped: number; // older rows left out of a very long run
}

// One agent's timeline, followed with the reader's JsonlTail; only the agent on screen has one.
export class AgentTimeline {
  private readonly tail: JsonlTail;
  private items: TimelineItem[] = [];
  private dropped = 0;
  private finished = false;
  private started = false; // false while the first read fills `items`; after it, rows go out through onAppend
  private readonly ready: Promise<void>;

  constructor(file: string, private readonly onAppend: (update: TimelineUpdate) => void) {
    this.tail = new JsonlTail(file, { lines: (lines) => this.add(lines), restart: () => this.restart() });
    this.ready = this.tail.firstRead.then(() => { this.started = true; });
  }

  // A rewritten log is re-read from the top, so the rows read so far go first instead of showing twice.
  private restart(): void {
    this.items = [];
    this.dropped = 0;
    this.finished = false;
    if (this.started) this.onAppend({ items: [], finished: false, reset: true });
  }

  // The rows so far, once the first read is done.
  async start(): Promise<TimelineStart> {
    await this.ready;
    return { items: this.items, finished: this.finished, dropped: this.dropped };
  }

  private add(lines: string[]): void {
    const added: TimelineItem[] = [];
    for (const line of lines) {
      try {
        const entry = parseEntry(line);
        added.push(...timelineItems(entry));
        this.finished = finishedAfter(this.finished, entry);
      } catch {
        // Skip malformed lines.
      }
    }
    if (this.started) {
      if (added.length) this.onAppend({ items: added, finished: this.finished });
      return;
    }
    this.items.push(...added);
    const over = this.items.length - TIMELINE_KEEP;
    if (over > 0) {
      this.items = this.items.slice(over);
      this.dropped += over;
    }
  }

  poll(): Promise<void> {
    return this.tail.poll();
  }

  stop(): void {
    this.tail.stop();
  }
}
