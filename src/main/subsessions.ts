// Headless `claude -p` children: who their parent is, and how each one is doing, for the parent's agents list.
// The parent link only exists in the live process tree (child claude -> zsh -> ... -> parent claude), so it is walked once and stored.
import { isHeadless, listProcesses, readSessionFile, transcriptPath, type ProcessRow, type SessionFile } from './claude-session';
import { readTail } from './jsonl-window';
import { agentStatus, isFinished, latestStep, NO_STEP } from './agent-steps';
import * as links from './subsession-links';
import { claudeFolderAllowed } from './claude-folder';
import { sessionTitleFor } from './session-title';
import type { SubsessionLink } from './subsession-links';
import type { TranscriptEntry } from './transcript-entry';
import type { ScreenAsk } from '../shared/prompt-answer';
import type { ChildRow } from '../shared/subsessions';

export const MAX_HOPS = 6; // child claude -> zsh -> zsh -> parent claude is 3; more means it is not a child
const TAIL_BYTES = 64 * 1024;

// The nearest ancestor pid with a sessions/<pid>.json, within MAX_HOPS; null when there is none.
export function parentSessionPid(childPid: number, processes: readonly ProcessRow[], hasSession: (pid: number) => boolean, maxHops = MAX_HOPS): number | null {
  const ppidOf = new Map(processes.map((p) => [p.pid, p.ppid]));
  let pid = ppidOf.get(childPid);
  for (let hop = 0; hop < maxHops && pid !== undefined && pid > 1; hop += 1) {
    if (hasSession(pid)) return pid;
    pid = ppidOf.get(pid);
  }
  return null;
}

export interface ResolveDeps {
  processes: () => Promise<ProcessRow[]>;
  readSession: (pid: number) => SessionFile | null;
  load: () => SubsessionLink[];
  save: (fresh: readonly SubsessionLink[]) => SubsessionLink[];
  nameOf: (session: SessionFile) => string; // the shared session title, never Claude Code's raw name field
}

const realDeps: ResolveDeps = {
  processes: listProcesses, readSession: readSessionFile, load: links.load, save: links.add,
  nameOf: (s) => sessionTitleFor(s.sessionId, { cwd: s.cwd }),
};

// Links every live headless session not linked yet; one `ps` only when there is something new to walk.
export async function resolveLinks(live: readonly SessionFile[], deps: ResolveDeps = realDeps, now = Date.now()): Promise<SubsessionLink[]> {
  const known = deps.load();
  const linked = new Set(known.map((l) => l.childId));
  const unlinked = live.filter((s) => isHeadless(s) && !linked.has(s.sessionId));
  if (!unlinked.length) return known;
  const processes = await deps.processes();
  const fresh = unlinked.flatMap((child): SubsessionLink[] => {
    const parentPid = parentSessionPid(child.pid, processes, (pid) => deps.readSession(pid) !== null);
    const parent = parentPid === null ? null : deps.readSession(parentPid);
    if (!parent || parent.sessionId === child.sessionId) return [];
    return [{ childId: child.sessionId, parentId: parent.sessionId, cwd: child.cwd, name: deps.nameOf(child), at: now }];
  });
  return fresh.length ? deps.save(fresh) : known;
}

// An AskUserQuestion with no answer yet: the child stopped on a question.
export function pendingAsk(entries: readonly TranscriptEntry[]): ScreenAsk | null {
  const answered = new Set<string>();
  for (const entry of entries) {
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) if (item.type === 'tool_result' && item.tool_use_id) answered.add(item.tool_use_id);
  }
  for (const entry of [...entries].reverse()) {
    const content = entry.message?.content;
    if (entry.type !== 'assistant' || !Array.isArray(content)) continue;
    const ask = content.find((item) => item.type === 'tool_use' && item.name === 'AskUserQuestion');
    if (ask) return ask.id && !answered.has(ask.id) ? 'question' : null;
  }
  return null;
}

const timeOf = (iso: string | undefined): number | null => {
  const ms = Date.parse(iso ?? '');
  return Number.isFinite(ms) ? ms : null;
};

export interface ChildFile {
  link: SubsessionLink;
  live: SessionFile | null; // its process, while it runs
  mtime: number;
  entries: readonly TranscriptEntry[]; // the transcript's tail
}

// One child as its parent's agents list shows it. A live child silent too long is stalled, never waiting.
export function childRow({ link, live, mtime, entries }: ChildFile, now = Date.now()): ChildRow {
  const ask = live ? pendingAsk(entries) : null;
  const askEntry = ask ? [...entries].reverse().find((e) => e.type === 'assistant') : undefined;
  const status = live ? agentStatus(false, mtime, now) : 'finished';
  return {
    sessionId: link.childId,
    name: link.name,
    status,
    ask,
    askSince: ask ? timeOf(askEntry?.timestamp) ?? mtime : null,
    updatedAt: mtime,
    step: latestStep([...entries]) ?? (isFinished([...entries]) ? 'Finished' : NO_STEP),
  };
}

// Reads one child's transcript tail; null when it has none yet.
export function readChild(link: SubsessionLink, live: SessionFile | null, stat: (file: string) => number | null): ChildFile | null {
  if (!claudeFolderAllowed()) return null;
  const file = transcriptPath({ cwd: link.cwd, sessionId: link.childId });
  const mtime = stat(file);
  if (mtime === null) return null;
  return { link, live, mtime, entries: readTail(file, TAIL_BYTES).entries };
}

export interface Grouped {
  top: SessionFile[]; // cards
  childrenOf: Map<string, SubsessionLink[]>; // parent session id -> its children, live or not
  orphans: SessionFile[]; // live headless runs whose parent is unknown or gone
}

// Headless sessions never become cards: each joins a live parent, or the orphans.
export function group(live: readonly SessionFile[], known: readonly SubsessionLink[]): Grouped {
  const liveIds = new Set(live.map((s) => s.sessionId));
  const top = live.filter((s) => !isHeadless(s));
  const topIds = new Set(top.map((s) => s.sessionId));
  const childrenOf = new Map<string, SubsessionLink[]>();
  for (const link of known) {
    if (!topIds.has(link.parentId)) continue;
    childrenOf.set(link.parentId, [...(childrenOf.get(link.parentId) ?? []), link]);
  }
  const orphans = live.filter((s) => isHeadless(s) && !topIds.has(links.parentOf(known, s.sessionId) ?? '') && liveIds.has(s.sessionId));
  return { top, childrenOf, orphans };
}
