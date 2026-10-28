// Image paths inside her message (pasted, dropped or typed), so the bubble can show the picture instead of the path.

export interface ImageRef {
  path: string; // as written, unquoted; may start with ~/
  start: number;
  end: number;
}

export type PromptPart = { kind: 'text'; text: string } | { kind: 'image'; path: string; raw: string };

export const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp)$/i;

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// A relative path in prose needs a folder in it ("docs/shot.png"), so a bare "logo.png" stays words.
const RELATIVE_IN_TEXT = /(?<=^|[\s(])(?:\.{1,2}\/)?[\w@+-][\w@.+-]*(?:\/[\w@.+-]+)+\.(?:png|jpe?g|gif|webp)(?=$|[\s),.;:!?])/gi;

// A reply image's src that Petal may load: a path or file:, never a web or other scheme.
export const isLocalImageSrc = (src: string): boolean => Boolean(src) && (!SCHEME.test(src) || /^file:/i.test(src));

// Inline code in a reply that is a whole image path: absolute, ~/, relative or file:.
export function imageCodePath(text: string): string | null {
  const path = text.trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!path || /\n/.test(path) || !IMAGE_EXTENSION.test(path)) return null;
  return isLocalImageSrc(path) ? path : null;
}

// Image paths in a reply's prose, in order: absolute and ~/ the way her bubbles read them, plus relative ones with a folder.
export function imageTextPaths(text: string): string[] {
  const found = findImageRefs(text).map((ref) => ({ at: ref.start, path: ref.path }));
  RELATIVE_IN_TEXT.lastIndex = 0;
  for (let match = RELATIVE_IN_TEXT.exec(text); match; match = RELATIVE_IN_TEXT.exec(text)) found.push({ at: match.index, path: match[0] });
  return found.sort((a, b) => a.at - b.at).map((f) => f.path);
}

// One shell word or Claude Code's own "[Image: source: …]" note; a word starts after whitespace or "(".
const TOKEN = new RegExp([
  String.raw`\[Image: source: (?<source>[^\]\n]+)\]`,
  String.raw`(?<=^|[\s(])'(?<single>[/~](?:'\\''|[^'\n])*)'`,
  String.raw`(?<=^|[\s(])"(?<double>[/~][^"\n]*)"`,
  String.raw`(?<=^|[\s(])(?<bare>[/~](?:\\[^\n]|[^\s'"\\])+)`,
].join('|'), 'g');
const PLACEHOLDER = /\[Image #(\d+)\]/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

const isImagePath = (path: string): boolean => (path.startsWith('/') || path.startsWith('~/')) && IMAGE_EXTENSION.test(path);

// The token's path and how much of it is the path; a bare word may end in punctuation that isn't part of it.
function pathOf(groups: Record<string, string | undefined>, raw: string): { path: string; length: number } | null {
  const { source, single, double, bare } = groups;
  const quoted = source?.trim() ?? single?.replace(/'\\''/g, "'") ?? double;
  if (quoted !== undefined) return isImagePath(quoted) ? { path: quoted, length: raw.length } : null;
  if (bare === undefined) return null;
  const word = isImagePath(bare.replace(/\\(.)/g, '$1')) ? bare : bare.replace(TRAILING_PUNCTUATION, '');
  const path = word.replace(/\\(.)/g, '$1');
  return isImagePath(path) ? { path, length: word.length } : null;
}

export function findImageRefs(text: string): ImageRef[] {
  const refs: ImageRef[] = [];
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(text); match; match = TOKEN.exec(text)) {
    const found = pathOf(match.groups ?? {}, match[0]);
    if (found) refs.push({ path: found.path, start: match.index, end: match.index + found.length });
  }
  return refs;
}

// Claude Code logs her turn with "[Image #id]" only and each pasted image's path in a meta entry after it.
// Each path goes back as a "[Image: source: …]" note where its placeholder was; ids default to the placeholders in order.
export function placeImageSources(prompt: string, sources: readonly string[], ids: readonly number[] = []): string {
  const order = ids.length ? ids : [...prompt.matchAll(PLACEHOLDER)].map((match) => Number(match[1]));
  const unplaced: string[] = [];
  let text = prompt;
  sources.forEach((source, i) => {
    const note = `[Image: source: ${source}]`;
    const placeholder = order[i] === undefined ? '' : `[Image #${order[i]}]`;
    if (placeholder && text.includes(placeholder)) text = text.replace(placeholder, () => note);
    else unplaced.push(note);
  });
  return [text, ...unplaced].filter(Boolean).join('\n');
}

// Text and images in reading order; "[Image #n]" takes the nth path's picture and that path leaves the text.
export function splitPromptImages(text: string): PromptPart[] {
  const refs = findImageRefs(text);
  if (!refs.length) return [{ kind: 'text', text }];
  const placed = new Set<ImageRef>();
  const marks: { start: number; end: number; part: PromptPart | null }[] = [];
  PLACEHOLDER.lastIndex = 0;
  for (let match = PLACEHOLDER.exec(text); match; match = PLACEHOLDER.exec(text)) {
    const ref = refs[Number(match[1]) - 1];
    if (!ref || placed.has(ref) || match.index < ref.end && ref.start < match.index + match[0].length) continue;
    placed.add(ref);
    const raw = `${match[0]} ${text.slice(ref.start, ref.end)}`;
    marks.push({ start: match.index, end: match.index + match[0].length, part: { kind: 'image', path: ref.path, raw } });
  }
  for (const ref of refs) {
    const raw = text.slice(ref.start, ref.end);
    marks.push({ start: ref.start, end: ref.end, part: placed.has(ref) ? null : { kind: 'image', path: ref.path, raw } });
  }
  marks.sort((a, b) => a.start - b.start);

  const parts: PromptPart[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start < cursor) continue; // a placeholder inside a "[Image: source: …]" note
    parts.push({ kind: 'text', text: text.slice(cursor, mark.start) });
    if (mark.part) parts.push(mark.part);
    cursor = mark.end;
  }
  parts.push({ kind: 'text', text: text.slice(cursor) });
  return tidy(parts);
}

// Images sit on their own line, so the spaces and line breaks around them (and at either end) go; empty text goes too.
function tidy(parts: PromptPart[]): PromptPart[] {
  const isImage = (part: PromptPart | undefined) => part?.kind === 'image';
  const merged: PromptPart[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (part.kind === 'text' && last?.kind === 'text') last.text += part.text;
    else merged.push({ ...part });
  }
  return merged.flatMap<PromptPart>((part, i) => {
    if (part.kind === 'image') return [part];
    let text = part.text;
    if (i === 0 || isImage(merged[i - 1])) text = text.replace(/^\s+/, '');
    if (i === merged.length - 1 || isImage(merged[i + 1])) text = text.replace(/\s+$/, '');
    return text ? [{ kind: 'text', text }] : [];
  });
}
