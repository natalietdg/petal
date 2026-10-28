// The Confirmed page: which lines of a session's replies land in Verified, Decided, Done and In progress.
import { describe, expect, it } from 'vitest';
import { confirmedCount, confirmedItems, type ConfirmedReply } from '../src/shared/confirmed';

const reply = (id: string, markdown: string, prompt = 'go'): ConfirmedReply => ({ id, markdown, prompt });

describe('confirmedItems', () => {
  it('lists Checked lines under Facts, newest first, each with its reply headline', () => {
    const groups = confirmedItems([
      reply('r2', '**The cache is warm.**\n\nIt loads fast.\n\n**Checked:** ran the load test, 120 ms median.'),
      reply('r1', '**Parser fixed.**\n\n**Checked**: `npm test` passes,\nall 40 cases.'),
    ]);
    expect(groups.facts).toEqual([
      { text: 'Ran the load test, 120 ms median.', context: 'The cache is warm.', replyId: 'r2' },
      { text: '`npm test` passes, all 40 cases.', context: 'Parser fixed.', replyId: 'r1' },
    ]);
  });

  it('pairs a Decide with her next prompt', () => {
    const groups = confirmedItems([
      reply('r2', '**Both themes ship.**', 'keep both'),
      reply('r1', '**Two ways to theme it.**\n\n**Decide:** keep both themes or only the light one?'),
    ]);
    expect(groups.decided).toEqual([{ text: 'Keep both themes or only the light one?', context: 'Two ways to theme it.', answer: 'keep both', replyId: 'r1' }]);
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
    expect(groups.done.map((i) => i.text)).toEqual(['Export button added to the toolbar.', 'The settings file is written.']);
  });

  it('shows the newest Doing line as In progress, and skips one that says nothing is running', () => {
    const running = confirmedItems([reply('r2', '**Halfway.**\n\n**Doing:** building the export\n**Next:** test it'), reply('r1', '**Doing:** old work')]);
    expect(running.progress).toEqual([{ text: 'Building the export', context: 'Halfway.', pill: 'In progress', replyId: 'r2' }]);
    for (const idle of ['nothing running', 'Nothing pending', 'nothing']) {
      expect(confirmedItems([reply('r1', `**Doing:** ${idle}`)]).progress).toEqual([]);
    }
  });

  it('ignores labels inside code fences', () => {
    const markdown = ['**Example.**', '', '```md', '**Checked:** not real', '**Done:** not real', '**Decide:** not real', '**Doing:** not real', '```'].join('\n');
    const groups = confirmedItems([reply('r1', markdown)]);
    expect(confirmedCount(groups)).toBe(0);
  });

  it('lists every picture a reply shows under Screens, newest reply first, never one inside a code fence', () => {
    const groups = confirmedItems([
      reply('r2', ['**The settings page.**', '', '![settings](shots/settings.png)', '', 'Also `/tmp/shots/dark.png` and https://example.com/web.png'].join('\n')),
      reply('r1', ['**The toolbar.**', '', 'Saved to ~/shots/toolbar.png.', '', '```', '![fenced](shots/fenced.png)', '/tmp/shots/fenced.png', '```'].join('\n')),
    ]);
    expect(groups.screens).toEqual([
      { text: 'shots/settings.png', image: 'shots/settings.png', context: 'The settings page.', replyId: 'r2' },
      { text: '/tmp/shots/dark.png', image: '/tmp/shots/dark.png', context: 'The settings page.', replyId: 'r2' },
      { text: '~/shots/toolbar.png', image: '~/shots/toolbar.png', context: 'The toolbar.', replyId: 'r1' },
    ]);
  });

  it('lists Verified lines under Features, joined and outside code', () => {
    const groups = confirmedItems([reply('r1', ['**Export works.**', '', '**Verified:** export writes a CSV', 'with a header row.', '', '```', '**Verified:** not real', '```'].join('\n'))]);
    expect(groups.features).toEqual([{ text: 'Export writes a CSV with a header row.', context: 'Export works.', replyId: 'r1' }]);
    expect(groups.facts).toEqual([]);
  });

  it('capitalises an item that starts with a lowercase letter, leaving code and bold as written', () => {
    const groups = confirmedItems([reply('r1', '**Checked:** the build passes\n\n**Checked:** `npm test` passes\n\n**Done:** **all** of it')]);
    expect(groups.facts.map((i) => i.text)).toEqual(['The build passes', '`npm test` passes']);
    expect(groups.done.map((i) => i.text)).toEqual(['**all** of it']);
  });

  it('leaves a prose "Done:" alone; only the bold label counts', () => {
    expect(confirmedItems([reply('r1', 'Done: this is just a sentence.')]).done).toEqual([]);
  });
});
