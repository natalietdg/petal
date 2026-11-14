import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildResumeNote, newestUnseen, notedSessions, parseNotedSessions, readNote, stampTime, stoppedText, type ResumeSession } from '../src/main/resume-notes-text';

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() }, shell: {}, ipcMain: { handle: () => {}, on: () => {} } }));

const session = (over: Partial<ResumeSession> = {}): ResumeSession => ({
  title: 'Export button', sessionId: 'abc', cwd: '/tmp/p', running: false, agent: false, lastActive: null, lastPrompt: '', lastReply: '', waiting: [], ...over,
});

describe('newestUnseen', () => {
  it('picks the newest quit folder, ignoring other names', () => {
    expect(newestUnseen(['2026-11-01_09-00', 'last-shown', '2026-11-13_18-40', '2026-11-02_10-00', '.DS_Store'], null)).toBe('2026-11-13_18-40');
  });
  it('returns null once the newest was shown', () => {
    expect(newestUnseen(['2026-11-01_09-00', '2026-11-13_18-40'], '2026-11-13_18-40')).toBeNull();
  });
  it('offers a newer quit after an older one was shown', () => {
    expect(newestUnseen(['2026-11-01_09-00', '2026-11-13_18-40'], '2026-11-01_09-00')).toBe('2026-11-13_18-40');
  });
  it('returns null with no quit folders', () => {
    expect(newestUnseen([], null)).toBeNull();
  });
});

describe('stampTime', () => {
  it('reads a folder stamp as a date and time', () => {
    expect(stampTime('2026-10-29_14-05')).toBe('2026-10-29 14:05');
  });
});

describe('notedSessions and parseNotedSessions', () => {
  it('keeps sessions with a note and drops shells', () => {
    const rows = notedSessions([{ session: session({ running: true }), file: 'export-abc.md' }, { session: session({ sessionId: null, title: 'zsh' }), file: null }]);
    expect(rows).toEqual([{ title: 'Export button', sessionId: 'abc', cwd: '/tmp/p', running: true, file: 'export-abc.md' }]);
    expect(parseNotedSessions(JSON.parse(JSON.stringify(rows)))).toEqual(rows);
  });
  it('drops malformed rows and non-lists', () => {
    expect(parseNotedSessions({ title: 'x' })).toEqual([]);
    expect(parseNotedSessions([null, { title: 'x' }, { title: 't', sessionId: 's', file: 'f.md', cwd: 3, running: 'yes' }]))
      .toEqual([{ title: 't', sessionId: 's', cwd: null, running: false, file: 'f.md' }]);
  });
});

describe('readNote and stoppedText', () => {
  const note = buildResumeNote({ ...session({ lastPrompt: 'can i try it?', lastReply: 'Yes, open it.' }), sessionId: 'abc' });
  it('reads the title, session id and where it stopped back out of a note', () => {
    expect(readNote(note)).toEqual({ title: 'Export button', sessionId: 'abc', running: false });
    expect(stoppedText(note)).toBe('Last prompt:\n\ncan i try it?\n\nEnd of the last reply:\n\nYes, open it.');
  });
  it('returns null for a note without a resume line', () => {
    expect(readNote('# Just a title')).toBeNull();
    expect(stoppedText('# Just a title')).toBe('');
  });
});

describe('takeLatest', () => {
  let root = '';
  afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

  const quit = (stamp: string, files: Record<string, string>) => {
    fs.mkdirSync(path.join(root, stamp), { recursive: true });
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, stamp, name), text);
  };

  it('offers the newest set once, with its sessions', async () => {
    const { takeLatest } = await import('../src/main/resume-notes-ipc');
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'petal-resume-'));
    quit('2026-11-01_09-00', { 'index.md': '', 'old-1.md': '' });
    quit('2026-11-13_18-40', { 'index.md': '', 'export-abc.md': '', 'sessions.json': JSON.stringify([{ title: 'Export button', sessionId: 'abc', cwd: '/tmp/p', running: false, file: 'export-abc.md' }]) });
    expect(await takeLatest(root)).toEqual({ stamp: '2026-11-13_18-40', when: '2026-11-13 18:40', notes: 1, sessions: [{ title: 'Export button', sessionId: 'abc', running: false, stopped: '' }] });
    expect(await takeLatest(root)).toBeNull();
    expect(fs.readFileSync(path.join(root, 'last-shown'), 'utf8')).toBe('2026-11-13_18-40');
  });

  it('shows nothing for a quit with only shells, and older notes without sessions.json still count', async () => {
    const { takeLatest } = await import('../src/main/resume-notes-ipc');
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'petal-resume-'));
    quit('2026-11-13_18-40', { 'index.md': '' });
    expect(await takeLatest(root)).toBeNull();
    const older = buildResumeNote({ ...session({ lastPrompt: 'ship it' }), sessionId: 'abc' });
    quit('2026-11-14_08-00', { 'index.md': '', 'a-1.md': older, 'b-2.md': '' });
    expect(await takeLatest(root)).toEqual({ stamp: '2026-11-14_08-00', when: '2026-11-14 08:00', notes: 2,
      sessions: [{ title: 'Export button', sessionId: 'abc', running: false, stopped: 'Last prompt:\n\nship it' }] });
  });

  it('returns null when the resume folder does not exist', async () => {
    const { takeLatest } = await import('../src/main/resume-notes-ipc');
    expect(await takeLatest(path.join(os.tmpdir(), 'petal-resume-missing-xyz'))).toBeNull();
  });
});
