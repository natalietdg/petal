// The Waiting inbox: open Decides and running Doing lines across sessions, newest first.
import { describe, expect, it } from 'vitest';
import { waitingCount, waitingItems, type WaitingSource } from '../src/shared/waiting';
import type { Reply } from '../src/shared/types';

const reply = (id: string, markdown: string, timestamp: string | undefined, prompt = 'go'): Reply => ({ id, markdown, prompt, timestamp });

const source = (tabId: string, replies: Reply[], waiting: string[] = []): WaitingSource => ({
  tabId,
  title: `Session ${tabId}`,
  replies,
  waiting: waiting.map((prompt, i) => ({ id: `${tabId}-w${i}`, timestamp: undefined, prompt })),
});

describe('waitingItems', () => {
  it('lists an open Decide and the Doing line from every session, newest first', () => {
    const items = waitingItems([
      source('t1', [reply('a1', '**Doing:** building the export\n\n**Decide:** CSV or JSON?', '2026-10-28T10:00:00.000Z')]),
      source('t2', [reply('b1', '**Decide:** keep the backup?', '2026-10-28T11:00:00.000Z')]),
    ]);
    expect(items.map((i) => [i.tabId, i.pill, i.text])).toEqual([
      ['t2', 'Waiting on you', 'Keep the backup?'],
      ['t1', 'Waiting on you', 'CSV or JSON?'],
      ['t1', 'In progress', 'Building the export'],
    ]);
    expect(items[0]).toMatchObject({ title: 'Session t2', replyId: 'b1', at: Date.parse('2026-10-28T11:00:00.000Z') });
    expect(waitingCount(items)).toBe(2);
  });

  it('drops a Decide she already answered with a later prompt', () => {
    const items = waitingItems([source('t1', [reply('a1', '**Decide:** CSV or JSON?', '2026-10-28T10:00:00.000Z')], ['CSV only'])]);
    expect(items).toEqual([]);
  });

  it('reads only the newest reply, so an older open Decide is not listed', () => {
    const items = waitingItems([source('t1', [
      reply('a2', 'All done here.', '2026-10-28T10:05:00.000Z', ''),
      reply('a1', '**Decide:** CSV or JSON?', '2026-10-28T10:00:00.000Z'),
    ])]);
    expect(items).toEqual([]);
  });

  it('skips a Doing line that says nothing is running', () => {
    const items = waitingItems([
      source('t1', [reply('a1', '**Doing:** nothing, waiting for you', '2026-10-28T10:00:00.000Z')]),
      source('t2', [reply('b1', '**Doing:** none', '2026-10-28T10:00:00.000Z')]),
    ]);
    expect(items).toEqual([]);
  });

  it('ignores a Decide inside a code fence and a session with no replies', () => {
    const items = waitingItems([
      source('t1', [reply('a1', '```md\n**Decide:** a sample\n```', '2026-10-28T10:00:00.000Z')]),
      source('t2', []),
    ]);
    expect(items).toEqual([]);
  });

  it('puts undated replies last and counts only Waiting on you', () => {
    const items = waitingItems([
      source('t1', [reply('a1', '**Doing:** indexing', undefined)]),
      source('t2', [reply('b1', '**Doing:** compiling', '2026-10-28T09:00:00.000Z')]),
    ]);
    expect(items.map((i) => i.tabId)).toEqual(['t2', 't1']);
    expect(items[1]?.at).toBeNull();
    expect(waitingCount(items)).toBe(0);
  });
});
