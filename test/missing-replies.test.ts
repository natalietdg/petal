// Replies that reached the log but hid in the reader: merged into an earlier turn, folded under its last section,
// behind a compact summary shown as her prompt, or behind a reply-box echo nothing ever dropped. Synthetic entries only.
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { flowFor } from '../src/main/flow';
import { readTurns } from '../src/main/handoff';
import { isUserTurn, promptText } from '../src/main/prompts';
import { ReplyCollector } from '../src/main/replies';
import { replyBlocks } from '../src/renderer/reply-blocks';
import { add, untilStale } from '../src/renderer/pending-echo';
import { assistantEntry, removeTempDirs, tempDir, toolResultEntry, toolUseEntry, userEntry, writeJsonl } from './helpers';
import type { TranscriptEntry } from '../src/main/transcript-entry';

afterEach(removeTempDirs);

// Another session's SendMessage between turns: a meta user entry, kind 'peer', no hand-back flag.
const peerMessage = userEntry('Another Claude session sent a message.', { uuid: 'peer', isMeta: true, origin: { kind: 'peer' } });
// The same message while Claude is mid-turn: a queued_command attachment, answered inside the running turn.
const queuedPeer: TranscriptEntry = { type: 'attachment', uuid: 'qp', attachment: { type: 'queued_command', commandMode: 'prompt', prompt: 'peer note', origin: { kind: 'peer' } } };
const compactSummary = userEntry('This session is being continued from a previous conversation.', { uuid: 'compact', isCompactSummary: true });

const collect = (entries: TranscriptEntry[]): ReplyCollector => {
  const c = new ReplyCollector();
  entries.forEach((entry) => c.add(entry));
  return c;
};

describe('a peer message between turns', () => {
  const SESSION = [
    userEntry('q', { timestamp: '2026-10-12T00:00:00.000Z' }),
    assistantEntry('## Report\n\nThe first answer.', 'a1'),
    peerMessage,
    toolUseEntry(),
    toolResultEntry(),
    assistantEntry('Read the peer note.', 'a2'),
  ];

  it('reader: Claude answering it is a new reply, not more of the sectioned one above', () => {
    const replies = collect(SESSION).newestFirst();
    expect(replies.map((r) => [r.id, r.prompt, r.markdown])).toEqual([
      ['a2', '', 'Read the peer note.'],
      ['a1', 'q', '## Report\n\nThe first answer.'],
    ]);
  });

  it('History and Flow split there too', async () => {
    const file = writeJsonl(path.join(tempDir(), 'peer.jsonl'), SESSION);
    expect(await readTurns(file)).toEqual([
      { prompt: 'q', reply: ['## Report\n\nThe first answer.'] },
      { prompt: '', reply: ['Read the peer note.'] },
    ]);
    expect((await flowFor(file)).steps[0]?.replyIds).toEqual(['a1', 'a2']);
  });

  it('mid-turn, as a queued attachment, it stays part of the running turn', () => {
    const replies = collect([userEntry('q'), assistantEntry('Working.', 'a1'), queuedPeer, assistantEntry('Done.', 'a2')]).newestFirst();
    expect(replies).toHaveLength(1);
    expect(replies[0]?.markdown).toBe('Working.\n\nDone.');
  });
});

describe('a compact summary', () => {
  it('is not her prompt: no bubble, no prompt count, no title', () => {
    expect(isUserTurn(compactSummary)).toBe(false);
    expect(promptText(compactSummary)).toBe('');
    const c = collect([userEntry('q'), assistantEntry('Before.', 'a1'), compactSummary]);
    expect(c.waiting()).toEqual([]);
    expect(c.promptCount).toBe(1);
  });

  it('mid-turn, the rest of the turn stays with her prompt', () => {
    const replies = collect([userEntry('q'), assistantEntry('Before.', 'a1'), compactSummary, assistantEntry('After.', 'a2')]).newestFirst();
    expect(replies.map((r) => [r.prompt, r.markdown])).toEqual([['q', 'Before.\n\nAfter.']]);
  });
});

describe('texts after a sectioned one', () => {
  const reply = (texts: string[]) => collect([userEntry('q'), ...texts.map((t, i) => assistantEntry(t, `a${i}`))]).newestFirst()[0];

  it('the collector marks where each later text starts', () => {
    const r = reply(['One.', 'Two.', 'Three.']);
    expect(r?.markdown).toBe('One.\n\nTwo.\n\nThree.');
    expect(r?.breaks?.map((at) => r.markdown.slice(at))).toEqual(['Two.\n\nThree.', 'Three.']);
  });

  it('a text after ## sections is its own block, so it never folds into the last section', () => {
    const r = reply(['## Plan\n\nSteps.', 'Committed as abc123.']);
    expect(replyBlocks(r?.markdown ?? '', r?.breaks)).toEqual(['## Plan\n\nSteps.', 'Committed as abc123.']);
  });

  it('texts before the sectioned one stay with it; only what follows splits off', () => {
    const r = reply(['Looking now.', '**Headline**\n\n## Why\n\nBecause.', 'Committed.', 'Pushed.']);
    expect(replyBlocks(r?.markdown ?? '', r?.breaks)).toEqual(['Looking now.\n\n**Headline**\n\n## Why\n\nBecause.', 'Committed.\n\nPushed.']);
  });

  it('a ## inside a code block is not a section, and a reply without breaks is one block', () => {
    const r = reply(['```md\n## not a heading\n```', 'Next.']);
    expect(replyBlocks(r?.markdown ?? '', r?.breaks)).toEqual([r?.markdown]);
    expect(replyBlocks('## A\n\nx\n\nmore')).toEqual(['## A\n\nx\n\nmore']);
  });
});

describe('a reply-box echo nothing replaced', () => {
  const seen = { state: 'live' as const, sessionId: 's1', promptCount: 0, busy: false };

  it('is re-checked when it turns stale, since an idle tab gets no update to drop it', () => {
    const list = add([], 'swallowed by a picker', seen, 1_000);
    expect(untilStale(list, 1_000)).toBe(120_001);
    expect(untilStale(list, 100_000)).toBe(21_001);
    expect(untilStale(list, 200_000)).toBeNull(); // already stale: the next update drops it
    expect(untilStale([], 1_000)).toBeNull();
  });
});
