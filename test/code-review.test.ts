// Code review: changes read from a transcript per turn, split into functions, the reviewer's JSON checked, answers cached.
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodeChangeCollector } from '../src/main/code-changes';
import { functionUnits, pluginsFor, splitChange } from '../src/main/code-functions';
import { ReplyCollector } from '../src/main/replies';
import { readTurns } from '../src/main/handoff';
import { cachedAnswers, saveAnswers, turnHash } from '../src/main/code-review-store';
import { codeTurns } from '../src/main/code-review-index';
import { cancelRun, explain, turnReview } from '../src/main/code-review';
import { answerJson, reviewerArgs } from '../src/main/code-review-run';
import { codeReviewFixture } from '../src/main/snapshot-mode';
import { cacheKey, checkAnswers, groupTaskChanges, isSecretPath, redactSecrets, type FunctionCard, type TaskChange } from '../src/shared/code-review';
import { compactDiff, diffLines } from '../src/shared/line-diff';
import { CWD, FILE, NEW_TOTAL, REASON, sessionEntries } from './fixtures/code-review';
import { removeTempDirs, tempDir, useTempUserData, writeJsonl } from './helpers';

afterEach(removeTempDirs);

const collect = (readCurrent?: (file: string) => string | null) => {
  const c = new CodeChangeCollector(readCurrent);
  for (const entry of sessionEntries()) c.add(entry);
  return c.changed();
};

describe('reading code changes from a transcript', () => {
  it('keys each turn by the reader reply it belongs to', () => {
    const replies = new ReplyCollector();
    for (const entry of sessionEntries()) replies.add(entry);
    const readerIds = replies.newestFirst().map((r) => r.id).reverse();
    expect(collect().map((t) => t.replyId)).toEqual(readerIds);
    expect(collect().map((t) => t.turnId)).toEqual(['u1', 'u2']);
  });

  it('matches History’s turn index', async () => {
    const file = writeJsonl(path.join(tempDir(), 's.jsonl'), sessionEntries());
    const history = await readTurns(file);
    const turns = collect();
    expect(turns.map((t) => history[t.historyIndex]?.prompt)).toEqual(['the cart total ignores quantity, fix it', 'also add a remove method and a README note']);
  });

  it('counts only edits that applied, and leaves secrets files out by name', () => {
    const [first] = collect();
    expect(first.cards.map((c) => `${c.display} ${c.name}`)).toEqual(['src/cart.ts total']);
    expect(first.skipped).toEqual(['/repo/.env.local']);
    expect(first.cards[0].after).toContain(NEW_TOTAL);
    expect(first.cards[0].before).toContain("// The cart's total, in cents."); // a function's leading comment is part of it
  });

  it('keeps the text and non-empty thinking around each change as numbered reasoning', () => {
    const [first, second] = collect();
    expect(first.reasoning).toEqual([
      { id: 1, kind: 'text', text: REASON },
      { id: 2, kind: 'text', text: 'Fixed: the total now counts quantity.' },
    ]);
    expect(first.cards[0].reasoning).toBe(1); // written after R1 only
    expect(second.reasoning.map((r) => r.kind)).toEqual(['thinking', 'text']);
  });

  it('splits a MultiEdit into its functions and the module level; a new non-code file is one hunk', () => {
    const second = collect()[1];
    expect(second.cards.map((c) => [c.name, c.kind])).toEqual([
      ['Cart.remove', 'function'],
      ['Module level', 'module'],
      ['Changed lines', 'hunk'],
    ]);
    expect(second.cards[0].before).toBe('');
    expect(second.cards[1].after).toContain("import type { Item } from './item';");
    expect(second.cards[2].note).toMatch(/TypeScript and JavaScript only/);
  });

  it('rebuilds the before from the file on disk when the transcript has no original', () => {
    const entries = sessionEntries().map((e) => (e.uuid === 'r1' ? { ...e, toolUseResult: { filePath: FILE } } : e));
    const onDisk = `export function total(items) {\n  ${NEW_TOTAL}\n}\n`;
    const c = new CodeChangeCollector((file) => (file === FILE ? onDisk : null));
    for (const entry of entries) c.add(entry);
    const card = c.changed()[0].cards[0];
    expect(card.name).toBe('total');
    expect(card.after).toContain(NEW_TOTAL);
  });

  it('says so when neither the original nor the file is there', () => {
    const entries = sessionEntries().map((e) => (e.uuid === 'r1' ? { ...e, toolUseResult: {} } : e));
    const c = new CodeChangeCollector(() => null);
    for (const entry of entries) c.add(entry);
    const card = c.changed()[0].cards[0];
    expect(card.kind).toBe('hunk');
    expect(card.note).toMatch(/full file wasn’t available/);
  });

  it('reads a log incrementally: appended turns show up on the next ask', async () => {
    const file = path.join(tempDir(), 'live.jsonl');
    const entries = sessionEntries();
    writeJsonl(file, entries.slice(0, 10));
    expect((await codeTurns(file)).map((t) => t.turnId)).toEqual(['u1']);
    writeJsonl(file, entries);
    expect((await codeTurns(file)).map((t) => t.turnId)).toEqual(['u1', 'u2']);
  });

  it('displays paths inside the session folder relative to it', () => {
    expect(collect()[0].cards[0].display).toBe(path.relative(CWD, FILE));
  });
});

