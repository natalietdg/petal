import { describe, expect, it } from 'vitest';
import {
  bySession, courseText, statusWord, threadStatus, handoffAnswer, handoffQuestion, mergeRecords, needsHuman, openHandoff, parseCourse, parseDistillation, parseJsonl, recordOf, recordsFromReplies, toJsonl,
  type DistillRecord,
} from '../src/shared/distillation';
import { buildLoopBrief, DISTILL_BRIEF } from '../src/shared/test-loop';

const ROUND = [
  '**Round 2: the coupon cap is fixed.**',
  '',
  '## Distillation',
  '- Q: What changed this round? · A: The coupon total is capped at the cart total in totals.ts.',
  '- Q: Is the retry failure flaky or real? · A: Flaky, it passed on the rerun with the same code.',
  '- Q: Should a coupon ever make the order free?',
  '  A: needs you · whether a 100% coupon may take the total to zero.',
  '**Course:** retest · the cap fix needs a green run before new scenarios.',
  '',
  '**Loop:** round 2/5 · verifying · 1 open',
].join('\n');

describe('parseDistillation', () => {
  it('reads Q/A pairs inline and on the next line, the course and its reason', () => {
    const d = parseDistillation(ROUND);
    expect(d?.questions).toEqual([
      { q: 'What changed this round?', a: 'The coupon total is capped at the cart total in totals.ts.', needsYou: false },
      { q: 'Is the retry failure flaky or real?', a: 'Flaky, it passed on the rerun with the same code.', needsYou: false },
      { q: 'Should a coupon ever make the order free?', a: 'whether a 100% coupon may take the total to zero.', needsYou: true },
    ]);
    expect(d?.course).toBe('retest');
    expect(d?.reason).toBe('the cap fix needs a green run before new scenarios.');
    expect(d?.malformed).toBe(0);
  });
  it('accepts bold labels, numbered items, other separators and an em dash Claude slipped in', () => {
    const d = parseDistillation('### Distillation\n1. **Q:** Why did checkout fail? — **A:** The tax helper rounds per order.\n2. Q: Next? | A: `needs you` the staging URL\n\n**Course**: fix bug, because the rounding is wrong');
    expect(d?.questions.map((q) => [q.q, q.a, q.needsYou])).toEqual([
      ['Why did checkout fail?', 'The tax helper rounds per order.', false],
      ['Next?', 'the staging URL', true],
    ]);
    expect(d?.course).toBe('fix-bug');
    expect(d?.reason).toBe('the rounding is wrong');
  });
  it('reads every course word', () => {
    expect(parseCourse('**Course:** add scenarios · the empty cart has no test')).toEqual({ course: 'add-scenarios', reason: 'the empty cart has no test' });
    expect(parseCourse('**Course:** retest')).toEqual({ course: 'retest', reason: '' });
    expect(parseCourse('Course: Fix the bug: totals.ts rounds wrong')).toEqual({ course: 'fix-bug', reason: 'totals.ts rounds wrong' });
    expect(parseCourse('**Course:** hand to you · I need the payment sandbox key')).toEqual({ course: 'hand-to-you', reason: 'I need the payment sandbox key' });
    expect(parseCourse('- __Course__: handoff (needs a product call)')?.course).toBe('hand-to-you');
    expect(parseCourse('**Course:** go for a walk')).toBeNull();
    expect(parseCourse('The course of action is retest')).toBeNull();
  });
  it('counts malformed lines: no answer, a stray bullet, an empty question', () => {
    const d = parseDistillation('## Distillation\n- Q: What is untested?\n- Q: Why did it fail? · A: A null cart.\n- just a note\n- Q:  · A: something\n- Q: dangling at the end');
    expect(d?.questions).toHaveLength(1);
    expect(d?.malformed).toBe(4);
    expect(d?.course).toBeNull();
  });
  it('is null without the heading, and ignores a section in a code fence or after another heading', () => {
    expect(parseDistillation('- Q: a · A: b\n**Course:** retest')).toBeNull();
    expect(parseDistillation('```\n## Distillation\n- Q: a · A: b\n```')).toBeNull();
    const d = parseDistillation('## Distillation\n- Q: a? · A: b\n## Next steps\n- Q: c? · A: d');
    expect(d?.questions).toHaveLength(1);
  });
  it('caps questions at eight', () => {
    const many = Array.from({ length: 12 }, (_, i) => `- Q: question ${i}? · A: answer ${i}`).join('\n');
    expect(parseDistillation(`## Distillation\n${many}\n**Course:** retest`)?.questions).toHaveLength(8);
  });
});

