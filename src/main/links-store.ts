// Handoff log: which session was sent to, resumed or forked from which, kept in <userData>/links.json.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type LinkKind = 'send' | 'resume' | 'fork';

export interface Link {
  from: string | null;
  to: string | null;
  kind: LinkKind;
  at: string;
}

export const KINDS: ReadonlySet<string> = new Set<LinkKind>(['send', 'resume', 'fork']);
const MAX_LINKS = 1000; // oldest drop off; the view only reads the last week
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const storeFile = () => path.join(app.getPath('userData'), 'links.json');
const idOrNull = (id: string | null | undefined): string | null => (id && SESSION_ID.test(id) ? id : null); // null = a fresh tab with no session yet
const isLink = (l: unknown): l is Link =>
  typeof l === 'object' && l !== null && 'kind' in l && typeof l.kind === 'string' && KINDS.has(l.kind);

export function load(): Link[] {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    return Array.isArray(data) ? data.filter(isLink) : [];
  } catch {
    return [];
  }
}

function save(links: Link[]): void {
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(links, null, 1));
  fs.renameSync(tmp, file); // atomic swap: the view never reads a half-written file
}

// Never throws: a failed log write must not break the send or resume it records.
export function addLink({ from, to, kind }: { from: string | null; to: string | null; kind: LinkKind }): Link | null {
  if (!KINDS.has(kind) || (!idOrNull(to) && !idOrNull(from))) return null;
  const link: Link = { from: idOrNull(from), to: idOrNull(to), kind, at: new Date().toISOString() };
  try {
    save([...load(), link].slice(-MAX_LINKS));
  } catch (error) {
    console.error('[petal] links log skipped:', (error as Error).message);
    return null;
  }
  return link;
}
