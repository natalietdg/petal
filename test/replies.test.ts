import { describe, expect, it } from 'vitest';
import { ReplyCollector, assistantText } from '../src/main/replies';
import { assistantEntry, imageTurnEntries, toolResultEntry, toolUseEntry, userEntry } from './helpers';
import type { TranscriptEntry } from '../src/main/transcript-entry';

describe('assistantText', () => {
  it('joins trimmed text items with blank lines and skips tool use', () => {
    expect(assistantText({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '  one  ' }, { type: 'tool_use', name: 'Bash' }, { type: 'text', text: '   ' }, { type: 'text', text: 'two' }] },
    })).toBe('one\n\ntwo');
  });

  it('accepts string content', () => {
    expect(assistantText({ type: 'assistant', message: { content: 'plain' } })).toBe('plain');
  });

  it('is empty for user, sidechain or contentless entries', () => {
    expect(assistantText(userEntry('hi'))).toBe('');
    expect(assistantText(assistantEntry('side', 'a', { isSidechain: true }))).toBe('');
    expect(assistantText({ type: 'assistant' })).toBe('');
  });
});

describe('ReplyCollector', () => {
  it('groups all assistant text between two prompts into one reply, with the prompt above it', () => {
    const c = new ReplyCollector();
    expect(c.add(userEntry('first question'))).toBe(true); // shown at once, before any reply
    expect(c.add(assistantEntry('part one', 'a1'))).toBe(true);
    expect(c.add(toolUseEntry())).toBe(false);
    expect(c.add(toolResultEntry())).toBe(false); // a tool result is not a new turn
    expect(c.add(assistantEntry('part two', 'a2'))).toBe(true);
    expect(c.newestFirst()).toEqual([{ id: 'a1', timestamp: '2026-10-06T00:00:00.000Z', markdown: 'part one\n\npart two', prompt: 'first question', breaks: [10] }]);
  });

  it('starts a new reply after each user prompt, newest first', () => {
    const c = new ReplyCollector();
    c.add(userEntry('q1'));
    c.add(assistantEntry('r1', 'a1'));
    c.add(userEntry('q2'));
    c.add(assistantEntry('r2', 'a2'));
    expect(c.newestFirst().map((r) => [r.id, r.prompt, r.markdown])).toEqual([['a2', 'q2', 'r2'], ['a1', 'q1', 'r1']]);
  });

  it('a reply with no prompt before it has an empty prompt, and a prompt is used once', () => {
    const c = new ReplyCollector();
    c.add(assistantEntry('orphan', 'a0'));
    c.add(userEntry('<system-reminder>only a wrapper</system-reminder>')); // closes the turn but sets no prompt
    c.add(assistantEntry('second', 'a1'));
    expect(c.newestFirst().map((r) => [r.id, r.prompt])).toEqual([['a1', ''], ['a0', '']]);
  });

  it('ignores sidechain and meta entries', () => {
    const c = new ReplyCollector();
    c.add(userEntry('q'));
    expect(c.add(assistantEntry('subagent', 'side', { isSidechain: true }))).toBe(false);
    c.add(assistantEntry('main', 'a1'));
    expect(c.add(userEntry('meta', { isMeta: true }))).toBe(false);
    c.add(assistantEntry('still same turn', 'a2'));
    expect(c.newestFirst()).toHaveLength(1);
    expect(c.newestFirst()[0].markdown).toBe('main\n\nstill same turn');
  });

  it('keeps only the newest maxReplies', () => {
    const c = new ReplyCollector(2);
    for (const n of [1, 2, 3]) {
      c.add(userEntry(`q${n}`));
      c.add(assistantEntry(`r${n}`, `a${n}`));
    }
    expect(c.newestFirst().map((r) => r.id)).toEqual(['a3', 'a2']);
  });

  it('defaults to 20 replies', () => {
    const c = new ReplyCollector();
    for (let n = 0; n < 25; n += 1) {
      c.add(userEntry(`q${n}`));
      c.add(assistantEntry(`r${n}`, `a${n}`));
    }
    expect(c.newestFirst()).toHaveLength(20);
    expect(c.newestFirst()[0].id).toBe('a24');
  });

  it('lists her prompts as waiting until Claude writes text, then puts them above the reply', () => {
    const c = new ReplyCollector();
    c.add(userEntry('one'));
    c.add(toolUseEntry());
    c.add(userEntry('two'));
    expect(c.waiting().map((w) => w.prompt)).toEqual(['one', 'two']);
    expect(c.promptCount).toBe(2);
    c.add(assistantEntry('answer', 'a1'));
    expect(c.waiting()).toEqual([]);
    expect(c.newestFirst()[0]?.prompt).toBe('one\n\ntwo');
  });

  it('a subagent hand-back ends the turn: Claude answering it is a new reply with no prompt', () => {
    const c = new ReplyCollector();
    c.add(userEntry('q'));
    c.add(assistantEntry('## Plan\n\nDelegated to an agent.', 'a1'));
    const handback = userEntry('Another Claude session reports back.', { isMeta: true, origin: { kind: 'peer', handback: true } });
    expect(c.add(handback)).toBe(false);
    c.add(assistantEntry('The agent finished.', 'a2'));
    expect(c.newestFirst().map((r) => [r.id, r.markdown, r.prompt])).toEqual([['a2', 'The agent finished.', ''], ['a1', '## Plan\n\nDelegated to an agent.', 'q']]);
    expect(c.waiting()).toEqual([]);
    expect(c.promptCount).toBe(1);
  });

  it('her message queued mid-turn ends the turn, waits and counts; an agent or task notification does not', () => {
    const c = new ReplyCollector();
    c.add(userEntry('q'));
    c.add(assistantEntry('## Plan\n\nWorking on it.', 'a1'));
    const queued = (prompt: unknown, origin = 'human', commandMode = 'prompt') => ({ type: 'attachment', uuid: `q-${origin}-${commandMode}`, attachment: { type: 'queued_command', prompt, commandMode, origin: { kind: origin } } }) as TranscriptEntry;
    expect(c.add(queued('<task-notification>done</task-notification>', 'task-notification', 'task-notification'))).toBe(false);
    expect(c.add(queued('from another agent', 'peer'))).toBe(false);
    expect(c.add(queued([{ type: 'text', text: 'also check the tests' }]))).toBe(true);
    expect(c.waiting().map((w) => [w.id, w.prompt])).toEqual([['q-human-prompt', 'also check the tests']]);
    expect(c.promptCount).toBe(2);
    c.add(assistantEntry('Tests pass.', 'a2'));
    expect(c.newestFirst().map((r) => [r.id, r.markdown, r.prompt])).toEqual([['a2', 'Tests pass.', 'also check the tests'], ['a1', '## Plan\n\nWorking on it.', 'q']]);
    expect(c.waiting()).toEqual([]);
  });

  it('wrappers and tool results are not prompts: not waiting, not counted', () => {
    const c = new ReplyCollector();
    expect(c.add(userEntry('<command-name>/clear</command-name>'))).toBe(false);
    expect(c.add(toolResultEntry())).toBe(false);
    expect(c.waiting()).toEqual([]);
    expect(c.promptCount).toBe(0);
  });

  it('newestFirst returns a copy', () => {
    const c = new ReplyCollector();
    c.add(assistantEntry('r', 'a'));
    c.newestFirst().pop();
    expect(c.newestFirst()).toHaveLength(1);
  });
});

