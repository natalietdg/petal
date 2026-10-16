// Lessons: parsing Claude's answer, the combined Library+lessons call, dedupe against CLAUDE.md and earlier lessons,
// the CLAUDE.md append writer (heading, symlinks, preview-then-confirm), the background model and the daily call count.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowClaudeFolder, assistantEntry, removeTempDirs, tempDir, useTempUserData, userEntry } from './helpers';
import { appendLesson, diffLines, type LessonScope, isSameRule, lessonLine, LESSONS_HEADING, likeness, normaliseRule, ruleLines, similarPairs } from '../src/shared/lessons';

const envelope = (result: string) => JSON.stringify({ type: 'result', is_error: false, result });
const lesson = (rule: string, scope: LessonScope = 'global', why = 'She had to say it twice.', evidence = 'User: no, I meant the other file') => ({ rule, why, evidence, scope });
const SESSION = 'eeeeeeee-0000-4000-8000-000000000005';

// Belt and braces: a module reloaded without its stand-in folder still lands in a temp dir, never her ~/.claude.
beforeEach(() => { process.env.CLAUDE_CONFIG_DIR = tempDir('petal-no-real-claude-'); });

afterEach(() => {
  delete process.env.PASTEL_SNAPSHOT;
  delete process.env.CLAUDE_CONFIG_DIR;
  removeTempDirs();
  vi.restoreAllMocks();
  vi.doUnmock('node:child_process');
  vi.resetModules();
});

describe('parseLessons and parseCombined', () => {
  it('reads the envelope and a fenced answer; an unknown scope is global; a lesson needs a rule', async () => {
    const { parseLessons } = await import('../src/main/lessons-extract');
    const reply = 'Sure:\n```json\n' + JSON.stringify({ lessons: [lesson('Run the check before claiming it shipped', 'project'), { rule: '', why: 'x' }, 'junk', { rule: 'Ask once up front', scope: 'everywhere' }] }) + '\n```';
    const parsed = parseLessons(envelope(reply));
    expect(parsed).toEqual([lesson('Run the check before claiming it shipped', 'project'), { rule: 'Ask once up front', why: '', evidence: '', scope: 'global' }]);
    expect(parseLessons(envelope('{"lessons": []}'))).toEqual([]);
    expect(parseLessons(envelope(JSON.stringify([lesson('Bare arrays work')])))).toHaveLength(1);
  });

  it('caps count and lengths; no list, bad JSON and error envelopes throw', async () => {
    const { parseLessons } = await import('../src/main/lessons-extract');
    const many = Array.from({ length: 20 }, (_, i) => lesson(`Rule ${i} ${'x'.repeat(400)}`));
    const parsed = parseLessons(envelope(JSON.stringify({ lessons: many })));
    expect(parsed).toHaveLength(6);
    expect(parsed[0]?.rule.length).toBe(200);
    expect(() => parseLessons(envelope('{"topics": []}'))).toThrow(/No lessons/);
    expect(() => parseLessons(envelope('{"lessons": [oops'))).toThrow();
    expect(() => parseLessons(JSON.stringify({ is_error: true, result: 'rate limited' }))).toThrow(/Claude error/);
  });

  it('a combined answer gives both lists; one missing is empty; both missing throws', async () => {
    const { parseCombined } = await import('../src/main/library-extract');
    const both = parseCombined(envelope(JSON.stringify({ topics: [{ topic: 'Payout cutoff', category: 'Payments', facts: ['After 3pm is next day.'] }], lessons: [lesson('Quote the source')] })));
    expect(both.topics.map((t) => t.topic)).toEqual(['Payout cutoff']);
    expect(both.lessons.map((l) => l.rule)).toEqual(['Quote the source']);
    expect(parseCombined(envelope('{"topics": []}'))).toEqual({ topics: [], lessons: [] });
    expect(parseCombined(envelope(JSON.stringify({ lessons: [lesson('A')] }))).lessons).toHaveLength(1);
    expect(() => parseCombined(envelope('{"other": 1}'))).toThrow(/No topics or lessons/);
  });
});

