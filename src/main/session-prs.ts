// A session's PRs for the reader's PRs tab: its log read once and then only what it gains, behind the folder gate.
import fs from 'node:fs';
import { claudeFolderAllowed } from './claude-folder';
import { parseEntry } from './transcript-entry';
import { PrScan } from './pr-scan';
import { locate } from './session-info';
import { cachedMainSafe } from './main-safe-run';
import { cachedDeployOrder } from './deploy-order-run';
import * as prNotes from './pr-notes-store';
import { groupServices, type SessionPrsView } from '../shared/session-prs';
import type { TabSessions } from './tab-session';

const CHUNK = 1 << 20;
const MAY_HOLD_PR = /\/pull\/\d|\/pullrequest\/\d|pr\s+create|pullRequestId/i; // other lines skip JSON.parse

interface LogState { offset: number; rest: string; scan: PrScan }
const logs = new Map<string, LogState>();
const reads = new Map<string, Promise<unknown>>(); // one read per log at a time, so offsets never race

function readLine(state: LogState, line: string): void {
  if (!MAY_HOLD_PR.test(line)) return;
  try { state.scan.add(parseEntry(line)); } catch { /* a half-written or foreign line */ }
}

async function readAppended(file: string): Promise<LogState> {
  let state = logs.get(file);
  const { size } = await fs.promises.stat(file);
  if (!state || size < state.offset) {
    state = { offset: 0, rest: '', scan: new PrScan() };
    logs.set(file, state);
  }
  if (size === state.offset) return state;
  const handle = await fs.promises.open(file, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(CHUNK, size - state.offset));
    while (state.offset < size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - state.offset), state.offset);
      if (bytesRead <= 0) break;
      state.offset += bytesRead;
      const lines = (state.rest + buffer.toString('utf8', 0, bytesRead)).split('\n');
      state.rest = lines.pop() ?? '';
      for (const line of lines) readLine(state, line);
    }
  } finally {
    await handle.close();
  }
  return state;
}

export function scanSessionLog(file: string): Promise<LogState> {
  const run = (reads.get(file) ?? Promise.resolve()).then(() => readAppended(file));
  const settled = run.catch(() => undefined);
  reads.set(file, settled);
  void settled.then(() => { if (reads.get(file) === settled) reads.delete(file); });
  return run;
}

export type FoundPrs = Omit<SessionPrsView, 'mainSafe' | 'order' | 'notes'>;

// The session's PRs and services alone; null when its log can't be read.
export async function findSessionPrs(sessionId: string, sessions: TabSessions): Promise<FoundPrs | null> {
  if (!claudeFolderAllowed()) return null;
  const found = locate(sessionId, sessions);
  if (!found || !fs.existsSync(found.transcript)) return null;
  const { scan } = await scanSessionLog(found.transcript);
  const prs = scan.prs();
  return { sessionId, prs, services: groupServices(prs, found.cwd) };
}

export async function sessionPrsView(sessionId: string, sessions: TabSessions): Promise<SessionPrsView | null> {
  const found = await findSessionPrs(sessionId, sessions);
  if (!found) return null;
  const { prs, services } = found;
  if (!prs.length) return { ...found, mainSafe: {}, order: null, notes: {} };
  const [mainSafe, order] = await Promise.all([cachedMainSafe(services), cachedDeployOrder(sessionId, prs, services)]);
  return { ...found, mainSafe, order, notes: prNotes.read(sessionId) };
}
