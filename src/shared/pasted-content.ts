// Claude Code logs a long paste as <pasted_content id="…">…</pasted_content id="…">; split it from what she typed.

export interface PromptSegment {
  kind: 'typed' | 'pasted';
  text: string;
}

const ATTRS = String.raw`(?:"[^"]*"|'[^']*'|[^>"'])*`; // quoted values may hold ">"
const OPENER = new RegExp(String.raw`<pasted_content\b(${ATTRS})>`, 'g');
const ANY_CLOSER = new RegExp(String.raw`</pasted_content\b${ATTRS}>`, 'g');
const ID = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The closer for this block: its own id first, so a pasted copy of the wrapper stays inside.
function findCloser(text: string, from: number, id: string | null): { start: number; end: number } | null {
  const own = id === null ? null : new RegExp(String.raw`</pasted_content\s+id\s*=\s*["']?${escapeRegExp(id)}["']?\s*>`, 'g');
  for (const pattern of own ? [own, ANY_CLOSER] : [ANY_CLOSER]) {
    pattern.lastIndex = from;
    const match = pattern.exec(text);
    if (match) return { start: match.index, end: match.index + match[0].length };
  }
  return null;
}

const trimBlankLines = (text: string): string => text.replace(/^\s*\n/, '').replace(/\n\s*$/, '');

export function parsePasted(text: string): PromptSegment[] {
  const segments: PromptSegment[] = [];
  const push = (kind: PromptSegment['kind'], raw: string) => {
    const body = kind === 'typed' ? raw.trim() : trimBlankLines(raw);
    if (body.trim()) segments.push({ kind, text: body });
  };
  let cursor = 0;
  OPENER.lastIndex = 0;
  for (let open = OPENER.exec(text); open; open = OPENER.exec(text)) {
    push('typed', text.slice(cursor, open.index));
    const id = ID.exec(open[1]);
    const innerStart = open.index + open[0].length;
    const closer = findCloser(text, innerStart, id ? (id[1] ?? id[2] ?? id[3]) : null);
    push('pasted', text.slice(innerStart, closer?.start ?? text.length)); // unclosed: the rest is the paste
    cursor = closer?.end ?? text.length;
    OPENER.lastIndex = cursor;
  }
  push('typed', text.slice(cursor));
  return segments;
}

// Plain text for titles, previews and search: the wrapper tags gone, the pasted words kept.
export const stripPasted = (text: string): string => parsePasted(text).map((s) => s.text).join('\n\n');
