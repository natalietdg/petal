// The Library's gaps: near-duplicate titles (SI for Settlement Instruction), her edits to notes, the trash and Tidy duplicates.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';
import { aliasesFrom, findDuplicates, likeness, topicKey } from '../src/shared/library-titles';

const store = () => import('../src/main/library-store');
const source = { sessionId: 'eeeeeeee-0000-4000-8000-000000000005', date: '2026-10-16' };
const topic = (t: string, category: string, facts: string[]) => ({ topic: t, category, facts, evidence: '' });

afterEach(() => {
  removeTempDirs();
  vi.resetModules();
});

// Her real pairs, with the country code kept (it is not personal).
const PAIRS = [
  ['VN SI email', 'VN Settlement Instruction email'],
  ['VN SI layout and labels', 'VN Settlement Instruction layout'],
  ['VN Settlement Instruction numbering', 'Settlement instruction numbering'],
  ['VN SI bank details', 'VN Settlement Instruction issuer details'],
] as const;
const ALL_TITLES = PAIRS.flat();

describe('when two titles are the same topic', () => {
  it('an abbreviation another title spells out counts as those words', () => {
    const aliases = aliasesFrom(ALL_TITLES);
    expect(aliases.get('si')).toEqual(['settlement', 'instruction']);
    expect(topicKey('VN SI email', aliases)).toBe(topicKey('VN Settlement Instruction email', aliases));
    expect(topicKey('VN SI email', aliases)).toBe('vn settlement instruction email');
  });

  it('case, punctuation, plurals and small words do not make a new topic', () => {
    const aliases = aliasesFrom([]);
    expect(topicKey('Payout cut-off times', aliases)).toBe(topicKey('payout cut off time', aliases));
    expect(topicKey('Layout and labels', aliases)).toBe(topicKey('layout label', aliases));
  });

  it('her four pairs: one the same, three near', () => {
    const aliases = aliasesFrom(ALL_TITLES);
    expect(PAIRS.map(([a, b]) => likeness(a, b, aliases))).toEqual(['same', 'near', 'near', 'near']);
  });

  it('different topics stay apart', () => {
    const aliases = aliasesFrom(['Settlement batches', 'Settlement instructions for cross-border payouts', 'ACH return codes', 'Carrier status codes']);
    expect(likeness('Settlement batches', 'Settlement instructions for cross-border payouts', aliases)).toBeNull();
    expect(likeness('ACH return codes', 'Carrier status codes', aliases)).toBeNull();
    expect(likeness('Access token lifetime', 'Session cookies', aliases)).toBeNull();
  });

  it('Tidy duplicates pairs them within a category only, keeps the fuller note, and skips pairs kept both', () => {
    const note = (slug: string, title: string, category = 'Payments', facts = 1, sources = 1) => ({ slug, title, category, facts, sources });
    const notes = [
      note('a', 'VN SI email'), note('b', 'VN Settlement Instruction email', 'Payments', 3, 2),
      note('c', 'VN Settlement Instruction numbering', 'Payments', 4), note('d', 'Settlement instruction numbering'),
      note('e', 'VN SI bank details', 'Data'), note('f', 'VN Settlement Instruction issuer details'),
      note('g', 'Refund windows'),
    ];
    const pairs = findDuplicates(notes);
    expect(pairs.map((p) => [p.keep.slug, p.fold.slug])).toEqual([['c', 'd'], ['b', 'a']]);
    expect(findDuplicates(notes, new Set(['a|b'])).map((p) => p.keep.slug)).toEqual(['c']);
  });
});

describe('merging an extracted topic', () => {
  it('a topic worded with the abbreviation lands in the existing note', async () => {
    useTempUserData();
    const dir = tempDir();
    const { mergeTopics, readNotes } = await store();
    mergeTopics([topic('VN Settlement Instruction email', 'Payments', ['The SI email goes to the finance inbox.'])], source, { dir });
    const result = mergeTopics([topic('VN SI email', 'Payments', ['It is sent at 9am local time.'])], source, { dir });
    expect(result).toMatchObject({ added: 0, updated: 1 });
    const notes = readNotes(dir);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.facts).toContain('9am');
  });

  it('the extractor is told the existing titles and to reuse them', async () => {
    useTempUserData();
    const dir = tempDir();
    const { mergeTopics, knownTopics } = await store();
    mergeTopics([topic('VN Settlement Instruction email', 'Payments', ['The SI email goes to the finance inbox.'])], source, { dir });
    const known = knownTopics(dir);
    expect(known).toBe('- VN Settlement Instruction email (Payments): The SI email goes to the finance inbox.');
    const { promptFor } = await import('../src/main/library-extract');
    const prompt = promptFor('User: hi', ['Payments'], known);
    expect(prompt).toContain('use that exact title');
    expect(prompt).toContain('SI and Settlement Instruction are the same topic');
    expect(prompt).toContain(known);
    expect(promptFor('User: hi', [])).not.toContain('already has these notes');
  });
});

