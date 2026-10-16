// The conclusion's This session line: which test runs count, the Library's per-session record, and the wording.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowClaudeFolder, assistantEntry, removeTempDirs, tempDir, userEntry } from './helpers';
import {
  libraryLine, libraryText, loopText, mergeLibraryResults, runsInSpan, testsLine, testsText, type SessionInfo,
} from '../src/shared/session-info';
import type { PipelineRun, StageResult } from '../src/shared/testing';
import type { TabSessions } from '../src/main/tab-session';

const SESSION = 'dddddddd-0000-4000-8000-000000000001';
const T0 = Date.parse('2026-10-16T09:00:00.000Z');
const MIN = 60_000;

const stage = (name: string, status: StageResult['status'], passed = 0, failed = 0): StageResult => ({
  stageId: name.toLowerCase(), name, command: `npm run ${name.toLowerCase()}`, status, exitCode: status === 'failed' ? 1 : 0,
  durationMs: 10, counts: { passed, failed, skipped: 0 }, tests: [], output: '', runner: 'vitest',
});
const run = (id: string, startedAt: number, stages: StageResult[], extra: Partial<PipelineRun> = {}): PipelineRun => {
  const failed = stages.some((s) => s.status === 'failed');
  const totals = stages.reduce((sum, s) => ({ passed: sum.passed + s.counts.passed, failed: sum.failed + s.counts.failed, skipped: 0 }), { passed: 0, failed: 0, skipped: 0 });
  return { id, by: 'you', trigger: 'click', startedAt, finishedAt: startedAt + 1000, state: failed ? 'failed' : 'passed', stages, totals, ...extra };
};

afterEach(() => {
  delete process.env.PASTEL_SNAPSHOT;
  removeTempDirs();
  vi.resetModules();
});

describe('runsInSpan', () => {
  const span = { start: T0, end: T0 + 60 * MIN };
  it('keeps Petal runs started inside the span and Claude runs from this session only, newest first', () => {
    const runs = [
      run('before', T0 - MIN, [stage('Unit', 'passed')]),
      run('inside', T0 + 10 * MIN, [stage('Unit', 'passed')]),
      run('edge', T0 + 60 * MIN, [stage('Unit', 'passed')]),
      run('after', T0 + 61 * MIN, [stage('Unit', 'passed')]),
      run('claude-mine', T0 - 5 * MIN, [stage('Unit', 'failed')], { by: 'claude', trigger: 'transcript', sessionId: SESSION }),
      run('claude-other', T0 + 20 * MIN, [stage('Unit', 'passed')], { by: 'claude', trigger: 'transcript', sessionId: 'someone-else' }),
    ];
    expect(runsInSpan(runs, span, SESSION).map((r) => r.id)).toEqual(['edge', 'inside', 'claude-mine']);
  });

  it('no runs: no Tests part', () => {
    expect(testsLine(runsInSpan([run('before', T0 - MIN, [stage('Unit', 'passed')])], span, SESSION))).toBeNull();
  });
});

