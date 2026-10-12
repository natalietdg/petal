// "conclude": which prompts count, how Claude's block is read, and which answer a session keeps.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isConcludePrompt, parseConclusion } from '../src/shared/conclusion';
import { addEntry, currentConclusion, emptyScan, scanFile } from '../src/main/conclusion-scan';
import type { TranscriptEntry } from '../src/main/transcript-entry';
import { assistantEntry, removeTempDirs, tempDir, toolResultEntry, toolUseEntry, useTempUserData, userEntry, writeJsonl } from './helpers';

afterEach(() => {
  removeTempDirs();
  vi.useRealTimers();
});

const BLOCK = [
  '**Conclusion:** The banner ships behind no flag.',
  '**Result:** Petal shows a banner on concluded sessions.',
  '**Impact:** She sees where every session landed at a glance.',
].join('\n');

describe('isConcludePrompt', () => {
  it.each(['conclude', 'Conclude', 'CONCLUDE.', ' conclude! ', 'conclude: shipped', 'conclude:shipped', 'conclude - shipped the banner', 'conclude — parked', 'conclude, wrap it up'])(
    'matches %j', (prompt) => expect(isConcludePrompt(prompt)).toBe(true));

  it.each(['conclude the refactor later', 'concluded', 'conclusion', 'please conclude', 'we can conclude: maybe', '', `conclude: ${'x'.repeat(80)}`])(
    'leaves %j alone', (prompt) => expect(isConcludePrompt(prompt)).toBe(false));

  it('a paste sent with it makes it an ordinary prompt', () => {
    expect(isConcludePrompt('<pasted_content id="1">long log</pasted_content id="1">conclude')).toBe(false);
  });
});

describe('parseConclusion', () => {
  const want = { title: '', conclusion: 'The banner ships behind no flag.', result: 'Petal shows a banner on concluded sessions.', impact: 'She sees where every session landed at a glance.', at: null };

  it('reads the bold-colon block', () => expect(parseConclusion(BLOCK)).toEqual(want));

  it('reads **Label.**, **Label**:, plain Label: and extra spacing alike', () => {
    const variants = [
      BLOCK.replace(/:\*\*/g, '.**'),
      BLOCK.replace(/:\*\*/g, '**:'),
      BLOCK.replace(/\*\*/g, ''),
      BLOCK.split('\n').map((line) => `   ${line.replace(':**', ':**   ')}  `).join('\n\n\n'),
      BLOCK.split('\n').map((line) => `- ${line}`).join('\n'),
    ];
    for (const reply of variants) expect(parseConclusion(reply)).toEqual(want);
  });

  it('keeps a title line above the labels and stops at the end of each paragraph', () => {
    const reply = `**Session conclusion banner**\n\n${BLOCK.replace('flag.', 'flag,\nand no setting.')}\n\nAnything else after a blank line is not part of Impact.`;
    expect(parseConclusion(reply, '2026-10-12T10:00:00.000Z')).toEqual({
      ...want, title: 'Session conclusion banner', conclusion: 'The banner ships behind no flag, and no setting.', at: '2026-10-12T10:00:00.000Z',
    });
  });

  it('reads ## headings with the text below', () => {
    expect(parseConclusion('## Conclusion\n\nSettled.\n\n## Result\nShipped.\n\n## Impact\n\nCalmer.')).toMatchObject({ conclusion: 'Settled.', result: 'Shipped.', impact: 'Calmer.' });
  });

  it('leaves missing fields empty', () => {
    expect(parseConclusion('**Conclusion:** Settled.\n**Impact:** Calmer.')).toMatchObject({ conclusion: 'Settled.', result: '', impact: 'Calmer.' });
  });

  it('strips inline markdown from the text', () => {
    expect(parseConclusion('**Result:** `conclusions.json` now holds **every** session.')?.result).toBe('conclusions.json now holds every session.');
  });

  it('falls back to the first paragraph when no label is there', () => {
    expect(parseConclusion('\n\nWe settled on **option B**.\nIt is cheaper.\n\nMore detail.')).toEqual({ title: '', conclusion: 'We settled on option B. It is cheaper.', result: '', impact: '', at: null });
  });

  it('a word like "Results" in prose is not a label', () => {
    expect(parseConclusion('Results were mixed.\n\nResult of the run was fine.')?.conclusion).toBe('Results were mixed.');
  });

  it('an empty reply has no conclusion', () => expect(parseConclusion('  \n ')).toBeNull());
});

const queued = (prompt: string): TranscriptEntry => ({ type: 'attachment', uuid: `q-${prompt}`, attachment: { type: 'queued_command', prompt, commandMode: 'prompt', origin: { kind: 'human' } } });
const handback = userEntry('Another Claude session reports back.', { uuid: 'hb', isMeta: true, origin: { kind: 'peer', handback: true } });
const scan = (entries: TranscriptEntry[]) => {
  const state = emptyScan();
  entries.forEach((entry) => addEntry(state, entry));
  return currentConclusion(state);
};

