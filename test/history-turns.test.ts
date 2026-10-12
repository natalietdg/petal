// The History conversation view: turns from handoff.readTurns, paged 30 at a time from the end by history-turns.ts.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTurns, toMarkdown } from '../src/main/handoff';
import { readHead, readTail } from '../src/main/jsonl-window';
import { pageOfTurns, TURNS_PER_PAGE, turnsFor } from '../src/main/history-turns';
import type { Turn } from '../src/main/handoff';
import { assistantEntry, removeTempDirs, tempDir, toolResultEntry, toolUseEntry, useTempUserData, userEntry, writeJsonl } from './helpers';

let dir: string;

beforeEach(() => {
  useTempUserData();
  dir = tempDir();
});
afterEach(removeTempDirs);

describe('readTurns', () => {
  it('an empty file has no turns', async () => {
    const file = path.join(dir, 'empty.jsonl');
    fs.writeFileSync(file, '');
    expect(await readTurns(file)).toEqual([]);
  });

  it('keeps file order and groups every assistant text under its prompt', async () => {
    const file = writeJsonl(path.join(dir, 's.jsonl'), [
      userEntry('first'),
      assistantEntry('one'),
      toolUseEntry(),
      toolResultEntry(),
      assistantEntry('two'),
      userEntry('second'),
      assistantEntry('three'),
      userEntry('third, unanswered'),
    ]);
    expect(await readTurns(file)).toEqual([
      { prompt: 'first', reply: ['one', 'two'] },
      { prompt: 'second', reply: ['three'] },
      { prompt: 'third, unanswered', reply: [] },
    ]);
  });

  it('skips wrappers, reminders, interruptions, sidechains, malformed and blank lines', async () => {
    const file = writeJsonl(path.join(dir, 's.jsonl'), [
      assistantEntry('before any prompt'),
      userEntry('<system-reminder>noise</system-reminder>'),
      userEntry('[Request interrupted by user]'),
      userEntry('real <system-reminder>hidden</system-reminder>'),
      '{not json',
      '',
      assistantEntry('side', 'x', { isSidechain: true }),
      assistantEntry('answer'),
    ]);
    expect(await readTurns(file)).toEqual([{ prompt: 'real', reply: ['answer'] }]);
  });

  it('turns slash commands into "/name args"', async () => {
    const file = writeJsonl(path.join(dir, 's.jsonl'), [
      userEntry('<command-name>/release</command-name><command-args>v2 --dry</command-args>'),
      userEntry('<command-name>clear</command-name>'),
    ]);
    expect((await readTurns(file)).map((t) => t.prompt)).toEqual(['/release v2 --dry', '/clear']);
  });

  it('handles CRLF line endings', async () => {
    const file = path.join(dir, 'crlf.jsonl');
    fs.writeFileSync(file, [userEntry('q'), assistantEntry('a')].map((e) => JSON.stringify(e)).join('\r\n'));
    expect(await readTurns(file)).toEqual([{ prompt: 'q', reply: ['a'] }]);
  });

  it('reads many turns in order (the page source)', async () => {
    const entries = Array.from({ length: 75 }, (_, i) => [userEntry(`q${i}`), assistantEntry(`a${i}`, `id${i}`)]).flat();
    const turns = await readTurns(writeJsonl(path.join(dir, 'big.jsonl'), entries));
    expect(turns).toHaveLength(75);
    expect(turns[0]).toEqual({ prompt: 'q0', reply: ['a0'] });
    expect(turns.at(-1)).toEqual({ prompt: 'q74', reply: ['a74'] });
  });
});

describe('toMarkdown', () => {
  const record = { title: 'T', cwd: '/w', sessionId: 'sid', file: '/w/sid.jsonl' };

  it('lists every turn when small', () => {
    const md = toMarkdown(record, [{ prompt: 'q', reply: [] }]);
    expect(md).toContain('# Earlier session: T');
    expect(md).toContain('- All 1 turns.');
    expect(md).toContain('## You\n\nq\n\n## Claude\n\n_(no text reply)_');
  });

  it('keeps only the newest turns under the 120 KB cap', () => {
    const big = 'x'.repeat(50 * 1024);
    const md = toMarkdown({ ...record, title: '' }, [1, 2, 3, 4].map((n) => ({ prompt: `q${n}`, reply: [big] })));
    expect(md).toContain('# Earlier session: w · new session');
    expect(md).toContain('- Showing the newest 2 of 4 turns');
    expect(md).not.toContain('## You\n\nq2');
    expect(md).toContain('## You\n\nq3');
    expect(md).toContain('## You\n\nq4');
  });
});