describe('splitting a change into functions', () => {
  const before = [
    "import a from 'a';",
    'export const handler = async (req: Req) => {',
    '  return ok(req);',
    '};',
    'class Store {',
    '  get size(): number { return 1; }',
    '  save = () => write();',
    '  load() { return read(); }',
    '}',
    'const api = { list() { return []; }, name: "x" };',
    "describe('cart', () => { it('adds', () => {}); });",
    'function gone() {}',
  ].join('\n');

  it('finds functions, methods, function-valued properties and top-level calls by name', () => {
    expect(functionUnits(before, pluginsFor('x.ts') ?? [])?.map((u) => u.name)).toEqual([
      'handler', 'Store.size (get)', 'Store.save', 'Store.load', 'api.list', "describe('cart')", 'gone',
    ]);
  });

  it('cards only what changed: edited, added and removed functions', () => {
    const after = before.replace('return read();', 'return read(true);').replace('function gone() {}', 'function fresh() {}');
    const cards = splitChange('x.ts', before, after);
    expect(cards.map((c) => [c.name, Boolean(c.before), Boolean(c.after)])).toEqual([
      ['Store.load', true, true],
      ['fresh', false, true],
      ['gone', true, false],
    ]);
  });

  it('puts top-level changes outside functions in one module level card', () => {
    const cards = splitChange('x.ts', before, before.replace("import a from 'a';", "import a from 'a';\nimport b from 'b';"));
    expect(cards.map((c) => c.kind)).toEqual(['module']);
    expect(cards[0].after).toContain("import b from 'b';");
  });

  it('numbers repeated names so each is its own card', () => {
    expect(functionUnits('function f() {}\nfunction f(x) {}', ['typescript'])?.map((u) => u.name)).toEqual(['f', 'f#2']);
  });

  it('falls back to a labelled hunk for other languages and for code that won’t parse', () => {
    expect(splitChange('a.py', 'x = 1', 'x = 2')[0]).toMatchObject({ kind: 'hunk', note: expect.stringMatching(/TypeScript and JavaScript only/) });
    expect(splitChange('a.ts', 'const = ;;; {{{', 'function x() {}')[0]).toMatchObject({ kind: 'hunk', note: expect.stringMatching(/didn’t parse/) });
  });

  it('parses JSX in .tsx files', () => {
    expect(functionUnits('export function View() { return <div>{1}</div>; }', pluginsFor('v.tsx') ?? [])?.map((u) => u.name)).toEqual(['View']);
  });
});

describe('the reviewer’s answers', () => {
  const reasoning = [{ id: 1, kind: 'text' as const, text: 'Multiply by qty and round once at the end.' }];
  const ids = new Map([['F1', 'a::f'], ['F2', 'a::g']]);
  const good = { shape: 'reduce', driver: 'qty was ignored', alternatives: 'a loop', risk: 'none seen' };

  it('takes one answer per id and keeps a recorded basis only when the quote is really in the reasoning', () => {
    const check = checkAnswers({ answers: [
      { id: 'F1', ...good, basis: 'recorded', quote: 'round once at the end' },
      { id: 'F2', ...good, basis: 'recorded', quote: 'something the session never said' },
    ] }, ids, reasoning);
    expect(check.answers['a::f']).toMatchObject({ basis: 'recorded', quote: 'round once at the end' });
    expect(check.answers['a::g']).toMatchObject({ basis: 'inferred', quote: null });
    expect(check.missing).toEqual([]);
  });

  it('reports missing answers and ignores extra or repeated ids', () => {
    const check = checkAnswers({ answers: [
      { id: 'F1', ...good, basis: 'inferred', quote: null },
      { id: 'F1', ...good, basis: 'inferred', quote: null },
      { id: 'F9', ...good, basis: 'inferred', quote: null },
    ] }, ids, reasoning);
    expect(Object.keys(check.answers)).toEqual(['a::f']);
    expect(check.missing).toEqual(['a::g']);
    expect(check.extra).toEqual(['F1', 'F9']);
  });

  it('treats a shapeless reply as every answer missing', () => {
    expect(checkAnswers('not json', ids, reasoning).missing).toEqual(['a::f', 'a::g']);
    expect(checkAnswers({ answers: [{ id: 'F1', basis: 'recorded' }] }, ids, reasoning).missing).toEqual(['a::f', 'a::g']);
  });
});

