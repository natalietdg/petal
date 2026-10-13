// The one door the bubbles have to image files: Petal's own pastes, or a picture her message names under home or temp.
import fs from 'node:fs/promises';
import path from 'node:path';
import { IMAGE_EXTENSION, findImageRefs } from '../shared/image-paths';

export interface ImagePlaces {
  pasteDir: string;
  home: string;
  temp: string;
  maxBytes: number;
}

export type PromptImage = { status: 'ok'; dataUrl: string } | { status: 'missing' } | { status: 'refused' };

const REFUSED: PromptImage = { status: 'refused' };
const MISSING: PromptImage = { status: 'missing' };

// The type comes from the bytes, never the name.
const SIGNATURES: { mime: string; matches: (head: Buffer) => boolean }[] = [
  { mime: 'image/png', matches: (h) => h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', matches: (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff },
  { mime: 'image/gif', matches: (h) => /^GIF8[79]a$/.test(h.subarray(0, 6).toString('latin1')) },
  { mime: 'image/webp', matches: (h) => h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WEBP' },
];

export const sniffImage = (head: Buffer): string | null => SIGNATURES.find((s) => s.matches(head))?.mime ?? null;

const isInside = (child: string, parent: string): boolean => {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const realOrNull = (file: string): Promise<string | null> => fs.realpath(file).catch(() => null);

export async function readPromptImage(file: unknown, prompt: unknown, places: ImagePlaces): Promise<PromptImage> {
  if (typeof file !== 'string' || typeof prompt !== 'string') return REFUSED;
  const expanded = file.startsWith('~/') ? path.join(places.home, file.slice(2)) : file;
  if (!path.isAbsolute(expanded) || !IMAGE_EXTENSION.test(expanded)) return REFUSED;
  const lexical = path.resolve(expanded);
  const named = findImageRefs(prompt).some((ref) => ref.path === file);
  const roots = named ? [places.pasteDir, places.home, places.temp] : [places.pasteDir];

  const real = await realOrNull(lexical);
  // Only say "gone" for a place it was allowed to be; anywhere else is simply refused.
  if (!real) return roots.some((root) => isInside(lexical, root)) ? MISSING : REFUSED;
  const realRoots = (await Promise.all(roots.map(realOrNull))).filter((root): root is string => root !== null);
  if (!realRoots.some((root) => isInside(real, root)) || !IMAGE_EXTENSION.test(real)) return REFUSED;

  const handle = await fs.open(real, 'r').catch(() => null);
  if (!handle) return MISSING;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size > places.maxBytes) return REFUSED;
    const bytes = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(bytes, 0, stat.size, 0);
    const mime = sniffImage(bytes.subarray(0, bytesRead));
    if (!mime || bytesRead !== stat.size) return REFUSED;
    return { status: 'ok', dataUrl: `data:${mime};base64,${bytes.toString('base64')}` };
  } finally {
    await handle.close();
  }
}
