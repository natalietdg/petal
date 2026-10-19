// mentions:send: the reply box, a Board card or a reply's To line sends one message to other tabs in the same window.
import { handle } from './ipc';
import { tabLabel, tabSession } from './tabs';
import path from 'node:path';
import { repoBranch, repoLabel, repoRoot } from './repo-label';
import { deliverMentions, type MentionPort } from './mentions';
import { recordMessage } from './activity-feed';
import { isSnapshotRun, pasteWrites } from './snapshot-mode';
import type { TabSession } from './tab-session';

function portOf(session: TabSession): MentionPort {
  const followed = session.feed.session;
  const root = repoRoot(followed?.cwd);
  return {
    name: tabLabel(session),
    place: followed ? repoLabel(followed.cwd) : null,
    sessionId: followed?.sessionId ?? null,
    branch: followed ? repoBranch(followed.cwd) : null,
    repo: root ? path.basename(root) : null,
    running: Boolean(followed),
    busy: followed?.status === 'busy',
    // Snapshot runs record the paste, exactly as the reply box's pty:paste does, and type nothing.
    write: (data) => (isSnapshotRun() ? pasteWrites.push({ tabId: session.tabId, data }) : session.pty.write(data)),
  };
}

export function registerMentionsIpc(): void {
  handle('mentions:send', (event, { from, to, text, asking }) => {
    if (!Array.isArray(to) || typeof text !== 'string') throw new Error('A message needs its sessions and its text.');
    const lookup = (tabId: string) => {
      const session = typeof tabId === 'string' ? tabSession(event.sender.id, tabId) : undefined;
      return session ? portOf(session) : undefined;
    };
    const strings = (list: unknown): string[] => (Array.isArray(list) ? list.filter((t): t is string => typeof t === 'string') : []);
    const { deliveries, messages } = deliverMentions({ from: typeof from === 'string' ? from : null, to: strings(to), text, asking: strings(asking) }, lookup);
    for (const message of messages) recordMessage(message);
    return { deliveries };
  });
}
