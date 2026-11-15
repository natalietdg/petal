// Launch self-check: does this Claude Code still write what the reader parses? One plain sentence naming the version, or null.
// Claude Code's on-disk formats are undocumented and have broken the reader before (2.1.293, 2.1.295), so a blank reader gets a reason.
import fs from 'node:fs';
import path from 'node:path';
import { compareVersions } from './claude-fallback';
import { formatChangedNotice, newerClaudeNotice } from '../shared/reader-notice';

// The newest Claude Code the reader was checked against (test/claude-code-compat.test.ts and a live session).
export const CHECKED_THROUGH = '2.1.325';

const TAIL_BYTES = 64 * 1024;
const MIN_ENTRIES = 20; // a shorter log can't tell a format change from a session that barely started
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const minorLine = (version: string): string => version.split('.').slice(0, 2).join('.');

// Patch releases ship most days and rarely change the formats; a new major.minor line is the risk worth naming.
export function isUncheckedVersion(version: string | null, checked = CHECKED_THROUGH): boolean {
  if (!version) return false;
  return compareVersions(`${minorLine(version)}.0`, `${minorLine(checked)}.0`) > 0;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// What's wrong with a session file's shape, in a few words, or null when the reader can use it.
export function sessionFileProblem(text: string): string | null {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return 'a session file isn’t JSON'; }
  if (!isObject(data)) return 'a session file isn’t an object';
  if (typeof data.sessionId !== 'string' || !UUID.test(data.sessionId)) return 'a session file has no sessionId';
  if (typeof data.cwd !== 'string') return 'a session file has no cwd';
  return null;
}

// What's wrong with a transcript's lines, or null. Unknown entry types are fine: the reader skips them.
export function transcriptProblem(lines: readonly string[]): string | null {
  const parsed: unknown[] = [];
  let broken = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try { parsed.push(JSON.parse(line)); } catch { broken++; }
  }
  const total = parsed.length + broken;
  if (total < MIN_ENTRIES) return null;
  if (broken > total / 10) return 'its transcript lines aren’t JSON';
  const typed = parsed.filter((entry) => isObject(entry) && typeof entry.type === 'string') as Record<string, unknown>[];
  if (typed.length < parsed.length * 0.9) return 'its transcript lines have no type';
  const turns = typed.filter((entry) => entry.type === 'user' || entry.type === 'assistant');
  if (!turns.length) return 'its transcript has no user or assistant lines';
  const readable = turns.filter((entry) => isObject(entry.message) && (typeof entry.message.content === 'string' || Array.isArray(entry.message.content)));
  if (readable.length < turns.length * 0.9) return 'its replies have a new shape';
  return null;
}

function newestFile(dir: string, ext: string, depth = 1): string | null {
  let best: { file: string; at: number } | null = null;
  const visit = (current: string, level: number): void => {
    let names: fs.Dirent[];
    try { names = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of names) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && level < depth) visit(full, level + 1);
      else if (entry.isFile() && entry.name.endsWith(ext)) {
        const at = fs.statSync(full, { throwIfNoEntry: false })?.mtimeMs ?? 0;
        if (!best || at > best.at) best = { file: full, at };
      }
    }
  };
  visit(dir, 1);
  return (best as { file: string } | null)?.file ?? null;
}

function tailLines(file: string): string[] {
  const { size } = fs.statSync(file);
  const fd = fs.openSync(file, 'r');
  try {
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    if (length < size) lines.shift(); // cut mid-line
    lines.pop(); // the last line may still be being written
    return lines;
  } finally {
    fs.closeSync(fd);
  }
}

// The newest session file and transcript under the allowed Claude folder, checked against what the reader parses.
export function formatProblemIn(home: string): string | null {
  const session = newestFile(path.join(home, 'sessions'), '.json');
  const sessionIssue = session ? sessionFileProblem(fs.readFileSync(session, 'utf8')) : null;
  if (sessionIssue) return sessionIssue;
  const transcript = newestFile(path.join(home, 'projects'), '.jsonl', 2);
  return transcript ? transcriptProblem(tailLines(transcript)) : null;
}

// home: the allowed Claude folder, or null while reading it is off. version: `claude --version`, or null if unknown.
export function formatNotice(home: string | null, version: string | null): string | null {
  if (!home) return null;
  let problem: string | null;
  try { problem = formatProblemIn(home); } catch { problem = null; } // a file vanishing mid-check is not a format change
  if (problem) return formatChangedNotice(version, problem);
  return isUncheckedVersion(version) ? newerClaudeNotice(version as string, CHECKED_THROUGH) : null;
}
