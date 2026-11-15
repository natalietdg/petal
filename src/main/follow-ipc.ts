// Read-only follow: one window's reader shows a session Petal did not start, from its transcript. Nothing is ever typed into it.
import { claudeFolderAllowed } from './claude-folder';
import { handle, on, send } from './ipc';
import { ReaderFeed } from './reader-feed';
import { followSource, liveNow } from './outside-sessions';
import * as history from './history';

const SESSION_ID = /^[\w-]{1,128}$/;
const followers = new Map<number, ReaderFeed>(); // by webContents id: one followed session per window
const hooked = new Set<number>(); // windows whose close already stops their follower

function stop(contentsId: number): void {
  followers.get(contentsId)?.stop();
  followers.delete(contentsId);
}

export function registerFollowIpc(): void {
  handle('follow:start', (event, { sessionId }) => {
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return { note: 'That isn’t a session id.' };
    if (!claudeFolderAllowed()) return { note: 'Petal isn’t reading your Claude folder, so it can’t follow a session.' };
    if (!followSource(sessionId)()) return { note: 'Petal can’t find that session’s replies on this Mac.' };
    const sender = event.sender;
    stop(sender.id);
    if (!hooked.has(sender.id)) { hooked.add(sender.id); sender.once('destroyed', () => { stop(sender.id); hooked.delete(sender.id); }); }
    const live = (): boolean => liveNow().some((s) => s.sessionId === sessionId) || history.isLive(sessionId);
    const feed = new ReaderFeed(0, (_channel, update) => {
      if (!sender.isDestroyed()) send(sender, 'follow:update', { sessionId, live: live(), update });
    }, { source: followSource(sessionId) });
    followers.set(sender.id, feed);
    return { ok: true as const };
  });
  on('follow:stop', (event) => stop(event.sender.id));
}
