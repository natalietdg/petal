// History's full-text search: her prompts and Claude's replies are indexed, tool noise is not, and a growing log is read incrementally.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TranscriptIndex, snippetAround } from '../src/main/history-search';
import { tempDir } from './helpers';

const user = (text: string, extra: object = {}) => JSON.stringify({ type: 'user', message: { role: 'user', content: text }, ...extra });
const assistant = (text: string, extra: object = {}) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, ...extra });
const toolResult = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: text }] } });
const toolUse = (command: string) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });

function log(lines: string[], name = 'session.jsonl'): string {
  const file = path.join(tempDir('petal-search-'), name);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

describe('TranscriptIndex', () => {
  it('finds words in her prompts and in Claude replies, case-insensitively, with a snippet', async () => {
    const file = log([user('Why does the reader redraw everything?'), assistant('Because update() re-parses all twenty replies with Marked.')]);
    const index = new TranscriptIndex();
    expect(await index.search([file], 'REDRAW')).toEqual([{ file, snippet: 'Why does the reader redraw everything? Because update() re-parses all twenty replies with Marked.' }]);
    expect((await index.search([file], 'twenty replies')).map((m) => m.file)).toEqual([file]);
  });

  it('leaves out tool calls, tool results, side chains and wrappers', async () => {
    const file = log([
      user('Start here'),
      toolUse('grep zebra'),
      toolResult('zebra in a tool result'),
      assistant('zebra from a subagent', { isSidechain: true }),
      user('<command-name>/zebra</command-name>'),
    ]);
    expect(await new TranscriptIndex().search([file], 'zebra')).toEqual([]);
  });

  it('skips lines that are not JSON instead of failing the log', async () => {
    const file = log(['{not json', assistant('the parse survived')]);
    expect((await new TranscriptIndex().search([file], 'survived')).length).toBe(1);
  });

  it('ignores queries shorter than two characters', async () => {
    const file = log([assistant('a b c')]);
    expect(await new TranscriptIndex().search([file], 'a')).toEqual([]);
  });

  it('reads only the new lines when a log grows, and a half-written line once it is whole', async () => {
    const file = log([assistant('first reply')]);
    const index = new TranscriptIndex();
    await index.refresh([file]);
    const firstOffset = index.readOffset(file);
    expect(firstOffset).toBe(fs.statSync(file).size);

    const open = vi.spyOn(fs.promises, 'open');
    const half = assistant('second reply about penguins');
    fs.appendFileSync(file, half.slice(0, 20));
    expect(await index.search([file], 'penguins')).toEqual([]);
    expect(index.readOffset(file)).toBe(firstOffset); // the partial line is not consumed

    fs.appendFileSync(file, `${half.slice(20)}\n`);
    expect((await index.search([file], 'penguins')).length).toBe(1);
    expect((await index.search([file], 'first reply')).length).toBe(1); // earlier text kept, not re-read
    expect(open).toHaveBeenCalledTimes(2);
    open.mockRestore();
  });

  it('does not reopen a log that has not changed', async () => {
    const file = log([assistant('steady text')]);
    const index = new TranscriptIndex();
    await index.refresh([file]);
    const open = vi.spyOn(fs.promises, 'open');
    await index.search([file], 'steady');
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('reads a replaced or shrunk log from the top, and forgets logs no longer listed', async () => {
    const file = log([assistant('old words that were long enough')]);
    const other = log([assistant('other log')], 'other.jsonl');
    const index = new TranscriptIndex();
    await index.refresh([file, other]);
    fs.writeFileSync(file, `${assistant('new')}\n`);
    expect(await index.search([file], 'old words')).toEqual([]);
    expect((await index.search([file], 'new')).length).toBe(1);
    expect(index.readOffset(other)).toBeUndefined();
  });

  it('drops a log deleted since it was listed', async () => {
    const file = log([assistant('gone soon')]);
    const index = new TranscriptIndex();
    await index.refresh([file]);
    fs.rmSync(file);
    expect(await index.search([file], 'gone')).toEqual([]);
  });
});

describe('snippetAround', () => {
  it('cuts long text around the match on one line, with ellipses', () => {
    const text = `${'a'.repeat(100)}\n\nneedle\n${'b'.repeat(200)}`;
    const snippet = snippetAround(text, text.indexOf('needle'), 6);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain(' needle ');
    expect(snippet.length).toBeLessThan(150);
  });
});