describe('the answer cache', () => {
  let card: FunctionCard;
  beforeEach(() => {
    useTempUserData();
    card = { key: 'f::total', file: 'f', display: 'f', name: 'total', kind: 'function', before: 'a', after: 'b', note: null, reasoning: 1 };
  });

  it('keys by session, turn and content hash', () => {
    const hash = turnHash([card], []);
    expect(cacheKey('s1', 't1', hash)).toBe(`s1:t1:${hash}`);
    expect(turnHash([card], [])).toBe(hash);
    expect(turnHash([{ ...card, after: 'c' }], [])).not.toBe(hash);
    expect(turnHash([card], [{ id: 1, kind: 'text', text: 'why' }])).not.toBe(hash);
  });

  it('returns answers only for the same content, and a retry adds to them', () => {
    const hash = turnHash([card], []);
    const answer = { shape: 's', driver: 'd', alternatives: 'a', risk: 'r', basis: 'inferred' as const, quote: null };
    saveAnswers('s1', 't1', hash, { 'f::total': answer });
    expect(cachedAnswers('s1', 't1', hash)).toEqual({ 'f::total': answer });
    expect(cachedAnswers('s1', 't1', 'other')).toBeNull();
    expect(cachedAnswers('s2', 't1', hash)).toBeNull();
    saveAnswers('s1', 't1', hash, { 'f::more': answer });
    expect(Object.keys(cachedAnswers('s1', 't1', hash) ?? {})).toEqual(['f::total', 'f::more']);
    saveAnswers('s1', 't1', 'newer', {});
    expect(cachedAnswers('s1', 't1', 'newer')).toEqual({}); // asked, nothing answered: shows as No answer
  });

  it('never writes outside its folder for an odd session id', () => {
    saveAnswers('../escape', 't', 'h', {});
    expect(cachedAnswers('../escape', 't', 'h')).toBeNull();
  });
});

describe('what never reaches the reviewer', () => {
  it('names secrets files by name, not code that mentions secrets', () => {
    for (const f of ['.env', '/r/.env.local', 'credentials.json', 'id_rsa', 'server.pem', '.npmrc', 'secrets.yaml', 'gcp-service-account.json']) expect(isSecretPath(f), f).toBe(true);
    for (const f of ['src/env.ts', 'secret-panel.ts', 'tokens.css', 'cart.ts', 'README.md']) expect(isSecretPath(f), f).toBe(false);
  });

  it('removes emails, keys and assigned secrets from prompt text', () => {
    const text = redactSecrets('mail sam@example.com; key sk-ant-abcdefghijklmnopqrstuv; password = "hunter22"; AKIAABCDEFGHIJKLMNOP');
    expect(text).not.toMatch(/sam@|abcdefghijklmnop|hunter22|AKIAABCDEFGHIJKLMNOP/);
    expect(text).toContain('[email]');
  });
});

describe('the task roll-up order', () => {
  const change = (file: string, name: string, at: string): TaskChange => ({
    sessionId: 's', turnId: at, at, answer: null, explained: false,
    card: { key: `${file}::${name}`, file, display: file, name, kind: 'function', before: '', after: 'x', note: null, reasoning: 0 },
  });

  it('groups by file then function, newest change first at every level', () => {
    const files = groupTaskChanges([
      change('a.ts', 'f', '2026-10-01T00:00:00Z'), change('b.ts', 'g', '2026-10-03T00:00:00Z'),
      change('a.ts', 'h', '2026-10-02T00:00:00Z'), change('a.ts', 'f', '2026-10-04T00:00:00Z'),
    ]);
    expect(files.map((f) => f.file)).toEqual(['a.ts', 'b.ts']);
    expect(files[0].functions.map((f) => f.name)).toEqual(['f', 'h']);
    expect(files[0].functions[0].changes.map((c) => c.at)).toEqual(['2026-10-04T00:00:00Z', '2026-10-01T00:00:00Z']);
  });
});

