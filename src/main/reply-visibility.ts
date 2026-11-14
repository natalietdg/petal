// Launch check: can Petal see Claude's replies? Returns one plain sentence on what blocks it, or null when nothing does.
// The reader finds a tab's replies through ~/.claude/sessions/<pid>.json, then the log under ~/.claude/projects.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const errorCode = (error: unknown): string => (error as NodeJS.ErrnoException)?.code ?? 'unknown error';
const shortPath = (full: string): string => (full.startsWith(os.homedir()) ? `~${full.slice(os.homedir().length)}` : full);

function listOrError(dir: string): { names: string[] } | { code: string } {
  try {
    return { names: fs.readdirSync(dir) };
  } catch (error) {
    return { code: errorCode(error) };
  }
}

// home: the allowed Claude folder, or null while reading it is off (the reader already says so then).
export function replyVisibilityProblem(home: string | null): string | null {
  if (!home) return null;
  const projects = path.join(home, 'projects');
  const sessions = path.join(home, 'sessions');

  const logs = listOrError(projects);
  if ('code' in logs && logs.code === 'ENOENT') return null; // Claude Code hasn't run here yet: nothing to see, nothing wrong
  if ('code' in logs) return `Petal can’t see replies: it can’t open ${shortPath(projects)} (${logs.code}), where Claude Code saves them. Check that folder’s permissions.`;

  const files = listOrError(sessions);
  if ('code' in files && files.code === 'ENOENT') {
    return `Petal can’t tell which reply belongs to which tab: ${shortPath(sessions)} is missing. Claude Code writes it from version 2.1.75, so run claude update. Until then Petal guesses by folder.`;
  }
  if ('code' in files) return `Petal can’t tell which reply belongs to which tab: it can’t open ${shortPath(sessions)} (${files.code}). Check that folder’s permissions.`;

  for (const name of files.names.filter((n) => n.endsWith('.json'))) {
    const file = path.join(sessions, name);
    try {
      fs.accessSync(file, fs.constants.R_OK);
    } catch (error) {
      const code = errorCode(error);
      if (code === 'ENOENT') continue; // the session ended between the list and the check
      return `Petal can’t see that tab’s replies: it can’t read ${shortPath(file)} (${code}). Check that file’s permissions.`;
    }
  }
  return null;
}