describe('prompt shapes', () => {
  it('the combined prompt holds the Library and lessons instructions and asks for both lists, digest last', async () => {
    const { combinedPromptFor, promptFor } = await import('../src/main/library-extract');
    const { LESSONS_INSTRUCTIONS, lessonsPromptFor } = await import('../src/main/lessons-extract');
    const combined = combinedPromptFor('User: hi\nClaude: hello', ['Payments'], 'Payout cutoff (Payments): x');
    expect(combined).toContain('DOMAIN KNOWLEDGE');
    expect(combined).toContain('already has these notes');
    expect(combined).toContain(LESSONS_INSTRUCTIONS);
    expect(combined).toMatch(/\{"topics": \[\{"topic": .*\}\], "lessons": \[\{"rule": "<rule>", "why": "<why>", "evidence": "<evidence>", "scope": "global"\}\]\}/);
    expect(combined.endsWith('Session:\nUser: hi\nClaude: hello')).toBe(true);
    // The Library-only prompt is unchanged: no lessons; the lessons-only prompt asks for no topics.
    const library = promptFor('User: hi', ['Payments']);
    expect(library).not.toContain('LESSONS');
    expect(library).toContain('Answer with JSON only, no prose:\n{"topics": [{"topic": "<topic>"');
    expect(lessonsPromptFor('User: hi')).not.toContain('"topics"');
    expect(lessonsPromptFor('User: hi')).toContain('{"lessons": [{"rule"');
  });
});