describe('her edits', () => {
  async function seeded() {
    useTempUserData();
    const dir = tempDir();
    const s = await store();
    s.mergeTopics([topic('VN SI email', 'Payments', ['Sent at 9am.', 'Goes to finance.'])], source, { dir });
    s.mergeTopics([topic('Settlement emails', 'Payments', ['goes to FINANCE', 'Has a PDF attached.'])], { ...source, sessionId: 'ffffffff-0000-4000-8000-000000000006' }, { dir });
    return { dir, s };
  }

  it('rename keeps facts and moves the file to the new slug', async () => {
    const { dir, s } = await seeded();
    expect(s.renameNote('vn-si-email', 'VN Settlement Instruction email', { dir })).toEqual({ slug: 'vn-settlement-instruction-email' });
    expect(fs.existsSync(path.join(dir, 'vn-si-email.md'))).toBe(false);
    expect(s.readDoc('vn-settlement-instruction-email', dir)).toMatchObject({ title: 'VN Settlement Instruction email', markdown: expect.stringContaining('Sent at 9am.') });
    expect(s.renameNote('vn-settlement-instruction-email', '   ', { dir })).toEqual({ error: 'A title is needed' });
    expect(s.renameNote('../escape', 'x', { dir })).toEqual({ error: 'That note is gone' });
  });

  it('a rename onto a taken slug gets the next free one', async () => {
    const { dir, s } = await seeded();
    expect(s.renameNote('vn-si-email', 'Settlement emails', { dir })).toEqual({ slug: 'settlement-emails-2' });
  });

  it('change category reuses her spelling', async () => {
    const { dir, s } = await seeded();
    s.setCategory('settlement-emails', 'Messaging', { dir });
    expect(s.setCategory('vn-si-email', 'messaging', { dir })).toEqual({ slug: 'vn-si-email' });
    expect(s.readDoc('vn-si-email', dir)).toMatchObject({ category: 'Messaging' });
  });

  it('delete moves the note to .trash and Undo brings it back', async () => {
    const { dir, s } = await seeded();
    const now = new Date('2026-10-16T08:00:00Z');
    const deleted = s.deleteNote('vn-si-email', { dir, now });
    expect(deleted).toEqual({ slug: 'vn-si-email', trashId: `vn-si-email.${now.getTime()}` });
    expect(s.listEntries(dir).map((e) => e.slug)).toEqual(['settlement-emails']);
    expect(fs.existsSync(path.join(dir, '.trash', `vn-si-email.${now.getTime()}.md`))).toBe(true);
    expect(s.restoreNote((deleted as { trashId: string }).trashId, { dir })).toEqual({ slug: 'vn-si-email' });
    expect(s.listEntries(dir)).toHaveLength(2);
    expect(s.restoreNote('../../etc/passwd', { dir })).toEqual({ error: 'Nothing to undo' });
  });

  it('merge unions the facts without repeats, combines sources, and trashes the folded note', async () => {
    const { dir, s } = await seeded();
    const merged = s.mergeNotes('settlement-emails', 'vn-si-email', { dir });
    expect(merged).toMatchObject({ slug: 'vn-si-email', trashId: expect.stringMatching(/^settlement-emails\.\d{13}$/) });
    const doc = s.readDoc('vn-si-email', dir) as { markdown: string; sources: string[] };
    expect(doc.markdown.match(/^- /gm)).toHaveLength(3); // "goes to FINANCE" is the same fact as "Goes to finance."
    expect(doc.markdown).toContain('Has a PDF attached.');
    expect(doc.sources).toHaveLength(2);
    expect(s.listEntries(dir).map((e) => e.slug)).toEqual(['vn-si-email']);
    expect(s.mergeNotes('vn-si-email', 'vn-si-email', { dir })).toEqual({ error: 'Pick another note' });
  });

  it('never writes through a symlinked trash or note', async () => {
    const { dir, s } = await seeded();
    const outside = tempDir();
    fs.symlinkSync(outside, path.join(dir, '.trash'));
    expect(s.deleteNote('vn-si-email', { dir })).toEqual({ error: 'Couldn’t move it to the trash' });
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.symlinkSync(path.join(outside, 'x.md'), path.join(dir, 'linked.md'));
    expect(s.renameNote('linked', 'New', { dir })).toEqual({ error: 'That note is gone' });
  });

  it('Keep both is remembered, so the pair is not offered again', async () => {
    const { dir, s } = await seeded();
    s.renameNote('settlement-emails', 'VN Settlement Instruction email', { dir });
    expect(s.duplicates({ dir })).toHaveLength(1);
    expect(s.keepBoth('vn-si-email', 'vn-settlement-instruction-email', { dir })).toEqual({ ok: true });
    expect(s.duplicates({ dir })).toEqual([]);
  });
});
