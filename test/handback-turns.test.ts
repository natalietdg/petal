// A subagent's hand-back starts a new reply in History and Flow too, the same as in the reader.
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { flowFor } from '../src/main/flow';
import { readTurns, toMarkdown } from '../src/main/handoff';
import { ReplyCollector } from '../src/main/replies';
import { assistantEntry, removeTempDirs, tempDir, toolUseEntry, userEntry, writeJsonl } from './helpers';

afterEach(removeTempDirs);

const handback = userEntry('Another Claude session reports back.', { uuid: 'hb', isMeta: true, origin: { kind: 'peer', handback: true } });

const SESSION = [
  userEntry('q', { timestamp: '2026-10-09T00:00:00.000Z' }),
  assistantEntry('## Plan\n\nDelegated to an agent.', 'a1'),
  handback,
  toolUseEntry(),
  assistantEntry('The agent finished.', 'a2'),
  assistantEntry('Merged.', 'a3'),
];

const write = () => writeJsonl(path.join(tempDir(), 'session.jsonl'), SESSION);

describe('a subagent hand-back', () => {
  it('History: Claude answering it is its own turn, with no prompt of hers', async () => {
    expect(await readTurns(write())).toEqual([
      { prompt: 'q', reply: ['## Plan\n\nDelegated to an agent.'] },
      { prompt: '', reply: ['The agent finished.', 'Merged.'] },
    ]);
  });

  it('History: a hand-back Claude never answers in text adds no empty turn', async () => {
    const file = writeJsonl(path.join(tempDir(), 'quiet.jsonl'), [userEntry('q'), assistantEntry('a', 'a1'), handback, userEntry('next'), assistantEntry('b', 'b1')]);
    expect(await readTurns(file)).toEqual([{ prompt: 'q', reply: ['a'] }, { prompt: 'next', reply: ['b'] }]);
  });

  it('handoff markdown: that turn has no empty You heading', async () => {
    const md = toMarkdown({ title: 'T', cwd: null, sessionId: 's', file: 'f' }, await readTurns(write()));
    expect(md).toContain('## You\n\nq\n\n## Claude\n\n## Plan');
    expect(md).toContain('Delegated to an agent.\n## Claude\n\nThe agent finished.\n\nMerged.');
  });

  it('Flow: the step lists the same reply ids the reader shows', async () => {
    const file = write();
    const collector = new ReplyCollector();
    SESSION.forEach((entry) => collector.add(entry));
    const readerIds = collector.newestFirst().map((r) => r.id).reverse();
    const flow = await flowFor(file);
    expect(flow.steps).toHaveLength(1);
    expect(flow.steps[0].replyIds).toEqual(readerIds);
    expect(readerIds).toEqual(['a1', 'a2']);
  });
});