describe('line wording', () => {
  it('Tests: several runs with the last one failing, or a lone pipeline passing', () => {
    const several = testsLine([run('r3', 3, [stage('Unit', 'failed', 11, 2)]), run('r2', 2, [stage('Lint', 'passed')]), run('r1', 1, [stage('Unit', 'passed')])]);
    expect(several && testsText(several)).toBe('Tests: 3 runs · last Unit failed (11 passed, 2 failed)');
    expect(several?.last.id).toBe('r3');
    const lone = testsLine([run('p', 1, [stage('Typecheck', 'passed'), stage('Unit', 'passed', 40)])]);
    expect(lone && testsText(lone)).toBe('Tests: pipeline passed');
    const going = testsLine([run('g', 1, [stage('Unit', 'running')], { state: 'running' }), run('o', 0, [stage('Unit', 'passed')])]);
    expect(going && testsText(going)).toBe('Tests: 2 runs · last Unit still running');
  });

  it('Library: added and updated, updated only, nothing new, reading', () => {
    const note = (slug: string) => ({ slug, title: slug.toUpperCase() });
    expect(libraryText({ state: 'done', added: [note('a'), note('b')], updated: [note('c')] })).toBe('Library +2 notes, 1 updated');
    expect(libraryText({ state: 'done', added: [note('a')], updated: [] })).toBe('Library +1 note');
    expect(libraryText({ state: 'done', added: [], updated: [note('c'), note('d')] })).toBe('Library: 2 notes updated');
    expect(libraryText({ state: 'done', added: [], updated: [] })).toBe('Library: nothing new');
    expect(libraryText({ state: 'reading' })).toBe('Library: reading…');
  });

  it('Library part: reading wins; Build my Library off hides a session that added nothing', () => {
    const empty = { added: [], updated: [], at: '2026-10-16' };
    const some = { added: [{ slug: 'a', title: 'A' }], updated: [], at: '2026-10-16' };
    expect(libraryLine({ reading: true, stored: some, autoBuild: false })).toEqual({ state: 'reading' });
    expect(libraryLine({ reading: false, stored: null, autoBuild: true })).toBeNull();
    expect(libraryLine({ reading: false, stored: empty, autoBuild: false })).toBeNull();
    expect(libraryLine({ reading: false, stored: empty, autoBuild: true })).toEqual({ state: 'done', added: [], updated: [] });
    expect(libraryLine({ reading: false, stored: some, autoBuild: false })).toMatchObject({ state: 'done', added: [{ slug: 'a' }] });
  });

  it('later runs add to earlier ones; an added note stays added', () => {
    const first = mergeLibraryResults(null, { added: [{ slug: 'a', title: 'A' }], updated: [{ slug: 'b', title: 'B' }] }, 't1');
    const second = mergeLibraryResults(first, { added: [{ slug: 'c', title: 'C' }], updated: [{ slug: 'a', title: 'A' }, { slug: 'b', title: 'B' }] }, 't2');
    expect(second).toEqual({ added: [{ slug: 'a', title: 'A' }, { slug: 'c', title: 'C' }], updated: [{ slug: 'b', title: 'B' }], at: 't2' });
  });

  it('Test loop: done with fixed and open, a running round, no criteria file', () => {
    expect(loopText({ progress: { round: 3, total: 5, phase: 'done', open: 1 }, fixed: 3 })).toBe('Test loop: done, 3 bugs fixed, 1 open');
    expect(loopText({ progress: { round: 2, total: 5, phase: 'fixing', open: 2 }, fixed: 1 })).toBe('Test loop: fixing round 2/5, 1 bug fixed, 2 open');
    expect(loopText({ progress: { round: 1, total: 1, phase: 'stopped', open: null }, fixed: null })).toBe('Test loop: stopped');
  });
});

describe('the Library remembers what each session added', () => {
  const reply = (topics: object[]) => JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify({ topics }) });

  it('records added and updated note titles per session, reads as reading while it runs, and tells listeners', async () => {
    process.env.PASTEL_SNAPSHOT = '1';
    const userData = allowClaudeFolder();
    fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ claudeFolder: { choice: 'allowed' }, library: { autoBuild: true } }));
    const log = path.join(tempDir(), 'session.jsonl');
    fs.writeFileSync(log, `${JSON.stringify(userEntry('when do payouts settle?'))}\n${JSON.stringify(assistantEntry('After 3pm, next day.'))}\n`);
    const mode = await import('../src/main/snapshot-mode');
    const answers = [
      reply([{ topic: 'Payout cutoff', category: 'Payments', facts: ['Payouts after 3pm settle next day.'] }]),
      reply([{ topic: 'Payout cutoff', category: 'Payments', facts: ['Weekend payouts settle Monday.'] }, { topic: 'Refund window', category: 'Payments', facts: ['Refunds close after 30 days.'] }]),
    ];
    let readingSeen = false;
    const { queueSession, isReadingSession, onSessionChange } = await import('../src/main/library-extract');
    const { stored } = await import('../src/main/library-sessions');
    mode.libraryFixture.extract = async () => { readingSeen = isReadingSession(SESSION); return answers.shift() ?? reply([]); };
    const changes: string[] = [];
    onSessionChange((id) => changes.push(id));

    await queueSession({ sessionId: SESSION, transcript: log });
    expect(readingSeen).toBe(true);
    expect(isReadingSession(SESSION)).toBe(false);
    expect(changes).toEqual([SESSION, SESSION]); // started, finished
    expect(stored(SESSION)).toMatchObject({ added: [{ slug: 'payout-cutoff', title: 'Payout cutoff' }], updated: [] });

    fs.appendFileSync(log, `${JSON.stringify(userEntry('and weekends? refunds?'))}\n`);
    await queueSession({ sessionId: SESSION, transcript: log });
    expect(stored(SESSION)).toMatchObject({ added: [{ title: 'Payout cutoff' }, { title: 'Refund window' }], updated: [] });
    // Persisted in userData, so a reopen from History still has it.
    expect(JSON.parse(fs.readFileSync(path.join(userData, 'library-sessions.json'), 'utf8'))[SESSION].added).toHaveLength(2);
  });

  it('with Build my Library off, a harvest never shows as reading and records nothing', async () => {
    process.env.PASTEL_SNAPSHOT = '1';
    allowClaudeFolder();
    const log = path.join(tempDir(), 'session.jsonl');
    fs.writeFileSync(log, `${JSON.stringify(userEntry('hello'))}\n`);
    const { queueSession, onSessionChange } = await import('../src/main/library-extract');
    const { stored } = await import('../src/main/library-sessions');
    const changes: string[] = [];
    onSessionChange((id) => changes.push(id));
    expect(await queueSession({ sessionId: SESSION, transcript: log })).toMatchObject({ skipped: 'Build my Library is off' });
    expect(changes).toEqual([]);
    expect(stored(SESSION)).toBeNull();
  });
});

