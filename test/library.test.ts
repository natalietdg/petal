// The Library: parsing Claude's answer, merging into notes, safe reads, offsets, the switch and the gate, and sort and filter.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowClaudeFolder, assistantEntry, removeTempDirs, tempDir, useTempUserData, userEntry } from './helpers';
import { categoriesOf, filterEntries, letterOf, sortEntries, type LibraryEntry } from '../src/shared/library';

const store = () => import('../src/main/library-store');
const extract = () => import('../src/main/library-extract');
const envelope = (result: string) => JSON.stringify({ type: 'result', is_error: false, result });
const topic = (t: string, category: string, facts: string[], evidence = '') => ({ topic: t, category, facts, evidence });

afterEach(() => {
  delete process.env.PASTEL_SNAPSHOT;
  removeTempDirs();
  vi.resetModules();
});

describe('parseTopics', () => {
  it('reads the CLI envelope, prose and a fence around the JSON', async () => {
    const { parseTopics } = await extract();
    const reply = 'Here you go:\n```json\n{"topics": [{"topic": "Payout cutoff", "category": "Payments", "facts": ["- Payouts after 3pm settle next day."], "evidence": "user said so"}]}\n```';
    expect(parseTopics(envelope(reply))).toEqual([topic('Payout cutoff', 'Payments', ['Payouts after 3pm settle next day.'], 'user said so')]);
  });

  it('an empty list is fine; a bare array works too', async () => {
    const { parseTopics } = await extract();
    expect(parseTopics(envelope('{"topics": []}'))).toEqual([]);
    expect(parseTopics(envelope('[{"topic":"A","category":"Data","facts":["x is y"]}]'))).toHaveLength(1);
  });

  it('bad JSON, no JSON, an error envelope and an oversized reply throw', async () => {
    const { parseTopics, MAX_REPLY_CHARS } = await extract();
    expect(() => parseTopics(envelope('{"topics": [oops'))).toThrow();
    expect(() => parseTopics(envelope('nothing to add'))).toThrow(/No JSON/);
    expect(() => parseTopics(JSON.stringify({ is_error: true, result: 'rate limited' }))).toThrow(/Claude error/);
    expect(() => parseTopics('x'.repeat(MAX_REPLY_CHARS + 1))).toThrow(/too large/);
    expect(() => parseTopics(envelope('{"other": 1}'))).toThrow(/No topics/);
  });

  it('drops topics without a name or facts, and caps facts, topics and lengths', async () => {
    const { parseTopics } = await extract();
    const many = Array.from({ length: 20 }, (_, i) => ({ topic: `T${i}`, category: 'Data', facts: Array.from({ length: 30 }, (__, j) => `fact ${j}`) }));
    const parsed = parseTopics(envelope(JSON.stringify({ topics: [{ topic: '', facts: ['a'] }, { topic: 'No facts', facts: [] }, 'junk', ...many] })));
    expect(parsed).toHaveLength(8);
    expect(parsed[0]?.topic).toBe('T0');
    expect(parsed.every((t) => t.facts.length === 12)).toBe(true);
    const long = parseTopics(envelope(JSON.stringify({ topics: [{ topic: 'x'.repeat(300), category: 'y'.repeat(100), facts: ['z'.repeat(2000)] }] })));
    expect(long[0]?.topic.length).toBe(80);
    expect(long[0]?.category.length).toBe(32);
    expect(long[0]?.facts[0]?.length).toBe(500);
  });

  it('facts given as one Markdown string become bullets', async () => {
    const { parseTopics } = await extract();
    const parsed = parseTopics(envelope(JSON.stringify({ topics: [{ topic: 'Auth', category: 'Auth', facts: '- Tokens last 1h\n- Refresh tokens last 30d' }] })));
    expect(parsed[0]?.facts).toEqual(['Tokens last 1h', 'Refresh tokens last 30d']);
  });
});

