// Stored Outcome Flows: made on demand, kept in <userData>/flows/<sessionId>.json, never under ~/.claude.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { flowFor, type FlowStep, type Outcome } from './flow';
import { toMermaid, type MermaidExport } from './flow-mermaid';
import { writeTitles } from './flow-titles';
import type { Theme } from '../shared/types';
import { writeJsonAtomic } from './atomic-file';

// Bump when the extracted shape changes; older files then read as stale, not broken.
const FLOW_VERSION = 6; // 6: flow is a list of state changes
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

export interface StoredFlow {
  version: number;
  sessionId: string;
  title: string;
  cwd: string | null;
  createdAt: string;
  source: { path: string; size: number; mtimeMs: number };
  steps: FlowStep[];
  finalNext: Outcome | null;
  titledBy: 'claude-haiku' | 'rules';
  mermaid: { latest: MermaidExport; all: MermaidExport };
}

export interface CreateArgs {
  sessionId: string;
  title: string;
  cwd: string | null;
  transcriptFile: string;
  theme: Theme;
}

const flowsDir = () => path.join(app.getPath('userData'), 'flows');
export const fileFor = (sessionId: string): string | null => (SAFE_ID.test(sessionId) ? path.join(flowsDir(), `${sessionId}.json`) : null);

export function load(sessionId: string): StoredFlow | null {
  const file = fileFor(sessionId);
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as StoredFlow;
  } catch {
    return null;
  }
}

export const has = (sessionId: string): boolean => {
  const file = fileFor(sessionId);
  return Boolean(file && fs.existsSync(file));
};

// Stale when the log has grown or changed since the flow was made, or the format moved on.
export function isStale(stored: StoredFlow, transcriptFile: string): boolean {
  if (stored.version !== FLOW_VERSION) return true;
  try {
    const { size, mtimeMs } = fs.statSync(transcriptFile);
    return size > stored.source.size || mtimeMs > stored.source.mtimeMs;
  } catch {
    return false; // log gone: keep showing what was stored
  }
}

async function createNow({ sessionId, title, cwd, transcriptFile, theme }: CreateArgs): Promise<StoredFlow> {
  const file = fileFor(sessionId);
  if (!file) throw new Error('Unsafe session id');
  const { size, mtimeMs } = fs.statSync(transcriptFile); // before parsing, so later writes read as stale
  const flow = structuredClone(await flowFor(transcriptFile)); // titles are written onto a copy, not the parse cache
  const titling = await writeTitles(flow.steps);
  for (const step of flow.steps) delete step.excerpt;
  const stored: StoredFlow = {
    version: FLOW_VERSION,
    sessionId,
    title,
    cwd,
    createdAt: new Date().toISOString(),
    source: { path: transcriptFile, size, mtimeMs },
    steps: flow.steps,
    finalNext: flow.finalNext,
    titledBy: titling.ok ? 'claude-haiku' : 'rules',
    mermaid: { latest: toMermaid(flow, theme), all: toMermaid(flow, theme, { all: true }) },
  };
  writeJsonAtomic(file, stored);
  return stored;
}

// One create per session at a time: a second click (or a refresh) joins the running one.
const pending = new Map<string, Promise<StoredFlow>>();
export function create(args: CreateArgs): Promise<StoredFlow> {
  let running = pending.get(args.sessionId);
  if (!running) {
    running = createNow(args).finally(() => pending.delete(args.sessionId));
    pending.set(args.sessionId, running);
  }
  return running;
}
export const isCreating = (sessionId: string): boolean => pending.has(sessionId);