describe('a session run', () => {
  async function setUp(config: object) {
    process.env.PASTEL_SNAPSHOT = '1';
    const userData = allowClaudeFolder();
    fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ claudeFolder: { choice: 'allowed' }, ...config }));
    const project = tempDir('petal-project-');
    const log = path.join(tempDir(), 'session.jsonl');
    fs.writeFileSync(log, `${JSON.stringify(userEntry('no, I meant the staging file', { cwd: project } as object))}\n${JSON.stringify(assistantEntry('Sorry, editing staging now.'))}\n`);
    const mode = await import('../src/main/snapshot-mode');
    mode.folderFixture.home = tempDir('petal-fake-claude-');
    const calls: string[] = [];
    const answer = { topics: [{ topic: 'Staging files', category: 'Infra', facts: ['Staging config lives in staging.yaml.'] }], lessons: [lesson('Confirm which file before editing', 'project')] };
    mode.libraryFixture.extract = async (prompt) => {
      calls.push(prompt);
      if (prompt.includes('"topics"') && prompt.includes('"lessons"')) return envelope(JSON.stringify(answer));
      if (prompt.includes('"lessons"')) return envelope(JSON.stringify({ lessons: answer.lessons }));
      return envelope(JSON.stringify({ topics: answer.topics }));
    };
    return { calls, userData, project, target: { sessionId: SESSION, transcript: log } };
  }
  const stored = (userData: string) => JSON.parse(fs.readFileSync(path.join(userData, 'lessons.json'), 'utf8')).lessons;

  it('with both switches on, one call returns notes and lessons; the lesson keeps the session folder', async () => {
    const { calls, userData, project, target } = await setUp({ library: { autoBuild: true }, lessons: { learn: true } });
    const { queueSession } = await import('../src/main/library-extract');
    expect(await queueSession(target)).toEqual({ added: 1, updated: 0, lessons: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('"lessons"');
    expect(calls[0]).toContain('"topics"');
    expect(fs.existsSync(path.join(userData, 'library', 'staging-files.md'))).toBe(true);
    expect(stored(userData)).toMatchObject([{ rule: 'Confirm which file before editing', scope: 'project', cwd: project, sessionIds: [SESSION], status: 'new' }]);
  });

  it('lessons only: a lessons prompt, no Library notes and no Library record for the session', async () => {
    const { calls, userData, target } = await setUp({ lessons: { learn: true } });
    const { queueSession } = await import('../src/main/library-extract');
    expect(await queueSession(target)).toEqual({ added: 0, updated: 0, lessons: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain('DOMAIN KNOWLEDGE');
    expect(fs.existsSync(path.join(userData, 'library'))).toBe(false);
    expect(fs.existsSync(path.join(userData, 'library-sessions.json'))).toBe(false);
  });

  it('Library only: the Library prompt, no lessons file; neither on: no call at all', async () => {
    const { calls, userData, target } = await setUp({ library: { autoBuild: true } });
    const { queueSession } = await import('../src/main/library-extract');
    expect(await queueSession(target)).toEqual({ added: 1, updated: 0 });
    expect(calls[0]).not.toContain('LESSONS');
    expect(fs.existsSync(path.join(userData, 'lessons.json'))).toBe(false);
    vi.resetModules();
    const off = await setUp({});
    const again = await import('../src/main/library-extract');
    expect(await again.queueSession(off.target)).toMatchObject({ skipped: 'Build my Library is off' });
    expect(off.calls).toHaveLength(0);
  });
});

describe('dedupe', () => {
  it('normalises case, punctuation, list markers and bold; near-identical rules match, different ones don’t', () => {
    expect(normaliseRule('- **Run the check** before claiming!')).toBe('run the check before claiming');
    expect(isSameRule('Run the check before claiming a deploy landed.', '* run the check before claiming the deploy landed')).toBe(true);
    expect(isSameRule('Run the check before claiming a deploy landed', 'Ask clarifying questions in one batch')).toBe(false);
    expect(likeness('Use em dashes sparingly', 'Use em dashes sparingly in UI copy')).toBeGreaterThan(0.45);
  });

  it('CLAUDE.md lines: bullets and sentences, not headings, quotes, tables or fenced code', () => {
    const md = '# Prefs\n\n- Answer first.\nPlain sentence here.\n> quote\n| a | b |\n```\n- not a rule\n```\n';
    expect(ruleLines(md)).toEqual(['- Answer first.', 'Plain sentence here.']);
  });

  it('similar pairs: each lesson once, repeats of different rules not paired', () => {
    const pairs = similarPairs([{ id: 'a', rule: 'Use em dashes sparingly' }, { id: 'b', rule: 'Use em dashes sparingly in UI copy' }, { id: 'c', rule: 'Use em dashes sparingly in prose' }, { id: 'd', rule: 'Stage explicit paths only' }]);
    expect(pairs).toEqual([['a', 'b']]);
  });

  async function store() {
    process.env.PASTEL_SNAPSHOT = '1';
    const userData = allowClaudeFolder();
    const mode = await import('../src/main/snapshot-mode');
    const home = tempDir('petal-fake-claude-');
    mode.folderFixture.home = home;
    const project = tempDir('petal-project-');
    return { userData, home, project, lessons: await import('../src/main/lessons-store') };
  }

  it('drops rules already in the global or project CLAUDE.md, in earlier lessons (even dismissed), or twice in one batch', async () => {
    const { home, project, lessons } = await store();
    fs.writeFileSync(path.join(home, 'CLAUDE.md'), '# Mine\n- **Answer first.** The point goes in sentence one.\n');
    fs.writeFileSync(path.join(project, 'CLAUDE.md'), '- Never git add all; stage explicit paths\n');
    const first = lessons.addLessons([
      lesson('Answer first: the point goes in sentence one'),
      lesson('never git add all, stage explicit paths', 'project'),
      lesson('Check the branch before committing'),
      lesson('check the branch before committing!'),
    ], { sessionId: SESSION, cwd: project });
    expect(first.map((l) => l.rule)).toEqual(['Check the branch before committing']);
    expect(lessons.dismissLesson(first[0]!.id)).toEqual({ ok: true });
    expect(lessons.addLessons([lesson('Check the branch before committing.')], { sessionId: SESSION, cwd: project })).toEqual([]);
    expect(lessons.listLessons().lessons).toEqual([]);
  });

  it('without folder consent, CLAUDE.md files are not read for dedupe', async () => {
    const { userData, home, lessons } = await store();
    fs.writeFileSync(path.join(home, 'CLAUDE.md'), '- Answer first.\n');
    fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ claudeFolder: { choice: 'declined' } }));
    expect(lessons.claudeMdPath('global', null)).toBeNull();
    expect(lessons.addLessons([lesson('Answer first')], { sessionId: SESSION, cwd: null })).toHaveLength(1);
  });

  it('merge folds the other lesson in: sessions and evidence carry over, and it never returns', async () => {
    const { lessons } = await store();
    const [a, b] = lessons.addLessons([lesson('Use em dashes sparingly', 'global', 'w', 'e1'), lesson('Use em dashes sparingly in UI copy', 'global', 'w', 'e2')], { sessionId: SESSION, cwd: null });
    const similar = lessons.listLessons().similar;
    expect(similar).toHaveLength(1);
    expect([...similar[0]!].sort()).toEqual([a!.id, b!.id].sort());
    expect(lessons.mergeLessons(a!.id, b!.id)).toEqual({ ok: true });
    const left = lessons.listLessons().lessons;
    expect(left.map((l) => [l.rule, l.evidence])).toEqual([['Use em dashes sparingly', 'e1 · e2']]);
    expect(lessons.addLessons([lesson('Use em dashes sparingly in UI copy')], { sessionId: SESSION, cwd: null })).toEqual([]);
  });
});

