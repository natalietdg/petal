// The Sessions board's read for each live session: newest reply digest, repo · branch and conclusion. Read only.
import fs from 'node:fs';
import { claudeFolderAllowed } from './claude-folder';
import { transcriptPath, type SessionFile } from './claude-session';
import { readTail } from './jsonl-window';
import { ReplyCollector } from './replies';
import { repoLabel } from './repo-label';
import * as conclusionsStore from './conclusions-store';
import { digestReplies, EMPTY_DIGEST, type BoardDetail, type ReplyDigest } from '../shared/sessions-board';

const TAIL_BYTES = 256 * 1024; // the same window activity.ts widens to for a long last reply
const DIGEST_REPLIES = 5; // status lines may sit a few replies back

// Digest per transcript, reread only when its size or mtime moves; the board ticks every 2s.
const digestCache = new Map<string, { size: number; mtime: number; digest: ReplyDigest }>();

function digestOf(file: string): ReplyDigest {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return EMPTY_DIGEST; // no transcript yet
  }
  const cached = digestCache.get(file);
  if (cached && cached.size === stat.size && cached.mtime === stat.mtimeMs) return cached.digest;
  const collector = new ReplyCollector(DIGEST_REPLIES);
  for (const entry of readTail(file, TAIL_BYTES).entries) collector.add(entry);
  const digest = digestReplies(collector.newestFirst());
  digestCache.set(file, { size: stat.size, mtime: stat.mtimeMs, digest });
  return digest;
}

// Drops cache entries for sessions no longer listed.
function prune(files: ReadonlySet<string>): void {
  for (const file of digestCache.keys()) if (!files.has(file)) digestCache.delete(file);
}

// Nothing while reading is off: the board shows its gated state instead.
export async function boardDetails(sessions: readonly SessionFile[]): Promise<Map<string, BoardDetail>> {
  const details = new Map<string, BoardDetail>();
  if (!claudeFolderAllowed()) return details;
  const files = new Set<string>();
  for (const session of sessions) {
    const file = transcriptPath(session);
    files.add(file);
    details.set(session.sessionId, {
      digest: digestOf(file),
      conclusion: await conclusionsStore.refresh(session.sessionId, file),
      place: repoLabel(session.cwd),
    });
  }
  prune(files);
  return details;
}