describe('sessionInfo, end to end on a fixture session', () => {
  const at = (ms: number) => new Date(ms).toISOString();

  it('counts Petal runs in the session span plus Claude runs from its log, reads its Loop line and fixed bugs, and its Library record', async () => {
    const userData = allowClaudeFolder();
    fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ claudeFolder: { choice: 'allowed' }, library: { autoBuild: true } }));
    const repo = tempDir('petal-repo-');
    fs.mkdirSync(path.join(repo, '.git'));
    fs.mkdirSync(path.join(repo, '.petal'));
    fs.writeFileSync(path.join(repo, '.petal', 'test-criteria.md'), '# Test criteria\n\n## Scenarios\n\n## Bugs\n- [fixed] a · round 1\n- [fixed] b · round 2\n- [fixed] c · round 2\n- [fail] d · round 3\n');
    const transcript = path.join(tempDir(), `${SESSION}.jsonl`);
    const lines = [
      userEntry('start', { timestamp: at(T0) }),
      { type: 'assistant', uuid: 'bash-1', timestamp: at(T0 + 5 * MIN), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npx vitest run' } }] } },
      { type: 'user', uuid: 'bash-1r', timestamp: at(T0 + 6 * MIN), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: 'Exit code 1\n Test Files  1 failed (1)\n      Tests  2 failed | 11 passed (13)' }] } },
      assistantEntry('Round done.\n\n**Loop:** round 3/3 · done · 1 open', 'loop-1', { timestamp: at(T0 + 30 * MIN) }),
      userEntry('conclude', { timestamp: at(T0 + 40 * MIN) }),
    ];
    fs.writeFileSync(transcript, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);

    const testingStore = await import('../src/main/testing-store');
    testingStore.putRun(repo, run('petal-before', T0 - 10 * MIN, [stage('Unit', 'passed')]));
    testingStore.putRun(repo, run('petal-inside', T0 + 2 * MIN, [stage('Typecheck', 'passed'), stage('Unit', 'passed')]));
    const librarySessions = await import('../src/main/library-sessions');
    librarySessions.record(SESSION, { added: [{ slug: 'payout-cutoff', title: 'Payout cutoff' }], updated: [] });

    const { sessionInfo } = await import('../src/main/session-info');
    const sessions = new Map([['1:t1', { feed: { session: { sessionId: SESSION, transcript, cwd: repo } } }]]) as unknown as TabSessions;
    const info = await sessionInfo(SESSION, sessions, T0 + 45 * MIN) as SessionInfo;
    expect(info.tests).toMatchObject({ runs: 2, last: { id: 'claude-toolu_1', state: 'failed' } });
    expect(info.tests && testsText(info.tests)).toMatch(/^Tests: 2 runs · last .+ failed/);
    expect(info.loop && loopText(info.loop)).toBe('Test loop: done, 3 bugs fixed, 1 open');
    expect(info.library && libraryText(info.library)).toBe('Library +1 note');
    // Claude's run went into the project's history, so the Testing tab can open it.
    expect(testingStore.load(repo).runs.some((r) => r.id === 'claude-toolu_1')).toBe(true);
  });

  it('reads nothing while her Claude folder is not allowed', async () => {
    const { useTempUserData } = await import('./helpers');
    useTempUserData();
    const { sessionInfo } = await import('../src/main/session-info');
    expect(await sessionInfo(SESSION, new Map() as unknown as TabSessions)).toBeNull();
  });
});