describe('the CLAUDE.md append writer', () => {
  const line = lessonLine({ rule: 'Confirm which file before editing', why: 'She meant staging' });

  it('the line ends rule and why in full stops', () => {
    expect(line).toBe('- Confirm which file before editing. Why: She meant staging.');
    expect(lessonLine({ rule: 'Ask once!', why: '' })).toBe('- Ask once!');
  });

  it('makes the heading at the end when missing, in an empty file or after existing text', () => {
    expect(appendLesson('', line).text).toBe(`${LESSONS_HEADING}\n\n${line}\n`);
    const out = appendLesson('# Mine\n\n- Answer first.\n', line);
    expect(out.text).toBe(`# Mine\n\n- Answer first.\n\n${LESSONS_HEADING}\n\n${line}\n`);
    expect(diffLines('# Mine\n\n- Answer first.\n', out)).toEqual([
      { kind: 'same', text: '# Mine' }, { kind: 'same', text: '' }, { kind: 'same', text: '- Answer first.' },
      { kind: 'add', text: '' }, { kind: 'add', text: LESSONS_HEADING }, { kind: 'add', text: '' }, { kind: 'add', text: line },
    ]);
  });

  it('adds under an existing heading, before the next section, leaving everything else as it was', () => {
    const before = `# Mine\n\n${LESSONS_HEADING}\n\n- Old lesson.\n\n## Later\n- other\n`;
    expect(appendLesson(before, line).text).toBe(`# Mine\n\n${LESSONS_HEADING}\n\n- Old lesson.\n${line}\n\n## Later\n- other\n`);
    expect(appendLesson(`${LESSONS_HEADING}\n`, line).text).toBe(`${LESSONS_HEADING}\n\n${line}\n`);
    expect(appendLesson(`${LESSONS_HEADING}\n### Sub\n- a\n`, line).text).toBe(`${LESSONS_HEADING}\n### Sub\n- a\n${line}\n`); // ### stays inside
  });

  async function setUp() {
    process.env.PASTEL_SNAPSHOT = '1';
    const userData = allowClaudeFolder();
    const mode = await import('../src/main/snapshot-mode');
    const home = tempDir('petal-fake-claude-');
    mode.folderFixture.home = home;
    const project = tempDir('petal-project-');
    const lessons = await import('../src/main/lessons-store');
    const [g, p] = lessons.addLessons([lesson('Answer first'), lesson('Confirm which file before editing', 'project')], { sessionId: SESSION, cwd: project });
    return { userData, home, project, lessons, global: g!, projectLesson: p! };
  }

  it('preview writes nothing; only confirm with its token writes, under the heading; a token works once', async () => {
    const { home, lessons, global } = await setUp();
    const file = path.join(home, 'CLAUDE.md');
    fs.writeFileSync(file, '# Mine\n- Be kind.\n');
    expect(lessons.confirmAdd('made-up-token')).toMatchObject({ error: expect.stringContaining('preview') });
    const preview = lessons.previewAdd(global.id, 'global');
    if ('error' in preview) throw new Error(preview.error);
    expect(preview.file).toBe(file);
    expect(preview.lines.filter((l) => l.kind === 'add').map((l) => l.text)).toEqual(['', LESSONS_HEADING, '', '- Answer first. Why: She had to say it twice.']);
    expect(fs.readFileSync(file, 'utf8')).toBe('# Mine\n- Be kind.\n');
    expect(lessons.confirmAdd(preview.token)).toEqual({ ok: true });
    expect(fs.readFileSync(file, 'utf8')).toBe(`# Mine\n- Be kind.\n\n${LESSONS_HEADING}\n\n- Answer first. Why: She had to say it twice.\n`);
    expect(lessons.confirmAdd(preview.token)).toMatchObject({ error: expect.any(String) });
    expect(lessons.listLessons().lessons.map((l) => l.rule)).toEqual(['Confirm which file before editing']);
  });

  it('a project lesson goes to <folder>/CLAUDE.md, creating it', async () => {
    const { project, lessons, projectLesson } = await setUp();
    const preview = lessons.previewAdd(projectLesson.id, 'project');
    if ('error' in preview) throw new Error(preview.error);
    expect(preview).toMatchObject({ file: path.join(project, 'CLAUDE.md'), created: true });
    expect(lessons.confirmAdd(preview.token)).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf8')).toBe(`${LESSONS_HEADING}\n\n- Confirm which file before editing. Why: She had to say it twice.\n`);
  });

  it('a symlinked CLAUDE.md stays a link; the file it points to gets the line', async () => {
    const { home, lessons, global } = await setUp();
    const dotfiles = tempDir('petal-dotfiles-');
    const real = path.join(dotfiles, 'CLAUDE.md');
    fs.writeFileSync(real, '- Be kind.\n');
    fs.symlinkSync(real, path.join(home, 'CLAUDE.md'));
    const preview = lessons.previewAdd(global.id, 'global');
    if ('error' in preview) throw new Error(preview.error);
    expect(lessons.confirmAdd(preview.token)).toEqual({ ok: true });
    expect(fs.lstatSync(path.join(home, 'CLAUDE.md')).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(real, 'utf8')).toContain(`${LESSONS_HEADING}\n\n- Answer first.`);
  });

  it('refuses when the file changed since the preview, when consent was withdrawn, or when the line is already there', async () => {
    const { userData, home, lessons, global } = await setUp();
    const file = path.join(home, 'CLAUDE.md');
    fs.writeFileSync(file, '- Be kind.\n');
    const changed = lessons.previewAdd(global.id, 'global');
    if ('error' in changed) throw new Error(changed.error);
    fs.appendFileSync(file, '- Edited meanwhile.\n');
    expect(lessons.confirmAdd(changed.token)).toMatchObject({ error: expect.stringContaining('changed') });
    expect(fs.readFileSync(file, 'utf8')).toBe('- Be kind.\n- Edited meanwhile.\n');

    const withdrawn = lessons.previewAdd(global.id, 'global');
    if ('error' in withdrawn) throw new Error(withdrawn.error);
    fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ claudeFolder: { choice: 'declined' } }));
    vi.resetModules(); // the gate caches its answer per module load
    (await import('../src/main/snapshot-mode')).folderFixture.home = home;
    const fresh = await import('../src/main/lessons-store');
    expect(fresh.previewAdd(global.id, 'global')).toMatchObject({ error: expect.stringContaining('Claude folder') });
    expect(fs.readFileSync(file, 'utf8')).toBe('- Be kind.\n- Edited meanwhile.\n');

    fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ claudeFolder: { choice: 'allowed' } }));
    fs.appendFileSync(file, '- answer first!\n');
    vi.resetModules();
    (await import('../src/main/snapshot-mode')).folderFixture.home = home; // the reload forgets the stand-in
    expect((await import('../src/main/lessons-store')).previewAdd(global.id, 'global')).toMatchObject({ error: expect.stringContaining('already') });
  });

  it('a project lesson without a folder can only go global', async () => {
    const { lessons } = await setUp();
    const [orphan] = lessons.addLessons([lesson('Keep commits small', 'project')], { sessionId: SESSION, cwd: null });
    expect(lessons.previewAdd(orphan!.id, 'project')).toMatchObject({ error: expect.stringContaining('global') });
  });
});

