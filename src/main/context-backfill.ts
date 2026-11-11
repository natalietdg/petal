// Fills the shared context store from past session logs at startup, so Related has something to show before
// any new session runs. Read only, bounded per log, one log per turn of the event loop; never in snapshot runs.
import * as history from './history';
import { readTail } from './jsonl-window';
import { ReplyCollector } from './replies';
import { repoLabel } from './repo-label';
import { editedFiles } from './transcript';
import { claudeFolderAllowed } from './claude-folder';
import * as contextStore from './context-store';

const MAX_SESSIONS = 80; // the newest logs; older ones rarely relate to live work
const TAIL_BYTES = 2 * 1024 * 1024; // the newest replies and edits of a long log; the head of a huge one is left unread

const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export async function backfillContextStore(limit = MAX_SESSIONS): Promise<number> {
  if (!claudeFolderAllowed()) return 0;
  let written = 0;
  for (const session of history.listSessions().filter((s) => !s.live).slice(0, limit)) {
    const known = contextStore.recordedAt(session.sessionId);
    if (known !== null && known >= session.lastAt) continue; // already read up to its last reply
    const collector = new ReplyCollector();
    const files: string[] = [];
    for (const entry of readTail(session.file, TAIL_BYTES).entries) {
      collector.add(entry);
      files.push(...editedFiles(entry));
    }
    contextStore.record({ sessionId: session.sessionId, cwd: session.cwd, repo: repoLabel(session.cwd), replies: collector.newestFirst(), files });
    written += 1;
    await nextTurn();
  }
  return written;
}