describe('mergeTopics', () => {
  let dir: string;
  beforeEach(() => {
    useTempUserData();
    dir = tempDir('petal-library-');
  });
  const source = { sessionId: 'aaaaaaaa-0000-4000-8000-000000000001', date: '2026-10-16' };
  const now = new Date('2026-10-16T08:00:00.000Z');

  it('a new topic becomes a note with frontmatter, facts and evidence', async () => {
    const { mergeTopics, readDoc, listEntries } = await store();
    const result = mergeTopics([topic('Payout cutoff', 'payments', ['Payouts after 3pm settle next day.'], 'ops runbook')], source, { dir, now });
    expect(result).toEqual({ added: 1, updated: 0, slugs: ['payout-cutoff'] });
    const text = fs.readFileSync(path.join(dir, 'payout-cutoff.md'), 'utf8');
    expect(text).toContain('title: Payout cutoff\ncategory: Payments\nupdated: 2026-10-16T08:00:00.000Z\nsources:\n  - aaaaaaaa-0000-4000-8000-000000000001 2026-10-16\n---');
    expect(text).toContain('- Payouts after 3pm settle next day.');
    expect(text).toContain('## Evidence\n\n- 2026-10-16 · ops runbook');
    const doc = readDoc('payout-cutoff', dir);
    expect(doc).toMatchObject({ title: 'Payout cutoff', category: 'Payments', sources: [`${source.sessionId} 2026-10-16`] });
    expect(listEntries(dir)[0]).toMatchObject({ slug: 'payout-cutoff', category: 'Payments', sources: 1, preview: 'Payouts after 3pm settle next day.' });
  });

  it('the same topic again gains only facts it lacks, and the new source', async () => {
    const { mergeTopics, readDoc } = await store();
    mergeTopics([topic('Payout cutoff', 'Payments', ['Payouts after 3pm settle next day.'])], source, { dir, now });
    const again = mergeTopics([topic('payout CUTOFF', 'Other', ['payouts after 3PM settle next-day', 'Weekends roll to Monday.'])], { sessionId: 'bbbbbbbb-0000-4000-8000-000000000002', date: '2026-10-17' }, { dir, now });
    expect(again).toMatchObject({ added: 0, updated: 1 });
    const doc = readDoc('payout-cutoff', dir);
    if ('missing' in doc) throw new Error('missing');
    expect(doc.markdown.match(/^- /gm)).toHaveLength(2);
    expect(doc.markdown).toContain('- Weekends roll to Monday.');
    expect(doc.category).toBe('Payments'); // a later answer never recategorises
    expect(doc.sources).toHaveLength(2);
    const nothingNew = mergeTopics([topic('Payout cutoff', 'Payments', ['Weekends roll to Monday'])], source, { dir, now });
    expect(nothingNew).toMatchObject({ added: 0, updated: 0, slugs: [] });
  });

  it('a different title with the same slug gets its own file', async () => {
    const { mergeTopics } = await store();
    mergeTopics([topic('Auth tokens', 'Auth', ['Access tokens last one hour.'])], source, { dir, now });
    const second = mergeTopics([topic('Auth: tokens!', 'Auth', ['Tokens are JWTs.'])], source, { dir, now });
    expect(second.slugs).toEqual(['auth-tokens-2']);
    expect(fs.readdirSync(dir).sort()).toEqual(['auth-tokens-2.md', 'auth-tokens.md']);
  });

  it('categories reuse her spelling, then the starter list, before a new one', async () => {
    const { mergeTopics, canonicalCategory, listEntries } = await store();
    mergeTopics([topic('Ledger rows', 'Payroll Ops', ['Rows split by country code.'])], source, { dir, now });
    mergeTopics([topic('Pay runs', 'payroll ops', ['Pay runs close on the 25th.'])], source, { dir, now });
    expect(categoriesOf(listEntries(dir))).toEqual(['Payroll Ops']);
    expect(canonicalCategory('infra', [])).toBe('Infra');
    expect(canonicalCategory('  ', [])).toBe('General');
    expect(canonicalCategory('<script>', [])).toBe('Script');
  });

  it('never writes through a symlink', async () => {
    const { mergeTopics } = await store();
    const outside = tempDir('petal-outside-');
    fs.writeFileSync(path.join(outside, 'target.md'), 'hers');
    fs.symlinkSync(path.join(outside, 'target.md'), path.join(dir, 'secret.md'));
    const result = mergeTopics([topic('Secret', 'Data', ['A fact.'])], source, { dir, now });
    expect(result.slugs).toEqual(['secret-2']);
    expect(fs.readFileSync(path.join(outside, 'target.md'), 'utf8')).toBe('hers');
  });
});

