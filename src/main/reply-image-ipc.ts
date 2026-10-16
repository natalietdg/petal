// Reply pictures in the reader: the petal-img:// protocol, plus Show in Finder and Open. Every door goes through reply-image.ts.
import os from 'node:os';
import { protocol, shell } from 'electron';
import { handle } from './ipc';
import { claudeFolderAllowed, claudeHome } from './claude-folder';
import { checkReplyImage, handleReplyImageRequest, MAX_REPLY_IMAGE_BYTES, replyImageStatus, type ReplyImagePlaces } from './reply-image';
import { REPLY_IMAGE_SCHEME } from '../shared/reply-image-url';
import type { TabSessions } from './tab-session';

// Before app ready: a standard scheme parses ?path=&cwd= like https; secure, so the page never treats it as mixed content.
export function registerReplyImageScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: REPLY_IMAGE_SCHEME, privileges: { standard: true, secure: true } }]);
}

export function registerReplyImages({ sessions }: { sessions: TabSessions }): void {
  // Read fresh per request: tabs open and close, and her folder choice can change.
  const places = (): ReplyImagePlaces => ({
    home: os.homedir(),
    cwds: [...sessions.values()].flatMap((s) => (s.feed.session?.cwd ? [s.feed.session.cwd] : [])),
    claudeHome: claudeHome(),
    claudeAllowed: claudeFolderAllowed(),
    maxBytes: MAX_REPLY_IMAGE_BYTES,
  });

  protocol.handle(REPLY_IMAGE_SCHEME, (request) => handleReplyImageRequest(request.url, places()));

  handle('reply-image:status', (_event, { path, cwd }) => replyImageStatus(path, cwd, places()));
  handle('reply-image:reveal', async (_event, { path, cwd }) => {
    const checked = await checkReplyImage(path, cwd, places());
    if (checked.status === 'ok') shell.showItemInFolder(checked.file);
    return { ok: checked.status === 'ok' };
  });
  handle('reply-image:open', async (_event, { path, cwd }) => {
    const checked = await checkReplyImage(path, cwd, places());
    if (checked.status !== 'ok') return { ok: false };
    return { ok: (await shell.openPath(checked.file)) === '' }; // '' means it opened
  });
}