describe('ReplyCollector: her pasted images', () => {
  const pasted = '/var/folders/fs/ab/T/petal-paste/paste-2026-10-19T08-55-19-646Z-0b0b0b0b.png';

  it('puts the path from the meta note after her turn into her prompt, waiting and answered', () => {
    const c = new ReplyCollector();
    for (const entry of imageTurnEntries('[Image #3] what is this', [3], [pasted])) c.add(entry);
    expect(c.waiting().map((w) => w.prompt)).toEqual([`[Image: source: ${pasted}] what is this`]);
    expect(c.promptCount).toBe(1); // the note is not a prompt of hers
    c.add(assistantEntry('A login screen.', 'a1', { timestamp: '2026-10-19T08:55:30.000Z' }));
    expect(c.newestFirst()[0].prompt).toBe(`[Image: source: ${pasted}] what is this`);
  });

  it('a note after the reply has started still lands on that reply', () => {
    const c = new ReplyCollector();
    const [turn, , , note] = imageTurnEntries('[Image #1]', [1], [pasted]);
    c.add(turn);
    c.add(assistantEntry('Looking.', 'a1', { timestamp: '2026-10-19T08:55:30.000Z' }));
    expect(c.add(note)).toBe(true);
    expect(c.newestFirst()[0].prompt).toBe(`[Image: source: ${pasted}]`);
  });

  it('ignores a stray source note and meta entries that are not notes', () => {
    const c = new ReplyCollector();
    const [, , , note] = imageTurnEntries('[Image #1]', [1], [pasted]);
    expect(c.add(note)).toBe(false);
    c.add(userEntry('plain'));
    expect(c.add({ type: 'user', isMeta: true, message: { content: [{ type: 'text', text: 'Caveat: not a note' }] } })).toBe(false);
    expect(c.waiting().map((w) => w.prompt)).toEqual(['plain']);
  });
});
