// File clashes from fixture transcripts: same repo vs different repos, the time window, and edits grouped per turn.
import { describe, expect, it } from 'vitest';
import { SessionLog, editsByTurn } from '../src/main/session-log';
import { CLASH_WINDOW_MS, clashNotice, findClashes, insideRoot } from '../src/shared/file-clash';
import type { TranscriptEntry } from '../src/main/transcript-entry';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();

const prompt = (uuid: string, minutes: number): TranscriptEntry => ({ type: 'user', uuid, timestamp: ago(minutes), message: { role: 'user', content: 'go' } });
const tool = (name: string, file: string, minutes: number, key = 'file_path'): TranscriptEntry => ({
  type: 'assistant', uuid: `${name}-${file}-${minutes}`, timestamp: ago(minutes), message: { role: 'assistant', content: [{ type: 'tool_use', name, input: { [key]: file } }] },
});
const text = (uuid: string, body: string, minutes: number): TranscriptEntry => ({ type: 'assistant', uuid, timestamp: ago(minutes), message: { role: 'assistant', content: [{ type: 'text', text: body }] } });
const result = (minutes: number): TranscriptEntry => ({ type: 'user', timestamp: ago(minutes), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x' }] } });

function logOf(entries: TranscriptEntry[]): SessionLog {
  const log = new SessionLog(() => NOW);
  for (const entry of entries) log.add(entry);
  return log;
}

const A = logOf([
  prompt('a-p1', 10), tool('Read', '/repo/src/x.ts', 9), tool('Edit', '/repo/src/x.ts', 9), result(9), text('a-r1', 'Changed x.', 8),
  tool('MultiEdit', '/repo/src/y.ts', 8), tool('Write', '/repo/README.md', 7),
]);
const B = logOf([prompt('b-p1', 5), tool('Edit', '/repo/src/x.ts', 4), tool('NotebookEdit', '/repo/nb.ipynb', 4, 'notebook_path')]);
const C = logOf([prompt('c-p1', 5), tool('Edit', '/other/src/x.ts', 3)]); // another repo, same relative path
const OLD = logOf([prompt('o-p1', 40), tool('Edit', '/repo/src/y.ts', 30)]); // same repo, outside the window
const SIDE = logOf([{ ...tool('Edit', '/repo/README.md', 2), isSidechain: true }]); // a subagent's edit isn't the session's

describe('SessionLog', () => {
  it('collects edit-tool files only, per turn, with the reply they belong to', () => {
    expect(A.edits().map((e) => [e.file, e.turnId])).toEqual([['/repo/src/x.ts', 'a-p1'], ['/repo/src/y.ts', 'a-p1'], ['/repo/README.md', 'a-p1']]);
    expect(editsByTurn(A.edits())).toEqual([{ turnId: 'a-p1', replyId: 'a-r1', files: ['/repo/src/x.ts', '/repo/src/y.ts', '/repo/README.md'], at: Date.parse(ago(7)) }]);
    expect(B.edits().map((e) => e.file)).toEqual(['/repo/src/x.ts', '/repo/nb.ipynb']);
    expect(SIDE.edits()).toEqual([]);
  });

  it('starts a new turn at each prompt and collects Task lines with their time', () => {
    const log = logOf([prompt('p1', 6), tool('Edit', '/repo/a.ts', 6), prompt('p2', 3), tool('Edit', '/repo/b.ts', 3), text('r2', 'ok\n**Task:** Fix the login · working', 2)]);
    expect(editsByTurn(log.edits()).map((t) => [t.turnId, t.files])).toEqual([['p1', ['/repo/a.ts']], ['p2', ['/repo/b.ts']]]);
    expect(log.takeTaskLines()).toEqual([{ line: { title: 'Fix the login', state: 'working' }, at: Date.parse(ago(2)), replyId: 'r2' }]);
    expect(log.takeTaskLines()).toEqual([]); // taken once
  });
});

describe('findClashes', () => {
  const sessions = [
    { sessionId: 'A', name: 'Alpha', root: '/repo', edits: A.edits() },
    { sessionId: 'B', name: 'Beta', root: '/repo/', edits: B.edits() },
    { sessionId: 'C', name: 'Gamma', root: '/other', edits: C.edits() },
    { sessionId: 'O', name: 'Old', root: '/repo', edits: OLD.edits() },
    { sessionId: 'N', name: 'No git', root: null, edits: logOf([tool('Edit', '/repo/src/x.ts', 1)]).edits() },
  ];

  it('flags a file two sessions in the same repo edited, on both sides', () => {
    const clashes = findClashes(sessions, NOW);
    expect(clashes.get('A')).toEqual([{ file: 'src/x.ts', otherSessionId: 'B', otherName: 'Beta', at: Date.parse(ago(4)) }]);
    expect(clashes.get('B')).toEqual([{ file: 'src/x.ts', otherSessionId: 'A', otherName: 'Alpha', at: Date.parse(ago(4)) }]);
    expect(clashNotice(clashes.get('A')?.[0] ?? { file: '', otherName: '' })).toBe('Also being edited in Beta: src/x.ts');
  });

  it('ignores another repo, a session outside git, and edits older than the window', () => {
    const clashes = findClashes(sessions, NOW);
    expect(clashes.has('C')).toBe(false);
    expect(clashes.has('N')).toBe(false);
    expect(clashes.has('O')).toBe(false); // y.ts 30 min ago is outside 15 min
    expect(findClashes(sessions, NOW, 31 * 60_000).get('O')).toEqual([{ file: 'src/y.ts', otherSessionId: 'A', otherName: 'Alpha', at: Date.parse(ago(8)) }]);
    expect(findClashes(sessions, NOW + CLASH_WINDOW_MS).size).toBe(0); // everything has aged out
  });

  it('only counts files inside the repo', () => {
    expect(insideRoot('/repo/src/x.ts', '/repo')).toBe('src/x.ts');
    expect(insideRoot('/repository/x.ts', '/repo')).toBeNull();
    expect(insideRoot('/repo', '/repo')).toBeNull();
  });
});
