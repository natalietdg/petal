// The one door reply pictures have to the disk: petal-img://local/?path=…&cwd=…, served only after every check here.
// No electron import, so test/reply-image.test.ts drives it directly.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMAGE_EXTENSION } from '../shared/image-paths';
import { REPLY_IMAGE_HOST, REPLY_IMAGE_SCHEME, type ReplyImageStatus } from '../shared/reply-image-url';
import { sniffImage } from './paste-image';

export const MAX_REPLY_IMAGE_BYTES = 20 * 1024 * 1024;
const SNIFF_BYTES = 16;
const CACHE_SECONDS = 60; // the reader redraws on every streamed line; a short cache keeps thumbnails from reloading

// cwds: the open tabs' session folders; a relative path resolves against the cwd the URL names, but is only served from these or home.
export interface ReplyImagePlaces {
  home: string;
  cwds: readonly string[];
  claudeHome: string;
  claudeAllowed: boolean;
  maxBytes: number;
}

// A session folder never opens these, even when a claude was started in one.
const SYSTEM_ROOTS = ['/System', '/Library', '/usr', '/bin', '/sbin', '/etc', '/private/etc', '/private/var/db', '/private/var/root', '/dev', '/cores', '/opt', '/Applications'];

type Checked = { status: 'ok'; file: string; mime: string; bytes?: Buffer } | Exclude<ReplyImageStatus, { status: 'ok' }>;

const REFUSED: Checked = { status: 'refused', reason: 'not-allowed' };
const CLAUDE_FOLDER: Checked = { status: 'refused', reason: 'claude-folder' };
const MISSING: Checked = { status: 'missing' };

const isInside = (child: string, parent: string): boolean => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};
const isStrictlyInside = (child: string, parent: string): boolean => child !== parent && isInside(child, parent);
const realOrNull = (file: string): Promise<string | null> => fs.realpath(file).catch(() => null);

// Claude's text as an absolute path, or null: no remote URLs, no schemes but file:, no relative path without a cwd.
export function resolveReplyImagePath(raw: string, cwd: string | null, home: string): string | null {
  if (!raw || raw.includes('\0')) return null;
  let file = raw;
  if (/^file:/i.test(file)) {
    try { file = fileURLToPath(file); } catch { return null; }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(file)) return null; // https:, data:, javascript:, …
  if (file === '~' || file.startsWith('~/')) file = path.join(home, file.slice(1));
  if (!path.isAbsolute(file)) {
    if (!cwd || !path.isAbsolute(cwd)) return null;
    file = path.join(cwd, file);
  }
  return path.resolve(file);
}

async function allowedRoots(places: ReplyImagePlaces): Promise<{ home: string | null; cwds: string[] }> {
  const home = await realOrNull(places.home);
  const cwds = (await Promise.all(places.cwds.filter((cwd) => path.isAbsolute(cwd)).map(realOrNull)))
    .filter((cwd): cwd is string => cwd !== null && cwd !== path.parse(cwd).root);
  return { home, cwds };
}

// The same roots as written, for a file that doesn't exist and so has no real path to compare.
const lexicalRoots = (places: ReplyImagePlaces): { home: string; cwds: string[] } => ({
  home: path.resolve(places.home),
  cwds: places.cwds.filter((cwd) => path.isAbsolute(cwd)).map((cwd) => path.resolve(cwd)).filter((cwd) => cwd !== path.parse(cwd).root),
});

const isAllowedPlace = (file: string, roots: { home: string | null; cwds: string[] }): boolean =>
  (roots.home !== null && isStrictlyInside(file, roots.home))
  || (roots.cwds.some((cwd) => isStrictlyInside(file, cwd)) && !SYSTEM_ROOTS.some((root) => isInside(file, root)));

async function inClaudeFolder(lexical: string, real: string | null, claudeHome: string): Promise<boolean> {
  const realClaude = await realOrNull(claudeHome);
  return isInside(lexical, claudeHome) || (real !== null && realClaude !== null && isInside(real, realClaude));
}

// Every check, in order; read: also load the bytes (the protocol), otherwise only the first few (Show in Finder, Open, a chip).
export async function checkReplyImage(raw: unknown, cwd: unknown, places: ReplyImagePlaces, { read = false } = {}): Promise<Checked> {
  if (typeof raw !== 'string' || (cwd !== null && cwd !== undefined && typeof cwd !== 'string')) return REFUSED;
  const lexical = resolveReplyImagePath(raw, cwd ?? null, places.home);
  if (!lexical || !IMAGE_EXTENSION.test(lexical)) return REFUSED;

  const roots = await allowedRoots(places);
  const real = await realOrNull(lexical);
  if (!places.claudeAllowed && await inClaudeFolder(lexical, real, places.claudeHome)) return CLAUDE_FOLDER;
  // Only say "not found" for a place it was allowed to be; anywhere else is simply refused.
  if (!real) return isAllowedPlace(lexical, lexicalRoots(places)) || isAllowedPlace(lexical, roots) ? MISSING : REFUSED;
  if (!IMAGE_EXTENSION.test(real) || !isAllowedPlace(real, roots)) return REFUSED;

  const handle = await fs.open(real, 'r').catch(() => null);
  if (!handle) return MISSING;
  try {
    const stat = await handle.stat(); // of the opened file, so a swap after the checks above changes nothing
    if (!stat.isFile() || stat.size === 0 || stat.size > places.maxBytes) return REFUSED;
    const length = read ? stat.size : Math.min(SNIFF_BYTES, stat.size);
    const bytes = Buffer.alloc(length);
    const { bytesRead } = await handle.read(bytes, 0, length, 0);
    const mime = sniffImage(bytes.subarray(0, bytesRead));
    if (!mime || bytesRead !== length) return REFUSED;
    return read ? { status: 'ok', file: real, mime, bytes } : { status: 'ok', file: real, mime };
  } finally {
    await handle.close();
  }
}

// The status a chip or button needs; never the bytes.
export async function replyImageStatus(raw: unknown, cwd: unknown, places: ReplyImagePlaces): Promise<ReplyImageStatus> {
  const checked = await checkReplyImage(raw, cwd, places);
  return checked.status === 'ok' ? { status: 'ok' } : checked;
}

const plain = (status: number): Response => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

// protocol.handle's answer: 200 with the bytes, 404 for a missing file where one may be, 403 for everything else.
export async function handleReplyImageRequest(url: string, places: ReplyImagePlaces): Promise<Response> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return plain(403); }
  if (parsed.protocol !== `${REPLY_IMAGE_SCHEME}:` || parsed.hostname !== REPLY_IMAGE_HOST || parsed.pathname !== '/') return plain(403);
  const checked = await checkReplyImage(parsed.searchParams.get('path'), parsed.searchParams.get('cwd'), places, { read: true });
  if (checked.status === 'missing') return plain(404);
  if (checked.status !== 'ok' || !checked.bytes) return plain(403);
  return new Response(new Uint8Array(checked.bytes), {
    status: 200,
    headers: { 'Content-Type': checked.mime, 'Content-Length': String(checked.bytes.length), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': `private, max-age=${CACHE_SECONDS}` },
  });
}