describe('model for background work', () => {
  it('Haiku for new installs, the organizer’s model for people who used Petal before; only known choices save', async () => {
    useTempUserData();
    const config = await import('../src/main/config-store');
    expect(config.load().background.model).toBe('haiku');
    expect(config.load().lessons.learn).toBe(false);
    expect(config.save({ background: { model: 'sonnet' } }).background.model).toBe('sonnet');
    expect(config.save({ background: { model: 'opus' } }).background.model).toBe('sonnet');
    expect(config.backgroundModel(config.save({ background: { model: 'organizer' }, organizer: { model: 'opus' } }))).toBe('opus');
    vi.resetModules();
    const userData = useTempUserData();
    fs.writeFileSync(path.join(userData, 'settings.json'), '{}'); // a returning user, before this setting existed
    const returning = await import('../src/main/config-store');
    expect(returning.load().background.model).toBe('organizer');
  });

  it('a session run passes the background model to the runner, not the organizer’s', async () => {
    const userData = useTempUserData();
    const home = tempDir('petal-config-dir-');
    process.env.CLAUDE_CONFIG_DIR = home; // never her real folder
    fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ claudeFolder: { choice: 'allowed' }, library: { autoBuild: true }, organizer: { model: 'opus' }, background: { model: 'sonnet' } }));
    const models: string[] = [];
    vi.doMock('../src/main/claude-cli', () => ({
      claudePath: async () => '/fake/claude',
      runClaude: async (_prompt: string, { model }: { model?: string } = {}) => { models.push(model ?? ''); return envelope('{"topics": []}'); },
    }));
    const log = path.join(home, 'projects', 'p', `${SESSION}.jsonl`);
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.writeFileSync(log, `${JSON.stringify(userEntry('hi'))}\n`);
    const { queueSession } = await import('../src/main/library-extract');
    await queueSession({ sessionId: SESSION, transcript: log });
    expect(models).toEqual(['sonnet']);
    vi.doUnmock('../src/main/claude-cli');
  });

  it('the runner puts the model after --model and counts the call', async () => {
    useTempUserData();
    const seen: string[][] = [];
    vi.doMock('node:child_process', () => ({
      execFile: (_file: string, args: string[], _options: unknown, done: (error: Error | null, stdout: string) => void) => {
        seen.push(args);
        setTimeout(() => done(null, args.includes('-lc') ? '/bin/sh\n' : envelope('{}')), 0);
        return { stdin: { end: () => undefined } };
      },
    }));
    const cli = await import('../src/main/claude-cli');
    const calls = await import('../src/main/background-calls');
    expect(cli.claudeArgs('haiku')).toEqual(['-p', '--model', 'haiku', '--no-session-persistence', '--output-format', 'json', '--tools', '']);
    await cli.runClaude('hello', { model: 'sonnet' });
    const run = seen.find((args) => args.includes('-p'));
    expect(run?.[run.indexOf('--model') + 1]).toBe('sonnet');
    expect(calls.callsToday()).toBe(1);
  });
});

describe('background call counter', () => {
  it('counts per local day and starts again the next day', async () => {
    const userData = useTempUserData();
    const { callsToday, recordCall, localDay } = await import('../src/main/background-calls');
    const morning = new Date(2026, 9, 16, 9, 0);
    expect(callsToday(morning)).toBe(0);
    recordCall(morning);
    recordCall(new Date(2026, 9, 16, 23, 59));
    expect(callsToday(morning)).toBe(2);
    expect(callsToday(new Date(2026, 9, 17, 0, 1))).toBe(0);
    recordCall(new Date(2026, 9, 17, 0, 1));
    expect(JSON.parse(fs.readFileSync(path.join(userData, 'background-calls.json'), 'utf8'))).toEqual({ day: localDay(new Date(2026, 9, 17)), calls: 1 });
  });

  it('a broken tally file reads as zero and never throws', async () => {
    const userData = useTempUserData();
    fs.writeFileSync(path.join(userData, 'background-calls.json'), 'not json');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { callsToday, recordCall } = await import('../src/main/background-calls');
    expect(callsToday()).toBe(0);
    expect(() => recordCall()).not.toThrow();
    expect(callsToday()).toBe(1);
  });
});
