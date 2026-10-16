// File clashes: two live sessions in the same repo that both edited one file in the last few minutes.
// Pure; main/coord.ts feeds it the edits it reads from each session's log.

export const CLASH_WINDOW_MS = 15 * 60_000;
export const EDIT_TOOLS: readonly string[] = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

export interface FileEdit {
  file: string; // absolute, as the tool call named it
  at: number;
}

export interface SessionEdits {
  sessionId: string;
  name: string;
  root: string | null; // git toplevel; sessions outside git never clash
  edits: readonly FileEdit[];
}

export interface Clash {
  file: string; // relative to the repo
  otherSessionId: string;
  otherName: string;
  at: number; // the newer of the two edits
}

const trimSlash = (dir: string): string => dir.replace(/\/+$/, '');

// The path inside root, or null for a file elsewhere.
export function insideRoot(file: string, root: string): string | null {
  const base = `${trimSlash(root)}/`;
  return file.startsWith(base) && file.length > base.length ? file.slice(base.length) : null;
}

// Newest edit per repo-relative file, within the window.
function recentFiles(session: SessionEdits, now: number, windowMs: number): Map<string, number> {
  const files = new Map<string, number>();
  if (!session.root) return files;
  for (const edit of session.edits) {
    const rel = edit.at >= now - windowMs ? insideRoot(edit.file, session.root) : null;
    if (rel) files.set(rel, Math.max(files.get(rel) ?? 0, edit.at));
  }
  return files;
}

// Per session, every file it shares with another session in its repo; the newest clash first.
export function findClashes(sessions: readonly SessionEdits[], now: number, windowMs = CLASH_WINDOW_MS): Map<string, Clash[]> {
  const recent = sessions.map((s) => ({ session: s, files: recentFiles(s, now, windowMs) }));
  const out = new Map<string, Clash[]>();
  for (const a of recent) {
    const clashes: Clash[] = [];
    for (const b of recent) {
      if (a.session.sessionId === b.session.sessionId || !a.session.root || trimSlash(a.session.root) !== trimSlash(b.session.root ?? '')) continue;
      for (const [file, at] of a.files) {
        const other = b.files.get(file);
        if (other !== undefined) clashes.push({ file, otherSessionId: b.session.sessionId, otherName: b.session.name, at: Math.max(at, other) });
      }
    }
    if (clashes.length) out.set(a.session.sessionId, clashes.sort((x, y) => y.at - x.at || x.file.localeCompare(y.file)));
  }
  return out;
}

// The reader strip's line for one clash.
export const clashNotice = (clash: Pick<Clash, 'file' | 'otherName'>): string => `Also being edited in ${clash.otherName}: ${clash.file}`;

// What the heads-up button sends the other session.
export const headsUpText = (from: string, file: string): string =>
  `Heads-up from Petal: ${from} is also editing ${file} right now. Check with it before you change that file further.`;
