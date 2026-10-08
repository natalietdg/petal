// A logged prompt with a paste wrapper: plain everywhere it is a title, raw for the bubbles, counted once.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { promptText, rawPromptText } from '../src/main/prompts';
import { ReplyCollector } from '../src/main/replies';
import { flowFor } from '../src/main/flow';
import { readTurns, toMarkdown } from '../src/main/handoff';
import { add, reconcile } from '../src/renderer/pending-echo';
import { assistantEntry, removeTempDirs, tempDir, userEntry } from './helpers';

const PASTED = [
  '<pasted_content id="2233">',
  'https://example.test/org/project/_workitems/edit/1234?view=a-very-long-query-string',
  'https://example.test/org/project/_git/repo?path=/src/deeply/nested/file-name.ts',
  '',
  'Can u figure out which api is being used by this page',
  '</pasted_content id="2233">',
].join('\n');

afterEach(removeTempDirs);

function writeTranscript(entries: object[]): string {
  const file = path.join(tempDir(), 'session.jsonl');
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

describe('prompts with pasted content', () => {
  it('promptText drops the tags; rawPromptText keeps them for the bubble', () => {
    const entry = userEntry(PASTED);
    expect(promptText(entry)).not.toContain('pasted_content');
    expect(promptText(entry)).toContain('Can u figure out which api');
    expect(rawPromptText(entry)).toBe(PASTED);
  });

  it('counts the turn once, so the reply-box echo is replaced, not doubled', () => {
    const c = new ReplyCollector();
    const before = { state: 'live' as const, sessionId: 's1', promptCount: c.promptCount, busy: true };
    const echoes = add([], 'https://example.test/typed-in-the-reply-box', before);
    c.add(userEntry(PASTED));
    expect(c.promptCount).toBe(1);
    expect(c.waiting().map((w) => w.prompt)).toEqual([PASTED]);
    expect(reconcile(echoes, { ...before, promptCount: c.promptCount })).toEqual([]);
    c.add(assistantEntry('It uses the work items API.', 'a1'));
    expect(c.newestFirst()[0].prompt).toBe(PASTED);
  });

  it('Flow labels and the handoff markdown show no tags', async () => {
    const file = writeTranscript([userEntry(PASTED, { timestamp: '2026-10-08T09:00:00.000Z' }), assistantEntry('It uses the work items API.', 'a1')]);
    const flow = await flowFor(file);
    expect(flow.steps[0].label).not.toContain('pasted_content');
    expect(flow.steps[0].label).toContain('https://example.test/');
    const turns = await readTurns(file);
    expect(turns[0].prompt).toBe(PASTED); // History's bubbles split it
    expect(toMarkdown({ sessionId: 's', file, cwd: null, title: 't' }, turns)).not.toContain('pasted_content');
  });
});
