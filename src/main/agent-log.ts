// An agent session's action log and token use, read from its Claude Code transcript. Re-read only when the file changed.
import fs from 'node:fs';
import { actionsFrom, type AgentAction } from '../shared/agent-actions';
import { sumUsage, type TokenUsage } from '../shared/token-usage';

export interface AgentLog { actions: AgentAction[]; tokens: TokenUsage }

const MAX_BYTES = 32 * 1024 * 1024; // an agent's log past this is read from its end
const cache = new Map<string, { size: number; mtime: number; log: AgentLog }>();

function entriesOf(file: string, size: number): unknown[] {
  const fd = fs.openSync(file, 'r');
  try {
    const start = Math.max(0, size - MAX_BYTES);
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString('utf8').split('\n').flatMap((line) => { try { return line ? [JSON.parse(line)] : []; } catch { return []; } });
  } finally {
    fs.closeSync(fd);
  }
}

export function readAgentLog(file: string, root: string | null): AgentLog {
  let stat: fs.Stats;
  try { stat = fs.statSync(file); } catch { return { actions: [], tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 } }; }
  const key = `${file}\0${root ?? ''}`;
  const hit = cache.get(key);
  if (hit && hit.size === stat.size && hit.mtime === stat.mtimeMs) return hit.log;
  const entries = entriesOf(file, stat.size);
  const log = { actions: actionsFrom(entries, root), tokens: sumUsage(entries) };
  cache.set(key, { size: stat.size, mtime: stat.mtimeMs, log });
  return log;
}
