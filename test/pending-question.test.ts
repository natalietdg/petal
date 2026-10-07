// Pending AskUserQuestion detection, from entries shaped like the real transcript lines (Claude Code 2.1.291).
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PendingQuestionTracker, toQuestions } from '../src/main/pending-question';
import { TranscriptTail } from '../src/main/transcript';
import { assistantEntry, removeTempDirs, tempDir, userEntry, writeJsonl } from './helpers';
import type { TranscriptEntry } from '../src/main/transcript-entry';
import type { PendingQuestion } from '../src/shared/prompt-answer';

const INPUT = {
  questions: [{
    question: 'Which fruit do you prefer?',
    header: 'Fruit choice',
    multiSelect: false,
    options: [{ label: 'Apple', description: 'Crisp' }, { label: 'Pear', description: 'Soft' }],
  }],
};

const ask = (id: string, input: unknown = INPUT, extra: Partial<TranscriptEntry> = {}): TranscriptEntry => ({
  type: 'assistant',
  uuid: `ask-${id}`,
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: input as never }] },
  ...extra,
});

const result = (id: string): TranscriptEntry => ({
  type: 'user',
  uuid: `res-${id}`,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, text: 'Your questions have been answered' }] },
});

afterEach(removeTempDirs);

describe('PendingQuestionTracker', () => {
  it('is pending from the tool_use until its tool_result', () => {
    const tracker = new PendingQuestionTracker();
    expect(tracker.add(userEntry('pick a fruit'))).toBe(false);
    expect(tracker.add(ask('toolu_1'))).toBe(true);
    expect(tracker.current()).toEqual({ toolUseId: 'toolu_1', questions: INPUT.questions });
    expect(tracker.add(result('toolu_other'))).toBe(false);
    expect(tracker.current()?.toolUseId).toBe('toolu_1');
    expect(tracker.add(result('toolu_1'))).toBe(true);
    expect(tracker.current()).toBeNull();
  });

  it('clears on a new prompt (the picker is gone) and ignores subagent questions', () => {
    const tracker = new PendingQuestionTracker();
    tracker.add(ask('toolu_1'));
    expect(tracker.add(userEntry('never mind'))).toBe(true);
    expect(tracker.current()).toBeNull();
    expect(tracker.add(ask('toolu_2', INPUT, { isSidechain: true }))).toBe(false);
    expect(tracker.current()).toBeNull();
  });

  it('ignores other tools and plain replies', () => {
    const tracker = new PendingQuestionTracker();
    tracker.add(ask('toolu_1'));
    expect(tracker.add(assistantEntry('thinking about it'))).toBe(false);
    expect(tracker.add({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'ls' } }] } })).toBe(false);
    expect(tracker.current()?.toolUseId).toBe('toolu_1');
  });

  it('a malformed question shows no card', () => {
    expect(toQuestions({})).toBeNull();
    expect(toQuestions({ questions: [] })).toBeNull();
    expect(toQuestions({ questions: [{ question: 'Q', options: [{ label: 'only one' }] }] })).toBeNull();
    expect(toQuestions({ questions: [{ question: '', options: [{ label: 'a' }, { label: 'b' }] }] })).toBeNull();
    expect(toQuestions({ questions: [{ question: 'Q', options: [{ label: 'a' }, { nope: 1 }] }] })).toBeNull();
    expect(toQuestions({ questions: [{ question: 'Q', options: [{ label: 'a' }, { label: 'b' }] }] })).toEqual([
      { question: 'Q', header: '', multiSelect: false, options: [{ label: 'a', description: '' }, { label: 'b', description: '' }] },
    ]);
    const tracker = new PendingQuestionTracker();
    tracker.add(ask('toolu_bad', { questions: 'nope' }));
    expect(tracker.current()).toBeNull();
  });
});

describe('TranscriptTail reports the pending question', () => {
  it('reports it with the replies, and again when the answer arrives', () => {
    const file = writeJsonl(path.join(tempDir(), 's.jsonl'), [userEntry('pick a fruit'), assistantEntry('Let me ask.'), ask('toolu_9')]);
    const seen: (PendingQuestion | null)[] = [];
    const tail = new TranscriptTail(file, ({ question }) => { seen.push(question); });
    expect(seen.at(-1)?.toolUseId).toBe('toolu_9');
    writeJsonl(file, [userEntry('pick a fruit'), assistantEntry('Let me ask.'), ask('toolu_9'), result('toolu_9')]);
    tail.poll();
    tail.stop();
    expect(seen.at(-1)).toBeNull();
  });
});