describe('hand-off detection', () => {
  const reply = (id: string, markdown: string, s = 0) => ({ id, markdown, timestamp: new Date(1_000_000 + s * 1000).toISOString() });
  it('needs her for hand to you, or any needs-you question', () => {
    expect(needsHuman(parseDistillation(ROUND) as NonNullable<ReturnType<typeof parseDistillation>>)).toBe(true);
    const hand = parseDistillation('## Distillation\n- Q: Is it green? · A: Yes.\n**Course:** hand to you · the release call is yours');
    expect(hand && needsHuman(hand)).toBe(true);
    expect(hand && handoffQuestion(hand)).toBe('the release call is yours');
    const plain = parseDistillation('## Distillation\n- Q: Is it green? · A: Yes.\n**Course:** add scenarios · refunds next');
    expect(plain && needsHuman(plain)).toBe(false);
  });
  it('opens only on the newest reply, and closes once she has written', () => {
    const replies = [reply('r2', ROUND, 2), reply('r1', '## Distillation\n- Q: x? · A: needs you · y\n**Course:** hand to you', 1)];
    expect(openHandoff(replies, 0)).toEqual({ replyId: 'r2', question: 'Should a coupon ever make the order free?', asks: ['Should a coupon ever make the order free?'], course: 'retest', reason: 'the cap fix needs a green run before new scenarios.' });
    expect(openHandoff(replies, 1)).toBeNull();
    expect(openHandoff([reply('r3', 'All green, no questions.'), ...replies], 0)).toBeNull();
  });
  it('sends her answer with the question it answers', () => {
    const text = handoffAnswer({ question: 'Should a coupon make the order free?' }, '  No, keep a 1 cent floor. ');
    expect(text).toBe('On your distillation question "Should a coupon make the order free?": No, keep a 1 cent floor.\nCarry on with the test loop from here.');
    expect(text).not.toMatch(/—/);
  });
});