describe('line diffs', () => {
  it('marks added and removed lines and folds long unchanged runs', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n');
    const after = ['a', 'b', 'c', 'X', 'e', 'f', 'g'].join('\n');
    expect(diffLines(before, after).filter((l) => l.op !== ' ')).toEqual([{ op: '-', text: 'd' }, { op: '+', text: 'X' }]);
    expect(compactDiff(diffLines(before, after), 1).map((r) => r.op)).toEqual(['gap', ' ', '-', '+', ' ', 'gap']);
  });
});

describe('explaining a turn', () => {
  const envelope = (answers: unknown[]) => JSON.stringify({ type: 'result', is_error: false, result: `Here you go:\n${JSON.stringify({ answers })}`, usage: { input_tokens: 10, output_tokens: 20 } });
  let file: string;
  const prompts: string[] = [];
  beforeEach(() => {
    useTempUserData();
    process.env.PASTEL_SNAPSHOT = '1'; // the reviewer runs through the stub, never a real claude
    file = writeJsonl(path.join(tempDir(), 's.jsonl'), sessionEntries());
    prompts.length = 0;
  });
  afterEach(() => {
    delete process.env.PASTEL_SNAPSHOT;
    codeReviewFixture.review = null;
  });
  const session = () => ({ sessionId: 'sess-1', transcript: file, cwd: CWD });

  it('sends the diffs and reasoning, saves what came back, and marks a missing answer for retry', async () => {
    codeReviewFixture.review = async (prompt) => {
      prompts.push(prompt);
      return envelope([{ id: 'F1', shape: 'one reduce, rounded once', driver: 'qty was ignored', alternatives: 'rounding each line', risk: 'none seen', basis: 'recorded', quote: 'Multiply by qty and round once at the end.' }]);
    };
    const changed: string[] = [];
    const result = await explain([{ source: { sessionId: 'sess-1' }, turnId: 'u1' }], () => session(), (id) => changed.push(id));
    expect(result).toEqual({ explained: 1, missing: 0 });
    expect(prompts[0]).toContain('[R1] (said) Quantities were ignored');
    expect(prompts[0]).toContain(`+  ${NEW_TOTAL}`);
    expect(prompts[0]).not.toContain('API_KEY');
    const review = await turnReview(session(), 'u1');
    expect(review.answers[review.cards[0].key]).toMatchObject({ basis: 'recorded' });
    expect(review.estimate).toBe(0);
    expect(changed.length).toBeGreaterThan(0);

    codeReviewFixture.review = async () => envelope([{ id: 'F1', shape: 'filter', driver: 'ids', alternatives: 'splice', risk: 'none seen', basis: 'inferred', quote: null }]);
    expect(await explain([{ source: { sessionId: 'sess-1' }, turnId: 'u2' }], () => session(), () => {})).toEqual({ explained: 1, missing: 2 });
    const second = await turnReview(session(), 'u2');
    expect(second.explained).toBe(true);
    expect(second.cards.filter((c) => !second.answers[c.key]).map((c) => c.name)).toEqual(['Module level', 'Changed lines']);
    expect(second.estimate).toBeGreaterThan(0);
  });

  it('says a failure in plain words and keeps nothing', async () => {
    codeReviewFixture.review = async () => JSON.stringify({ type: 'result', is_error: true, result: 'Credit balance is too low' });
    expect(await explain([{ source: { sessionId: 'sess-1' }, turnId: 'u1' }], () => session(), () => {})).toEqual({ error: 'Claude Code reported an error: Credit balance is too low' });
    expect((await turnReview(session(), 'u1')).explained).toBe(false);
  });

  it('stops on Cancel', async () => {
    codeReviewFixture.review = async () => { cancelRun(); return envelope([]); };
    expect(await explain([{ source: { sessionId: 'sess-1' }, turnId: 'u1' }], () => session(), () => {})).toEqual({ canceled: true });
  });

  it('builds the reviewer command from verified flags', () => {
    expect(reviewerArgs()).toEqual(expect.arrayContaining(['-p', '--output-format', 'json', '--no-session-persistence', '--permission-mode', 'plan', '--strict-mcp-config']));
    expect(reviewerArgs()[reviewerArgs().indexOf('--tools') + 1]).toBe('Read,Grep,Glob');
    expect(() => answerJson('no json here')).toThrow(/expected format/);
  });
});