describe('the session scan', () => {
  it('takes Claude’s reply to the conclude prompt, across text, tool use and tool results', () => {
    const c = scan([
      userEntry('build it'), assistantEntry('Built.'),
      userEntry('conclude', { timestamp: '2026-10-12T09:00:00.000Z' }),
      assistantEntry('**Conclusion:** Built.', 'c1', { timestamp: '2026-10-12T09:00:05.000Z' }), toolUseEntry(), toolResultEntry(),
      assistantEntry('**Result:** A banner.\n**Impact:** Clarity.', 'c2'),
    ]);
    expect(c).toEqual({ title: '', conclusion: 'Built.', result: 'A banner.', impact: 'Clarity.', at: '2026-10-12T09:00:05.000Z' });
  });

  it('no conclude, no conclusion; a sentence starting with conclude is not one', () => {
    expect(scan([userEntry('hi'), assistantEntry('**Conclusion:** not asked for.')])).toBeNull();
    expect(scan([userEntry('conclude the refactor later'), assistantEntry('**Conclusion:** no.')])).toBeNull();
  });

  it('the latest conclude wins, and the next prompt ends the answer', () => {
    const c = scan([
      userEntry('conclude'), assistantEntry('**Conclusion:** First.'),
      userEntry('one more fix'), assistantEntry('**Conclusion:** not this, she did not ask.'),
      userEntry('conclude: again'), assistantEntry('**Conclusion:** Second.'),
    ]);
    expect(c?.conclusion).toBe('Second.');
  });

  it('a conclude Claude never answered keeps the earlier conclusion', () => {
    expect(scan([userEntry('conclude'), assistantEntry('**Conclusion:** First.'), userEntry('conclude'), userEntry('never mind')])?.conclusion).toBe('First.');
  });

  it('a conclude queued while Claude worked counts, and ends the reply before it', () => {
    const c = scan([userEntry('long task'), assistantEntry('Working.'), queued('conclude'), assistantEntry('**Conclusion:** Queued one.')]);
    expect(c?.conclusion).toBe('Queued one.');
  });

  it('a hand-back after the answer does not add the agent’s reply to it; one before the answer waits for it', () => {
    expect(scan([userEntry('conclude'), assistantEntry('**Conclusion:** Mine.'), handback, assistantEntry('The agent finished.')])).toMatchObject({ conclusion: 'Mine.', result: '' });
    expect(scan([userEntry('conclude'), handback, assistantEntry('**Conclusion:** After the hand-back.')])?.conclusion).toBe('After the hand-back.');
  });

  it('a wrapper turn (reminder) before the answer keeps the conclude waiting', () => {
    expect(scan([userEntry('conclude'), userEntry('<system-reminder>x</system-reminder>'), assistantEntry('**Conclusion:** Still mine.')])?.conclusion).toBe('Still mine.');
  });

  it('a reply without labels still concludes, with its first paragraph', () => {
    expect(scan([userEntry('conclude'), assistantEntry('We shipped it.\n\nDetails.')])?.conclusion).toBe('We shipped it.');
  });
});

describe('scanFile', () => {
  it('resumes from its offset and gives the same answer as one full read', async () => {
    const file = path.join(tempDir(), 's.jsonl');
    writeJsonl(file, [userEntry('conclude'), assistantEntry('**Conclusion:** First.')]);
    const first = await scanFile(file, emptyScan());
    expect(first.offset).toBe(fs.statSync(file).size);
    fs.appendFileSync(file, `${JSON.stringify(userEntry('conclude'))}\n${JSON.stringify(assistantEntry('**Conclusion:** Second.'))}`); // last line not finished yet
    const second = await scanFile(file, first);
    expect(currentConclusion(second)?.conclusion).toBe('First.');
    expect(second.pending).not.toBeNull();
    fs.appendFileSync(file, '\n');
    const third = await scanFile(file, second);
    expect(currentConclusion(third)?.conclusion).toBe('Second.');
    expect(currentConclusion(await scanFile(file, emptyScan()))).toEqual(currentConclusion(third));
  });
});

describe('conclusions store', () => {
  const load = async () => {
    vi.resetModules();
    return import('../src/main/conclusions-store');
  };

  it('stores per session in userData, re-reads only growth, and starts over on a rewritten log', async () => {
    const userData = useTempUserData();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = await load();
    const file = path.join(tempDir(), 'a.jsonl');
    writeJsonl(file, [userEntry('conclude'), assistantEntry('**Conclusion:** First.')]);
    expect((await store.refresh('a', file))?.conclusion).toBe('First.');
    expect(store.stored('a')?.conclusion).toBe('First.');

    fs.appendFileSync(file, `${JSON.stringify(userEntry('conclude'))}\n${JSON.stringify(assistantEntry('**Conclusion:** Second.'))}\n`);
    expect((await store.refresh('a', file))?.conclusion).toBe('Second.');

    writeJsonl(file, [userEntry('something else entirely, a new log'), assistantEntry('ok'), userEntry('conclude'), assistantEntry('**Conclusion:** Rewritten and longer than before.')]);
    expect((await store.refresh('a', file))?.conclusion).toBe('Rewritten and longer than before.');

    vi.runAllTimers();
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'conclusions.json'), 'utf8'));
    expect(saved.sessions.a.offset).toBe(fs.statSync(file).size);
    const reopened = await load();
    expect(reopened.stored('a')?.conclusion).toBe('Rewritten and longer than before.');
  });

  it('refreshAll reports once when something changed, and not when nothing did', async () => {
    useTempUserData();
    const store = await load();
    const dir = tempDir();
    const a = writeJsonl(path.join(dir, 'a.jsonl'), [userEntry('conclude'), assistantEntry('**Conclusion:** A.')]);
    const b = writeJsonl(path.join(dir, 'b.jsonl'), [userEntry('hi'), assistantEntry('hello')]);
    const onChanged = vi.fn();
    await store.refreshAll([{ sessionId: 'a', file: a }, { sessionId: 'b', file: b }], onChanged);
    await store.refreshAll([{ sessionId: 'a', file: a }, { sessionId: 'b', file: b }], onChanged);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(store.stored('b')).toBeNull();
  });
});