describe('reading notes', () => {
  let dir: string;
  beforeEach(() => {
    useTempUserData();
    dir = tempDir('petal-library-');
  });

  it('refuses a symlink out of the folder, an oversized note and a bad slug', async () => {
    const { readDoc, listEntries, MAX_NOTE_BYTES } = await store();
    const outside = tempDir('petal-outside-');
    fs.writeFileSync(path.join(outside, 'private.md'), '---\ntitle: Private\n---\n- secret\n');
    fs.symlinkSync(path.join(outside, 'private.md'), path.join(dir, 'escape.md'));
    fs.writeFileSync(path.join(dir, 'huge.md'), `---\ntitle: Huge\n---\n${'- x\n'.repeat(MAX_NOTE_BYTES / 4 + 10)}`);
    fs.writeFileSync(path.join(dir, 'fine.md'), '---\ntitle: Fine\ncategory: Data\n---\n- ok\n');
    expect(readDoc('escape', dir)).toEqual({ missing: true });
    expect(readDoc('huge', dir)).toEqual({ missing: true });
    expect(readDoc('../etc/passwd', dir)).toEqual({ missing: true });
    expect(readDoc(42, dir)).toEqual({ missing: true });
    expect(listEntries(dir).map((e) => e.title)).toEqual(['Fine']);
  });

  it('a hand-written note without frontmatter still lists, under General', async () => {
    const { listEntries } = await store();
    fs.writeFileSync(path.join(dir, 'loose-notes.md'), '- one\n- two\n');
    expect(listEntries(dir)[0]).toMatchObject({ title: 'loose-notes', category: 'General', preview: 'one\ntwo' });
  });
});

describe('reading the log in chunks', () => {
  beforeEach(() => { useTempUserData(); });
  const line = (entry: object) => `${JSON.stringify(entry)}\n`;

  it('reads whole lines from the offset, and only prompts and replies', async () => {
    const { readChunk } = await extract();
    const file = path.join(tempDir(), 's.jsonl');
    fs.writeFileSync(file, line(userEntry('how do payouts work?')) + line({ type: 'system', content: 'noise' }) + line(assistantEntry('Payouts settle T+1.')));
    const first = readChunk(file, 0);
    expect(first.digest).toBe('User: how do payouts work?\nClaude: Payouts settle T+1.');
    expect(first.atEnd).toBe(true);
    expect(readChunk(file, first.next).digest).toBe('');
    fs.appendFileSync(file, line(userEntry('and refunds?')) + '{"type":"user","partial'); // a half-written last line waits
    const second = readChunk(file, first.next);
    expect(second.digest).toBe('User: and refunds?');
    expect(second.atEnd).toBe(false);
  });

  it('stops where the digest is full, so the rest comes next time', async () => {
    const { readChunk } = await extract();
    const file = path.join(tempDir(), 's.jsonl');
    fs.writeFileSync(file, [1, 2, 3].map((n) => line(userEntry(`question ${n} ${'x'.repeat(40)}`))).join(''));
    const first = readChunk(file, 0, { digestChars: 100 });
    expect(first.digest.split('\n')).toHaveLength(1);
    const second = readChunk(file, first.next, { digestChars: 100 });
    expect(second.digest).toContain('question 2');
  });

  it('a log shorter than the offset is read from the start', async () => {
    const { readChunk } = await extract();
    const file = path.join(tempDir(), 's.jsonl');
    fs.writeFileSync(file, line(userEntry('fresh')));
    expect(readChunk(file, 10_000).digest).toBe('User: fresh');
  });
});

