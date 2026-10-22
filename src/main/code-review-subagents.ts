// Code review for a session's subagents: each one's log as its own review session (only from a Claude projects
// subagents folder), and which parent turn launched it, matched by the Agent tool_use id in its meta.json.
import fs from 'node:fs';
import path from 'node:path';
import { allowedClaudeHome } from './claude-folder';
import { agentFile, isAgentId } from './agents';
import { codeTurns } from './code-review-index';
import { subagentTask } from './sessions-monitor';
import { codeReviewFixture, isSnapshotRun } from './snapshot-mode';
import type { ReviewSession } from './code-review';
import type { SubagentChanges } from '../shared/code-review';

const LOG_NAME = /^agent-[\w-]{1,80}\.jsonl$/;
const META_NAME = /^agent-([\w-]{1,80})\.meta\.json$/;

const realPath = (file: string): string | null => {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
};

// <root>/<project>/<session>/subagents/agent-<id>.jsonl and nothing else: no climbing out, no other folder.
export function isSubagentLog(file: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    const rel = path.relative(path.resolve(root), path.resolve(file));
    const parts = rel.split(path.sep);
    return !path.isAbsolute(rel) && parts.length === 4 && !parts.includes('..') && parts[2] === 'subagents' && LOG_NAME.test(parts[3]);
  });
}

// The Claude folder's projects (none while reading is off); snapshot runs add their scratch fixture roots.
export const subagentRoots = (): string[] => {
  const home = allowedClaudeHome();
  return [...(home ? [path.join(home, 'projects')] : []), ...(isSnapshotRun() ? codeReviewFixture.projectsRoots : [])];
};

const subagentsDirOf = (parent: ReviewSession): string => path.join(path.dirname(parent.transcript), parent.sessionId, 'subagents');

// A subagent's log as a review session, cached apart as <parent>--<agentId>; null when missing or outside the folder.
export function subagentSession(parent: ReviewSession, agentId: unknown, roots: readonly string[] = subagentRoots()): ReviewSession | null {
  if (!isAgentId(agentId)) return null;
  const real = realPath(agentFile(subagentsDirOf(parent), agentId));
  if (!real || !isSubagentLog(real, roots.map((root) => realPath(root) ?? root))) return null;
  return { sessionId: `${parent.sessionId}--${agentId}`, transcript: real, cwd: parent.cwd, subagent: true };
}

const metas = new Map<string, { mtime: number; toolUseId: string | null }>(); // by meta file, reread when it moves

function toolUseIdOf(file: string): string | null {
  try {
    const mtime = fs.statSync(file).mtimeMs;
    const cached = metas.get(file);
    if (cached?.mtime === mtime) return cached.toolUseId;
    const meta = JSON.parse(fs.readFileSync(file, 'utf8')) as { toolUseId?: unknown };
    const toolUseId = typeof meta.toolUseId === 'string' ? meta.toolUseId : null;
    metas.set(file, { mtime, toolUseId });
    return toolUseId;
  } catch {
    return null;
  }
}

// Agent ids by the Agent tool_use id that launched them.
export function launchedAgents(dir: string): Map<string, string> {
  const byCall = new Map<string, string>();
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return byCall;
  }
  for (const name of names) {
    const agentId = META_NAME.exec(name)?.[1];
    const call = agentId ? toolUseIdOf(path.join(dir, name)) : null;
    if (agentId && call) byCall.set(call, agentId);
  }
  return byCall;
}

const counted = new Map<string, { mtime: number; size: number; turnIds: string[]; functions: number }>(); // by log

async function changesOf(session: ReviewSession): Promise<{ turnIds: string[]; functions: number }> {
  const { mtimeMs, size } = await fs.promises.stat(session.transcript);
  const cached = counted.get(session.transcript);
  if (cached?.mtime === mtimeMs && cached.size === size) return cached;
  const turns = (await codeTurns(session.transcript, true)).filter((t) => t.cards.length);
  const next = { mtime: mtimeMs, size, turnIds: turns.map((t) => t.turnId), functions: turns.reduce((sum, t) => sum + t.cards.length, 0) };
  counted.set(session.transcript, next);
  return next;
}

// Each parent turn's subagents that changed code, by turn id.
export async function subagentsByTurn(
  parent: ReviewSession, turns: readonly { turnId: string; agentCalls: string[] }[], roots: readonly string[] = subagentRoots(),
): Promise<Map<string, SubagentChanges[]>> {
  const byTurn = new Map<string, SubagentChanges[]>();
  if (!turns.some((t) => t.agentCalls.length)) return byTurn;
  const launched = launchedAgents(subagentsDirOf(parent));
  for (const turn of turns) {
    const agents: SubagentChanges[] = [];
    for (const agentId of turn.agentCalls.map((call) => launched.get(call))) {
      const session = agentId ? subagentSession(parent, agentId, roots) : null;
      const changes = session ? await changesOf(session).catch(() => null) : null;
      if (agentId && session && changes?.functions) agents.push({ agentId, description: subagentTask(session.transcript), turnIds: changes.turnIds, functions: changes.functions });
    }
    if (agents.length) byTurn.set(turn.turnId, agents);
  }
  return byTurn;
}
