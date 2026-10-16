// mentions:send: the reply box, a Board card or a reply's To line sends one message to other tabs in the same window.
import { handle } from './ipc';
import { tabLabel, tabSession } from './tabs';
import { repoLabel } from './repo-label';
import { deliverMentions, type MentionPort } from './mentions';
import { recordActivity } from './activity-feed';
import { isSnapshotRun, pasteWrites } from './snapshot-mode';
import type { TabSession } from './tab-session';

function portOf(session: TabSession): MentionPort {
  const followed = session.feed.session;
  return {
    name: tabLabel(session),
    place: followed ? repoLabel(followed.cwd) : null,
    running: Boolean(followed),
    busy: followed?.status === 'busy',
    // Snapshot runs record the paste, exactly as the reply box's pty:paste does, and type nothing.
    write: (data) => (isSnapshotRun() ? pasteWrites.push({ tabId: session.tabId, data }) : session.pty.write(data)),
  };
}

export function registerMentionsIpc(): void {
  handle('mentions:send', (event, { from, to, text }) => {
    if (!Array.isArray(to) || typeof text !== 'string') throw new Error('A message needs its sessions and its text.');
    const lookup = (tabId: string) => {
      const session = typeof tabId === 'string' ? tabSession(event.sender.id, tabId) : undefined;
      return session ? portOf(session) : undefined;
    };
    const { deliveries, activity } = deliverMentions({ from: typeof from === 'string' ? from : null, to: to.filter((t) => typeof t === 'string'), text }, lookup);
    if (activity) recordActivity(activity);
    return { deliveries };
  });
}