describe('the queue', () => {
  let log: string;
  const reply = envelope(JSON.stringify({ topics: [topic('Payout cutoff', 'Payments', ['Payouts after 3pm settle next day.'])] }));

  async function setUp(config: object) {
    process.env.PASTEL_SNAPSHOT = '1';
    const userData = allowClaudeFolder();
    fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ claudeFolder: { choice: 'allowed' }, ...config }));
    log = path.join(tempDir(), 'session.jsonl');
    fs.writeFileSync(log, `${JSON.stringify(userEntry('when do payouts settle?'))}\n${JSON.stringify(assistantEntry('After 3pm they settle the next day.'))}\n`);
    const mode = await import('../src/main/snapshot-mode');
    const calls: string[] = [];
    mode.libraryFixture.extract = async (prompt) => { calls.push(prompt); return reply; };
    return { calls, userData, mode };
  }
  const target = () => ({ sessionId: 'cccccccc-0000-4000-8000-000000000003', transcript: log });

  it('with the switch on, runs once, writes the note, and never re-reads what it read', async () => {
    const { calls, userData } = await setUp({ library: { autoBuild: true } });
    const { queueSession, loadOffsets } = await extract();
    expect(await queueSession(target())).toEqual({ added: 1, updated: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('User: when do payouts settle?');
    expect(calls[0]).toContain('NOT task status');
    expect(fs.existsSync(path.join(userData, 'library', 'payout-cutoff.md'))).toBe(true);
    expect(loadOffsets()[target().sessionId]?.offset).toBe(fs.statSync(log).size);
    expect(await queueSession(target())).toEqual({ added: 0, updated: 0 });
    expect(calls).toHaveLength(1); // nothing new in the log, so no call
    fs.appendFileSync(log, `${JSON.stringify(userEntry('and on weekends?'))}\n`);
    await queueSession(target());
    expect(calls).toHaveLength(2);
    expect(calls[1]).not.toContain('when do payouts settle?');
  });

  it('with the switch off, nothing runs unless forced', async () => {
    const { calls } = await setUp({});
    const { queueSession, harvest } = await extract();
    expect(await queueSession(target())).toMatchObject({ skipped: 'Build my Library is off' });
    harvest(target());
    await queueSession(target()); // waits behind the harvest
    expect(calls).toHaveLength(0);
    expect(await queueSession(target(), { force: true })).toMatchObject({ added: 1 });
    expect(calls).toHaveLength(1);
  });

  it('with the Claude folder not allowed, nothing runs even when forced', async () => {
    const { calls, userData } = await setUp({ library: { autoBuild: true } });
    fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ claudeFolder: { choice: 'declined' }, library: { autoBuild: true } }));
    const { queueSession } = await extract();
    expect(await queueSession(target(), { force: true })).toMatchObject({ skipped: expect.stringContaining('Claude folder') });
    expect(calls).toHaveLength(0);
  });

  it('a bad answer is logged, keeps the offset, and is retried next time', async () => {
    const { calls, mode } = await setUp({ library: { autoBuild: true } });
    mode.libraryFixture.extract = async (prompt) => { calls.push(prompt); return envelope('not json'); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { queueSession, loadOffsets } = await extract();
    expect((await queueSession(target())).skipped).toMatch(/couldn’t read/);
    expect(loadOffsets()[target().sessionId]).toBeUndefined();
    mode.libraryFixture.extract = async (prompt) => { calls.push(prompt); return reply; };
    expect(await queueSession(target())).toMatchObject({ added: 1 });
    vi.restoreAllMocks();
  });

  it('runs one at a time', async () => {
    const { mode } = await setUp({ library: { autoBuild: true } });
    let inFlight = 0;
    let most = 0;
    mode.libraryFixture.extract = async () => { inFlight += 1; most = Math.max(most, inFlight); await new Promise((r) => setTimeout(r, 20)); inFlight -= 1; return envelope('{"topics": []}'); };
    const { queueSession } = await extract();
    const other = path.join(path.dirname(log), 'other.jsonl');
    fs.copyFileSync(log, other);
    await Promise.all([queueSession(target()), queueSession({ sessionId: 'dddddddd-0000-4000-8000-000000000004', transcript: other })]);
    expect(most).toBe(1);
  });

  it('the snapshot run without a stub never calls anything', async () => {
    const { mode } = await setUp({ library: { autoBuild: true } });
    mode.libraryFixture.extract = null;
    const { queueSession } = await extract();
    expect(await queueSession(target())).toMatchObject({ skipped: 'snapshot run' });
    expect(mode.counters.libraryRunsSkipped).toBe(1);
  });
});

describe('sort and filter', () => {
  const entry = (title: string, category: string, updatedMs: number, preview = ''): LibraryEntry =>
    ({ slug: title.toLowerCase().replace(/\W+/g, '-'), title, category, updated: new Date(updatedMs).toISOString(), updatedMs, sources: 1, preview });
  const all = [entry('beta', 'Data', 3), entry('Alpha', 'Auth', 1, 'tokens last an hour'), entry('Gamma', 'data', 2), entry('2FA codes', 'Auth', 4)];

  it('A to Z ignores case; Z to A reverses it; recent is newest first', () => {
    expect(sortEntries(all, 'az').map((e) => e.title)).toEqual(['2FA codes', 'Alpha', 'beta', 'Gamma']);
    expect(sortEntries(all, 'za').map((e) => e.title)).toEqual(['Gamma', 'beta', 'Alpha', '2FA codes']);
    expect(sortEntries(all, 'recent').map((e) => e.title)).toEqual(['2FA codes', 'beta', 'Gamma', 'Alpha']);
  });

  it('category matches any case; words match title, category or preview', () => {
    expect(filterEntries(all, { category: 'DATA', text: '' }).map((e) => e.title)).toEqual(['beta', 'Gamma']);
    expect(filterEntries(all, { category: null, text: 'hour tokens' }).map((e) => e.title)).toEqual(['Alpha']);
    expect(filterEntries(all, { category: 'Auth', text: 'codes' }).map((e) => e.title)).toEqual(['2FA codes']);
    expect(categoriesOf(all)).toEqual(['Auth', 'Data']);
    expect([letterOf('alpha'), letterOf('2FA')]).toEqual(['A', '#']);
  });
});