describe('records', () => {
  const at = (s: number) => new Date(1_000_000 + s * 1000).toISOString();
  it('takes round and total from the Loop line, and skips replies with no course yet', () => {
    expect(recordOf({ id: 'a', markdown: ROUND, timestamp: at(5) }, 's1')).toMatchObject({ id: 'a', sessionId: 's1', at: 1_005_000, round: 2, total: 5, course: 'retest' });
    expect(recordOf({ id: 'b', markdown: '## Distillation\n- Q: a? · A: b' }, 's1')).toBeNull();
    expect(recordOf({ markdown: ROUND }, 's1')).toBeNull();
  });
  it('lists replies oldest first, stopping at the loop start', () => {
    const replies = [{ id: 'c', markdown: ROUND, timestamp: at(30) }, { id: 'x', markdown: 'no section', timestamp: at(20) }, { id: 'b', markdown: ROUND, timestamp: at(10) }, { id: 'a', markdown: ROUND, timestamp: at(1) }];
    expect(recordsFromReplies(replies, 's').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(recordsFromReplies(replies, 's', 1_005_000).map((r) => r.id)).toEqual(['b', 'c']);
  });
  it('round-trips through jsonl, skipping torn and invalid lines, the later copy winning', () => {
    const one = recordOf({ id: 'a', markdown: ROUND, timestamp: at(1) }, 's') as DistillRecord;
    const two: DistillRecord = { ...one, id: 'b', at: 2_000_000, course: 'hand-to-you' };
    const text = `${toJsonl([one, two])}{"id":"torn"\n${JSON.stringify({ ...one, course: 'dance' })}\n${JSON.stringify({ ...one, reason: 'updated' })}\n`;
    const back = parseJsonl(text);
    expect(back.map((r) => [r.id, r.course, r.reason])).toEqual([['a', 'retest', 'updated'], ['b', 'hand-to-you', one.reason]]);
    expect(mergeRecords([two], [one]).map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('groups by session, newest session first', () => {
    const base = recordOf({ id: 'a', markdown: ROUND, timestamp: at(1) }, 's1') as DistillRecord;
    const groups = bySession([base, { ...base, id: 'b', sessionId: 's2', at: 3_000_000 }, { ...base, id: 'c', at: 2_000_000 }]);
    expect(groups.map((g) => [g.sessionId, g.records.map((r) => r.id)])).toEqual([['s2', ['b']], ['s1', ['a', 'c']]]);
  });
  it('words a course for the Activity feed', () => {
    expect(courseText({ course: 'fix-bug', reason: 'tax rounds per order', round: 2 }, 'acme')).toBe('Test loop round 2 in acme: fix bug · tax rounds per order');
  });
});

describe('the loop brief asks for distillation', () => {
  const brief = buildLoopBrief({ focus: 'checkout', rounds: 3, stages: [{ id: 'unit', name: 'Unit', command: 'npm test' }], stack: [] });
  it('carries the section format, the course words and the stop-and-wait rule, with no em dash', () => {
    for (const line of DISTILL_BRIEF) expect(brief).toContain(line);
    expect(brief).toContain('   ## Distillation\n   - Q: an open thread from last round · A: settled · the evidence that settled it\n   - Q: the question · A: your answer');
    expect(brief).toContain('   ## Open threads\n   - A question you could not settle? *Check: the command or file that would settle it*');
    expect(brief).toContain('start by revisiting every open thread from your previous round');
    expect(brief).toContain('"needs you · "');
    expect(brief).toContain('add scenarios, retest, fix bug, hand to you');
    expect(brief).toContain('For hand to you, stop there and wait for my answer.');
    expect(brief).not.toMatch(/[—–]/);
    expect(brief.indexOf('## Distillation')).toBeLessThan(brief.indexOf('**Loop:** round 1/3'));
  });
  it('parses its own example as a valid distillation', () => {
    const example = DISTILL_BRIEF.slice(3, 10).join('\n');
    const d = parseDistillation(example);
    expect(d?.questions.map((q) => q.verdict ?? null)).toEqual(['settled', null]);
    expect(d?.course).toBe('retest');
    expect(d?.malformed).toBe(0);
    expect(d?.threads).toEqual([
      { question: 'A question you could not settle?', check: 'the command or file that would settle it', needsYou: false },
      { question: 'A question only I can settle?', check: 'needs you · what you need from me', needsYou: true },
    ]);
    expect(d && needsHuman(d)).toBe(true);
  });
});

// Round 1 leaves two open threads; round 2 settles one, carries the other, and adds a needs-you thread.
const R1 = [
  '## Distillation',
  '- Q: What changed? · A: Five checkout scenarios were added as tests.',
  '**Course:** fix bug · the coupon total goes below zero',
  '## Open threads',
  '- Does the retry test fail on a slow network too? *Check: run src/api/client.test.ts with the 2s delay*',
  '- Is tax rounded per line in the API as well? *Check: read api/tax.ts*',
  '**Loop:** round 1/5 · fixing · 1 open',
].join('\n');
const R2 = [
  '## Distillation',
  '- Q: Does the retry test fail on a slow network too? · A: settled · it passed 5 of 5 runs with the 2s delay',
  '- Q: Is tax rounded per line in the API as well? · A: carried · api/tax.ts calls a helper outside the repo',
  '- Q: Is the coupon fix covering the cause? · A: Yes, the cap lives in totals.ts where every path goes.',
  '**Course:** retest · the cap fix needs a green run',
  '## Open threads',
  '- Is tax rounded per line in the API as well? *Check: read the helper in the tax package*',
  '- May a 100% coupon make an order free? *Check: needs you · the product rule for zero-total orders*',
  '**Loop:** round 2/5 · verifying · 0 open',
].join('\n');

describe('open threads across rounds', () => {
  const at = (s: number) => new Date(1_000_000 + s * 1000).toISOString();
  const records = recordsFromReplies([{ id: 'r2', markdown: R2, timestamp: at(2) }, { id: 'r1', markdown: R1, timestamp: at(1) }], 's1');
  it('reads each round’s Open threads with the existing thread parser, the Loop line ending the list', () => {
    expect(records.map((r) => r.threads.map((t) => [t.question, t.needsYou]))).toEqual([
      [['Does the retry test fail on a slow network too?', false], ['Is tax rounded per line in the API as well?', false]],
      [['Is tax rounded per line in the API as well?', false], ['May a 100% coupon make an order free?', true]],
    ]);
    expect(records[0].threads[0].check).toBe('run src/api/client.test.ts with the 2s delay');
  });
  it('reads revisit verdicts', () => {
    expect(records[1].questions.map((q) => [q.verdict ?? null, q.a])).toEqual([
      ['settled', 'it passed 5 of 5 runs with the 2s delay'],
      ['carried', 'api/tax.ts calls a helper outside the repo'],
      [null, 'Yes, the cap lives in totals.ts where every path goes.'],
    ]);
  });
  it('tracks each thread: settled in round 2, carried to round 2, then still open', () => {
    const word = (i: number, j: number) => statusWord(threadStatus(records, i, records[i].threads[j]));
    expect([word(0, 0), word(0, 1), word(1, 0), word(1, 1)]).toEqual(['settled in round 2', 'carried to round 2', 'open', 'open']);
    expect(threadStatus(records, 0, records[0].threads[0])).toEqual({ kind: 'settled', round: 2, note: 'it passed 5 of 5 runs with the 2s delay' });
  });
  it('drops a thread with its reason, and counts a reworded plain answer as settled', () => {
    const r3 = recordOf({ id: 'r3', markdown: '## Distillation\n- Q: Is tax rounded per line in the API as well? · A: dropped · the API is out of scope for this loop\n- Q: May a 100% coupon make the order free? · A: Product says keep a 1 cent floor.\n**Course:** add scenarios · refunds next\n**Loop:** round 3/5 · scenarios · 0 open', timestamp: at(3) }, 's1') as DistillRecord;
    const all = [...records, r3];
    expect(threadStatus(all, 1, all[1].threads[0])).toEqual({ kind: 'dropped', round: 3, note: 'the API is out of scope for this loop' });
    expect(threadStatus(all, 1, all[1].threads[1]).kind).toBe('settled');
  });
  it('makes a needs-you thread a hand-off, and stores threads in jsonl', () => {
    const handoff = openHandoff([{ id: 'r2', markdown: R2 }], 0);
    expect(handoff?.question).toBe('May a 100% coupon make an order free?');
    expect(parseJsonl(toJsonl(records))[1].threads[1]).toEqual({ question: 'May a 100% coupon make an order free?', check: 'needs you · the product rule for zero-total orders', needsYou: true });
    expect(parseJsonl(JSON.stringify({ ...records[0], threads: undefined }))[0].threads).toEqual([]); // an older line
  });
});