describe('jsonl-window', () => {
  const lines = Array.from({ length: 10 }, (_, i) => JSON.stringify({ type: 'user', uuid: `u${i}`, pad: 'p'.repeat(20) }));
  const write = () => {
    const file = path.join(dir, 'w.jsonl');
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    return file;
  };
  const ids = (entries: { uuid?: string }[]) => entries.map((e) => e.uuid);

  it('covers the whole file when the window is big enough', () => {
    const file = write();
    expect(readHead(file, 1 << 20)).toMatchObject({ covered: true });
    expect(ids(readHead(file, 1 << 20).entries)).toHaveLength(10);
    expect(ids(readTail(file, 1 << 20).entries)).toEqual(ids(readHead(file, 1 << 20).entries));
  });

  it('a head read drops the cut last line and only returns whole entries', () => {
    const file = write();
    const bytes = lines[0].length + 1 + Math.floor(lines[1].length / 2);
    const head = readHead(file, bytes);
    expect(head.covered).toBe(false);
    expect(ids(head.entries)).toEqual(['u0']);
  });

  it('a tail read drops the cut first line and keeps the newest entries in order', () => {
    const file = write();
    const bytes = lines[9].length + 1 + lines[8].length + 1 + 5;
    const tail = readTail(file, bytes);
    expect(tail.covered).toBe(false);
    expect(ids(tail.entries)).toEqual(['u8', 'u9']);
  });

  it('a window on an exact line boundary loses no entry', () => {
    const file = write();
    const head = readHead(file, lines[0].length + 1 + lines[1].length + 1);
    expect(ids(head.entries)).toEqual(['u0', 'u1']);
  });

  it('missing and empty files read as empty', () => {
    expect(readTail(path.join(dir, 'nope.jsonl'), 100)).toEqual({ entries: [], covered: false });
    const empty = path.join(dir, 'empty.jsonl');
    fs.writeFileSync(empty, '');
    expect(readHead(empty, 100)).toEqual({ entries: [], covered: true });
  });
});

describe('pageOfTurns', () => {
  const make = (n: number): Turn[] => Array.from({ length: n }, (_, i) => ({ prompt: `p${i}`, reply: [`r${i}a`, `r${i}b`] }));

  it('the first page is the newest 30, oldest first, with absolute indexes', () => {
    const page = pageOfTurns(make(75), undefined);
    expect(TURNS_PER_PAGE).toBe(30);
    expect(page.start).toBe(45);
    expect(page.total).toBe(75);
    expect(page.turns.map((t) => t.index)).toEqual(Array.from({ length: 30 }, (_, i) => 45 + i));
    expect(page.turns[0]).toEqual({ index: 45, prompt: 'p45', reply: 'r45a\n\nr45b' });
  });

  it('"Show earlier" pages back from `before` and stops at 0', () => {
    expect(pageOfTurns(make(75), 45).start).toBe(15);
    const last = pageOfTurns(make(75), 15);
    expect(last.start).toBe(0);
    expect(last.turns.map((t) => t.index)).toEqual(Array.from({ length: 15 }, (_, i) => i));
  });

  it('a `before` past the end is clamped; an empty conversation is one empty page', () => {
    expect(pageOfTurns(make(10), 999)).toMatchObject({ start: 0, total: 10 });
    expect(pageOfTurns([], undefined)).toEqual({ turns: [], start: 0, total: 0 });
  });

  it('turnsFor re-reads only when the transcript changes', async () => {
    const file = writeJsonl(path.join(dir, 'paged.jsonl'), [userEntry('one'), assistantEntry('a')]);
    const first = await turnsFor(file);
    expect(await turnsFor(file)).toBe(first);
    fs.appendFileSync(file, `${JSON.stringify(userEntry('two'))}\n`);
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    const again = await turnsFor(file);
    expect(again).not.toBe(first);
    expect(again.map((t) => t.prompt)).toEqual(['one', 'two']);
  });
});
