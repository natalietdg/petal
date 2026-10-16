// The petal-img:// address for a picture a reply names. main/reply-image.ts resolves and checks it; the renderer only builds it.
export const REPLY_IMAGE_SCHEME = 'petal-img';
export const REPLY_IMAGE_HOST = 'local';

// path: as Claude wrote it (absolute, ~/ or relative); cwd: the session's folder, for a relative path only.
export function replyImageUrl(path: string, cwd: string | null): string {
  const query = new URLSearchParams({ path });
  if (cwd) query.set('cwd', cwd);
  return `${REPLY_IMAGE_SCHEME}://${REPLY_IMAGE_HOST}/?${query.toString()}`;
}

// What main says about a picture it would not serve, so the reader can say why in a chip.
export type ReplyImageStatus = { status: 'ok' } | { status: 'missing' } | { status: 'refused'; reason: 'claude-folder' | 'not-allowed' };
