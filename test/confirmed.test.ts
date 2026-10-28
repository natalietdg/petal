// The Confirmed page: which lines of a session's replies land in Verified, Decided, Done and In progress.
import { describe, expect, it } from 'vitest';
import { confirmedCount, confirmedItems, type ConfirmedReply } from '../src/shared/confirmed';

const reply = (id: string, markdown: string, prompt = 'go'): ConfirmedReply => ({ id, markdown, prompt });

describe('confirmedItems', () => {
  it('lists Checked lines newest first, each with its reply headline', () => {
    const groups = confirmedItems([
      reply('r2', '**The cache is warm.**\n\nIt loads fast.\n\n**Checked:** ran the load test, 120 ms median.'),
      reply('r1', '**Parser fixed.**\n\n**Checked**: `npm test` passes,\nall 40 cases.'),
    ]);
    expect(groups.verified).toEqual([
      { text: 'ran the load test, 120 ms median.', context: 'The cache is warm.', replyId: 'r2' },
      { text: '`npm test` passes, all 40 cases.', context: 'Parser fixed.', replyId: 'r1' },
    ]);
  });

  it('pairs a Decide with her next prompt', () => {
    const groups = confirmedItems([
      reply('r2', '**Both themes ship.**', 'keep both'),
      reply('r1', '**Two ways to theme it.**\n\n**Decide:** keep both themes or only the light one?'),
    ]);
    expect(groups.decided).toEqual([{ text: 'keep both themes or only the light one?', context: 'Two ways to theme it.', answer: 'keep both', replyId: 'r1' }]);
    expect(groups.progress).toEqual([]);
  });

  it('answers the newest Decide from a prompt still waiting on a reply', () => {
    const groups = confirmedItems([reply('r1', '**Decide:** ship today?')], ['yes, ship it']);
    expect(groups.decided[0]?.answer).toBe('yes, ship it');
  });

  it('puts an unanswered Decide under In progress as Waiting on you', () => {
    const groups = confirmedItems([reply('r1', '**Pick a name.**\n\n**Decide:** Maple or Birch?')]);
    expect(groups.decided).toEqual([]);
    expect(groups.progress).toEqual([{ text: 'Maple or Birch?', context: 'Pick a name.', pill: 'Waiting on you', replyId: 'r1' }]);
  });

  it('collects Done callouts and a conclusion Result line', () => {
    const groups = confirmedItems([
      reply('r2', '**Conclusion:** the export works.\n**Result:** export button added to the toolbar.\n**Impact:** nothing open.'),
      reply('r1', '**Saved.**\n\n**Done:** the settings file is written.'),
    ]);
    expect(groups.done.map((i) => i.text)).toEqual(['export button added to the toolbar.', 'the settings file is written.']);
  });

  it('shows the newest Doing line as In progress, and skips one that says nothing is running', () => {
    const running = confirmedItems([reply('r2', '**Halfway.**\n\n**Doing:** building the export\n**Next:** test it'), reply('r1', '**Doing:** old work')]);
    expect(running.progress).toEqual([{ text: 'building the export', context: 'Halfway.', pill: 'In progress', replyId: 'r2' }]);
    for (const idle of ['nothing running', 'Nothing pending', 'nothing']) {
      expect(confirmedItems([reply('r1', `**Doing:** ${idle}`)]).progress).toEqual([]);
    }
  });

  it('ignores labels inside code fences', () => {
    const markdown = ['**Example.**', '', '```md', '**Checked:** not real', '**Done:** not real', '**Decide:** not real', '**Doing:** not real', '```'].join('\n');
    const groups = confirmedItems([reply('r1', markdown)]);
    expect(confirmedCount(groups)).toBe(0);
  });

  it('leaves a prose "Done:" alone; only the bold label counts', () => {
    expect(confirmedItems([reply('r1', 'Done: this is just a sentence.')]).done).toEqual([]);
  });
});
