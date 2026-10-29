// The markdown Petal leaves in ~/.petal/resume/ when it quits: one note per open tab and an index. Pure, no IO.
import { buildResumeCommand, resumeArgs } from './resume-command';
import { parseStatus, STATUS_KEYS, STATUS_TITLES } from '../shared/status-lines';
import { replyHeadline } from '../shared/sessions-board';
import { confirmedItems } from '../shared/confirmed';

export const PROMPT_CHARS = 600;
export const REPLY_TAIL_CHARS = 800;
export const STATUS_LINES_MAX = 30;
const TITLE_CHARS = 60;

// One tab as it was at quit, read from its reader feed.
export interface ResumeSession {
  title: string;
  sessionId: string | null; // null: a plain shell, nothing to resume
  cwd: string | null;
  running: boolean; // Claude was mid-reply or waiting on a prompt
  agent: boolean; // a Testing agent's terminal
  lastActive: string | null; // ISO time of the newest prompt or reply
  lastPrompt: string;
  lastReply: string; // markdown of Claude's newest reply, '' when none yet
  waiting: string[]; // her prompts sent after that reply, oldest first
}

// What git said about the session's folder; any part can be missing.
export interface ResumeGit {
  branch: string | null;
  status: string | null; // `git status --short`, '' when clean
  notes: string[]; // one line per lookup that was skipped
}

export const NO_GIT: ResumeGit = { branch: null, status: null, notes: [] };

const pad = (n: number): string => String(n).padStart(2, '0');

// "2026-10-29_14-05", local time: the folder each quit writes into.
export const folderStamp = (at: Date): string =>
  `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}_${pad(at.getHours())}-${pad(at.getMinutes())}`;

// "2026-10-29 14:05", local time; '' for a missing or unreadable time.
export function localTime(iso: string | Date | null): string {
  const at = iso instanceof Date ? iso : iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime())) return '';
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

// "<title>-<first 8 of id>.md", lower case letters, digits and dashes only.
export function noteFileName(title: string, sessionId: string): string {
  const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, TITLE_CHARS).replace(/-+$/, '') || 'session';
  const safeId = sessionId.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'unknown';
  return `${safeTitle}-${safeId}.md`;
}

// The first `max` characters, cut at a space when one is near, with an ellipsis.
export function trimStart(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.8 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// The last `max` characters, starting at a line or space when one is near, with an ellipsis.
export function trimEnd(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(-max);
  const breakAt = Math.max(cut.indexOf('\n'), cut.indexOf(' '));
  return `…${(breakAt >= 0 && breakAt < max * 0.2 ? cut.slice(breakAt + 1) : cut).trimStart()}`;
}

// `git status --short`, at most STATUS_LINES_MAX lines, with a count of the rest.
export function trimStatus(status: string): string {
  const lines = status.split('\n').filter((line) => line.trim());
  if (lines.length <= STATUS_LINES_MAX) return lines.join('\n');
  return [...lines.slice(0, STATUS_LINES_MAX), `… ${lines.length - STATUS_LINES_MAX} more`].join('\n');
}

// The line she pastes in a terminal; the same quoting as the resume Petal types, without the Enter.
export function resumeLine(cwd: string | null, sessionId: string): string {
  return cwd ? buildResumeCommand(cwd, sessionId).replace(/\r$/, '') : `claude ${resumeArgs(sessionId)}`;
}

// The newest reply's Decide line, while no prompt of hers has answered it.
export function openDecide(lastReply: string, waiting: readonly string[]): string | null {
  if (!lastReply) return null;
  const groups = confirmedItems([{ id: undefined, markdown: lastReply, prompt: '' }], waiting);
  return groups.progress.find((item) => item.pill === 'Waiting on you')?.text ?? null;
}

const quote = (text: string): string => text.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');

// Her last prompt, then the reply's headline, status lines and open decision; or the reply's tail when it has none.
export function whereItStopped({ lastPrompt, lastReply, waiting }: Pick<ResumeSession, 'lastPrompt' | 'lastReply' | 'waiting'>): string {
  const parts: string[] = [];
  if (lastPrompt.trim()) parts.push('Last prompt:', '', quote(trimStart(lastPrompt, PROMPT_CHARS)));
  if (waiting.length) parts.push('', 'Claude had not answered it yet.');
  if (!lastReply.trim()) return parts.length ? parts.join('\n') : 'No prompts yet.';

  const headline = replyHeadline(lastReply);
  const status = parseStatus(lastReply);
  const decide = openDecide(lastReply, waiting);
  const lines = [
    ...STATUS_KEYS.flatMap((key) => (status[key] ? [`- **${STATUS_TITLES[key]}:** ${status[key]}`] : [])),
    ...(decide ? [`- **Decide:** ${decide}`] : []),
  ];
  if (parts.length) parts.push('');
  if (!STATUS_KEYS.some((key) => status[key])) {
    parts.push('End of the last reply:', '', quote(trimEnd(lastReply, REPLY_TAIL_CHARS)));
    if (decide) parts.push('', `- **Decide:** ${decide}`);
    return parts.join('\n');
  }
  parts.push(headline ? `Last reply: **${headline}**` : 'Last reply:', '', ...lines);
  return parts.join('\n');
}

// One session's note; git's notes say what was left out because it took too long.
export function buildResumeNote(session: ResumeSession & { sessionId: string }, git: ResumeGit = NO_GIT): string {
  const head = [
    `# ${session.title}`,
    '',
    `- Folder: ${session.cwd ?? 'unknown'}`,
    ...(git.branch ? [`- Branch: ${git.branch}`] : []),
    `- State: ${session.running ? 'Running, Claude was mid-reply' : 'Idle'}`,
    ...(session.lastActive && localTime(session.lastActive) ? [`- Last active: ${localTime(session.lastActive)}`] : []),
  ];
  const resume = ['## Resume', '', '```bash', resumeLine(session.cwd, session.sessionId), '```'];
  const stopped = ['## Where it stopped', '', whereItStopped(session)];
  const status = git.status ? trimStatus(git.status) : '';
  const uncommitted = status ? ['## Uncommitted', '', '```', status, '```'] : [];
  const notes = git.notes.length ? git.notes.map((note) => `_${note}_`) : [];
  return [head, resume, stopped, uncommitted, notes].filter((block) => block.length).map((block) => block.join('\n')).join('\n\n') + '\n';
}

export interface IndexEntry {
  session: ResumeSession;
  file: string | null; // the note's file name, null for a shell
}

// Every tab at quit: sessions link to their note, shells are listed as nothing to resume.
export function buildIndex(entries: readonly IndexEntry[], at: Date): string {
  const rows = entries.map(({ session, file }) => {
    if (!session.sessionId || !file) return `- ${session.title}: shell, nothing to resume`;
    const state = session.running ? 'Running' : 'Idle';
    return `- [${session.title.replace(/[[\]]/g, '')}](${file}) · ${state}${session.agent ? ' · agent' : ''} · ${session.cwd ?? 'unknown folder'}`;
  });
  return [`# Open in Petal at ${localTime(at)}`, '', ...(rows.length ? rows : ['No tabs were open.'])].join('\n') + '\n';
}
