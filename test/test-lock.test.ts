// The test lock, per repo: the hook's decision (any session may change a locked test, none may delete, skip or weaken
// one), its shell write patterns, failing open, the user-level settings entry, and the integrity check. Lock state lives in
// ~/.petal/repos/<repoKey>/ (the electron mock's home is the temp userData), never in the repo.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';
// @ts-expect-error: a plain .mjs shipped as the hook, no type declarations
import { bashWrites, configNote, decide, isTestConfig, isTestPath, logRefusal, weakens as hookWeakens } from '../resources/hooks/petal-test-lock.mjs';
import { LEGACY_LOCK_COMMAND, hasLockHook, lockCommand, lockHookStale, mergeLockHook, unmergeLockHook } from '../src/shared/lock-settings';
import { TOUCH_SLACK_MS, emptyManifest, integrityStep, isTestConfig as sharedIsTestConfig, isTestPath as sharedIsTestPath, lastToucher, lockedFiles, mainRefusals, readManifest, repoPath, restoredText, weakens } from '../src/shared/test-lock';
import { parseCriteria } from '../src/shared/test-loop';
import { repoDir } from '../src/main/petal-home';
import { repoKey } from '../src/main/petal-repos';
import { dismissRestored, droppedCopiesDir, loadManifest, lockHookPresent, lockRefusals, lockedCopiesDir, migrateLegacyCopies, refreshLock, resolveUnconfirmed, setLock, upgradeLock } from '../src/main/test-lock';
import { agentName, cleanAgentName } from '../src/shared/agent-names';

afterEach(removeTempDirs);

const ROOT = '/r/shop';
const manifest = {
  version: 1, enabled: true, lockedPaths: ['src/cart.test.ts'],
  sessions: { tester: { role: 'tester', taskId: 't-cart' }, fixer: { role: 'fixer', taskId: 't-cart' } }, names: {},
};
const BEFORE = 'it("rounds", () => {\n  expect(total(1.005)).toBe(1.01);\n});\n';
const SKIPPED = BEFORE.replace('it(', 'it.skip(');
const edit = (session: string, file: string, tool = 'Edit', input: object = {}) => ({ session_id: session, tool_name: tool, tool_input: { file_path: file, ...input } }); // no cwd: paths read from the repo root
const bash = (session: string, command: string) => ({ session_id: session, tool_name: 'Bash', tool_input: { command }, cwd: ROOT });
const SHELL = (rel: string) => `${rel} is a locked test. Change it with the Edit tool so the lock can check it; deleting or overwriting it from the shell isn't allowed.`;

// A repo holding the locked test as BEFORE.
function lockedRepo(rel = 'src/cart.test.ts'): string {
  const repo = tempDir('petal-hook-');
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), BEFORE);
  return repo;
}

describe('the hook’s decision', () => {
  it('any session may change or extend a locked test, agents and the main session alike', () => {
    const repo = lockedRepo();
    const more = { old_string: '});\n', new_string: '});\nit("rounds down", () => {\n  expect(total(1.004)).toBe(1);\n});\n' };
    for (const session of ['main', 'tester', 'fixer', 'unknown']) {
      expect(decide(edit(session, 'src/cart.test.ts', 'Edit', more), manifest, repo), session).toBeNull();
      expect(decide(edit(session, `${repo}/src/cart.test.ts`, 'Write', { content: BEFORE.replace('1.01', '1.010') }), manifest, repo), session).toBeNull();
    }
  });

  it('deleting, skipping or weakening one is refused for every session, the testing agent too', () => {
    const repo = lockedRepo();
    expect(decide(edit('tester', 'src/cart.test.ts', 'Write', { content: SKIPPED }), manifest, repo)).toMatch(/^src\/cart\.test\.ts is a locked test: this change skips it\. Ask the user/);
    expect(decide(edit('main', 'src/cart.test.ts', 'Edit', { old_string: '  expect(total(1.005)).toBe(1.01);\n', new_string: '' }), manifest, repo)).toMatch(/weakens it \(removed an assertion\)/);
    expect(decide(edit('fixer', 'src/cart.test.ts', 'MultiEdit', { edits: [{ old_string: BEFORE, new_string: '// gone\n' }] }), manifest, repo)).toMatch(/weakens it \(removed a test\)/);
    expect(decide(edit('main', 'src/cart.test.ts', 'Edit', { old_string: 'it(', new_string: 'xit(' }), manifest, repo)).toMatch(/skips it/);
  });

  it('an edit it can’t replay, a new file, an unlocked file or one outside the repo goes through', () => {
    const repo = lockedRepo();
    expect(decide(edit('main', 'src/cart.test.ts', 'Edit', { old_string: 'not there', new_string: '' }), manifest, repo)).toBeNull();
    expect(decide(edit('main', 'src/new.test.ts', 'Write', { content: '' }), manifest, repo)).toBeNull();
    expect(decide(edit('main', `${repo}/src/cart.ts`, 'Write', { content: '' }), manifest, repo)).toBeNull();
    expect(decide(edit('main', '/elsewhere/cart.test.ts', 'Write', { content: '' }), manifest, repo)).toBeNull();
    expect(decide({ session_id: 'main', tool_name: 'Read', tool_input: { file_path: 'src/cart.test.ts' } }, manifest, repo)).toBeNull();
  });

  it('a shell line that writes to a locked file is refused for every session; reading it is not', () => {
    for (const command of ['sed -i "" s/a/b/ src/cart.test.ts', 'echo x > src/cart.test.ts', 'cat a >> /r/shop/src/cart.test.ts', 'echo x | tee src/cart.test.ts', 'rm src/cart.test.ts', 'mv src/cart.test.ts old.ts', 'cp backup.ts src/cart.test.ts', 'git checkout -- src/cart.test.ts', 'git restore src/cart.test.ts']) {
      expect(decide(bash('main', command), manifest, ROOT), command).toBe(SHELL('src/cart.test.ts'));
    }
    for (const command of ['cat src/cart.test.ts', 'npx vitest run src/cart.test.ts', 'cp src/cart.test.ts /tmp/copy.ts', 'grep total src/cart.test.ts > /tmp/out', 'echo hi > src/cart.ts', 'echo [] > .petal/suite.json']) {
      expect(decide(bash('main', command), manifest, ROOT), command).toBeNull();
    }
    expect(decide(bash('tester', 'echo x > src/cart.test.ts'), manifest, ROOT)).toBe(SHELL('src/cart.test.ts'));
    expect(bashWrites('sed -n 1p src/cart.test.ts', 'src/cart.test.ts', ROOT)).toBe(false);
  });

  it('weakening: a skip added, fewer tests or assertions; renaming or adding is not, in the hook and Petal alike', () => {
    const cases: [string, string | null, string | null][] = [
      [BEFORE, BEFORE.replace('rounds', 'rounds to the cent'), null],
      [BEFORE, `${BEFORE}it("more", () => { expect(1).toBe(1); });\n`, null],
      [BEFORE, SKIPPED, 'skipped'],
      [BEFORE, BEFORE.replace('it(', 'it.todo('), 'skipped'],
      [BEFORE, BEFORE.replace('  expect(total(1.005)).toBe(1.01);\n', ''), 'removed an assertion'],
      [BEFORE, '', 'removed a test'],
      [BEFORE, null, 'deleted'],
      ['def test_total():\n    assert total(1) == 1\n', '@pytest.mark.skip\ndef test_total():\n    assert total(1) == 1\n', 'skipped'],
      ['func TestTotal(t *testing.T) {\n  t.Errorf("x")\n}\n', 'func TestTotal(t *testing.T) {\n  t.Skip()\n  t.Errorf("x")\n}\n', 'skipped'],
      ['it("asserts the total", () => { expect(a).toBe(1); })', 'it("checks the total", () => { expect(a).toBe(1); })', null],
      ['if (re.test(x)) {}\nit("a", () => { expect(1).toBe(1); })', 'it("a", () => { expect(1).toBe(1); })', null],
    ];
    for (const [before, after, why] of cases) {
      expect(weakens(before, after), String(after)).toBe(why);
      expect(hookWeakens(before, after), String(after)).toBe(why); // one rule in both places
    }
  });

  it('knows test paths', () => {
    expect(['src/a.test.ts', 'src/a.spec.js', 'tests/x.py', 'pkg/a_test.go', 'test_a.py', '.maestro/login.yaml', '__tests__/a.js'].every(isTestPath)).toBe(true);
    expect(['src/a.ts', 'src/testing.ts', 'latest/a.ts'].some(isTestPath)).toBe(false);
  });

  it('runner setup is never locked; every session’s edit of it is noted in the lock log', () => {
    const configs = ['conftest.py', 'tests/conftest.py', 'jest.config.ts', 'vitest.config.mts', 'playwright.config.ts', 'pytest.ini', 'pyproject.toml', 'package.json', 'apps/web/package.json', 'vitest.setup.ts', 'src/setupTests.ts', '.mocharc.json'];
    expect(configs.every(isTestConfig)).toBe(true);
    expect(['src/config.ts', 'tsconfig.json', 'package-lock.json', 'jest.ts'].some(isTestConfig)).toBe(false);
    for (const file of configs) expect(decide(edit('main', file, 'Write', { content: '' }), manifest, ROOT), file).toBeNull();
    expect(configNote(edit('main', 'jest.config.ts'), manifest, ROOT)).toBe('main edited test config jest.config.ts');
    expect(configNote(edit('tester', 'jest.config.ts'), manifest, ROOT)).toBe('tester edited test config jest.config.ts');
    expect(configNote(edit('main', 'src/cart.ts'), manifest, ROOT)).toBeNull();
    for (const file of [...configs, 'src/config.ts', 'tsconfig.json', 'jest.ts']) expect(sharedIsTestConfig(file), file).toBe(isTestConfig(file)); // one list in both places
    const locked = lockedFiles({ root: ROOT, criteria: null, touches: ['package.json', 'jest.config.ts', 'src/a.test.ts'].map((target, at) => ({ target, at, sessionId: 'main', kind: 'edit' as const, cwd: ROOT })) });
    expect(locked).toEqual(['src/a.test.ts']);
  });

  it('no manifest or a bad one lets everything through', () => {
    expect(decide(edit('main', 'src/cart.test.ts', 'Write', { content: '' }), null, ROOT)).toBeNull();
    expect(decide(edit('main', 'src/cart.test.ts', 'Write', { content: '' }), 'junk', ROOT)).toBeNull();
  });
});

describe('the hook script', () => {
  const script = path.resolve(__dirname, '../resources/hooks/petal-test-lock.mjs');
  // ~/.petal as the hook sees it: the script beside repos/<repoKey>/lock.json.
  function petalWith(repo: string, lock: object | string): { hook: string; store: string } {
    const petal = tempDir('petal-home-');
    const store = path.join(petal, 'repos', repoKey(repo));
    fs.mkdirSync(store, { recursive: true });
    fs.copyFileSync(script, path.join(petal, 'test-lock.mjs'));
    fs.writeFileSync(path.join(store, 'lock.json'), typeof lock === 'string' ? lock : JSON.stringify(lock));
    return { hook: path.join(petal, 'test-lock.mjs'), store };
  }
  const run = (hook: string, dir: string, input: object): string => execFileSync(process.execPath, [hook], { input: JSON.stringify(input), env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' });

  it('denies with a reason as JSON, logs the refusal in ~/.petal, and fails open on a corrupt manifest; the repo gets no .petal', () => {
    const repo = lockedRepo();
    const { hook, store } = petalWith(repo, manifest);
    const denied = JSON.parse(run(hook, repo, { ...edit('main', 'src/cart.test.ts', 'Write', { content: SKIPPED }), cwd: repo }));
    expect(denied.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
    expect(denied.hookSpecificOutput.permissionDecisionReason).toMatch(/this change skips it/);
    expect(fs.readFileSync(path.join(store, 'lock-refusals.jsonl'), 'utf8')).toContain('"session":"main"');
    expect(run(hook, repo, { ...edit('main', 'src/cart.test.ts', 'Write', { content: `${BEFORE}// more\n` }), cwd: repo })).toBe('');
    fs.writeFileSync(path.join(store, 'lock.json'), '{ broken');
    expect(run(hook, repo, { ...edit('main', 'src/cart.test.ts', 'Write', { content: SKIPPED }), cwd: repo })).toBe('');
    expect(fs.readFileSync(path.join(store, 'lock.log'), 'utf8')).toMatch(/lock\.json unreadable/);
    expect(fs.existsSync(path.join(repo, '.petal'))).toBe(false);
  });

  it('one script serves every repo: a repo with its lock off, or none at all, lets everything through', () => {
    const repo = lockedRepo();
    const { hook } = petalWith(repo, { ...manifest, enabled: false });
    expect(run(hook, repo, { ...edit('main', 'src/cart.test.ts', 'Write', { content: SKIPPED }), cwd: repo })).toBe('');
    const other = lockedRepo();
    expect(run(hook, other, { ...edit('main', 'src/cart.test.ts', 'Write', { content: SKIPPED }), cwd: other })).toBe('');
  });

  it('keeps only the newest 200 refusals', () => {
    const file = path.join(tempDir('petal-refusals-'), 'lock-refusals.jsonl');
    for (let i = 0; i < 205; i += 1) logRefusal(file, { at: i, session: 'main' });
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(200);
    expect(JSON.parse(lines[0] as string).at).toBe(5);
    expect(JSON.parse(lines[199] as string).at).toBe(204);
  });

  it('finds the locked repo from a subfolder the session started in', () => {
    const repo = lockedRepo('apps/web/a.test.ts');
    const { hook } = petalWith(repo, { ...manifest, lockedPaths: ['apps/web/a.test.ts'] });
    const sub = path.join(repo, 'apps', 'web');
    const out = run(hook, sub, { ...edit('main', 'a.test.ts', 'Write', { content: SKIPPED }), cwd: sub });
    expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe('deny');
  });
});

describe('the user-level settings entry', () => {
  const SCRIPT = '/h/.petal/test-lock.mjs';
  it('adds the lock once, keeps every other key and hook, and removes only its own entry', () => {
    const hers = { permissions: { allow: ['Bash(npm test)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }], Stop: [{ hooks: [] }] } };
    const on = mergeLockHook(hers, SCRIPT);
    expect(hasLockHook(on)).toBe(true);
    expect(mergeLockHook(on, SCRIPT)).toEqual(on);
    expect(on.permissions).toEqual(hers.permissions);
    expect((on.hooks as { PreToolUse: unknown[] }).PreToolUse).toHaveLength(2);
    expect(JSON.stringify(on)).toContain(`"command":"node '/h/.petal/test-lock.mjs'"`);
    expect(unmergeLockHook(on)).toEqual(hers);
    expect(unmergeLockHook(mergeLockHook({}, SCRIPT))).toEqual({});
    expect(unmergeLockHook(hers)).toBe(hers);
  });

  it('the command holds the script’s absolute path, shell-quoted; an older per-repo entry is replaced', () => {
    expect(lockCommand("/Users/n/it's/.petal/test-lock.mjs")).toBe(`node '/Users/n/it'\\''s/.petal/test-lock.mjs'`);
    const old = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }, { matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash', hooks: [{ type: 'command', command: LEGACY_LOCK_COMMAND }] }] } };
    expect(hasLockHook(old)).toBe(true);
    expect(lockHookStale(old, SCRIPT)).toBe(true);
    const upgraded = mergeLockHook(old, SCRIPT);
    const groups = (upgraded.hooks as { PreToolUse: { hooks: { command: string }[] }[] }).PreToolUse;
    expect(groups.map((g) => g.hooks[0]?.command)).toEqual(['echo mine', lockCommand(SCRIPT)]);
    expect(lockHookStale(upgraded, SCRIPT)).toBe(false);
    expect(unmergeLockHook(old)).toEqual({ hooks: { PreToolUse: [old.hooks.PreToolUse[0]] } });
  });

  it('turning a lock on writes ~/.petal/test-lock.mjs and one entry in ~/.claude/settings.json, nothing in the repo', () => {
    const home = useTempUserData();
    const claudeDir = tempDir('petal-claude-');
    const repo = tempDir('petal-repo-');
    const other = tempDir('petal-repo-');
    const settings = path.join(claudeDir, 'settings.json');
    fs.writeFileSync(settings, JSON.stringify({ model: 'opus' }));
    expect(setLock(repo, true, null)).toMatch(/isn’t reading your Claude folder/);
    expect(setLock(repo, true, claudeDir)).toBeNull();
    expect(setLock(other, true, claudeDir)).toBeNull();
    const script = path.join(home, '.petal', 'test-lock.mjs');
    expect(fs.readFileSync(script, 'utf8')).toContain('findLocked');
    const on = JSON.parse(fs.readFileSync(settings, 'utf8'));
    expect(on.model).toBe('opus');
    expect((on.hooks.PreToolUse as unknown[])).toHaveLength(1);
    expect(on.hooks.PreToolUse[0].hooks[0].command).toBe(lockCommand(script));
    expect(loadManifest(repo).enabled).toBe(true);
    expect(fs.existsSync(path.join(repoDir(repo), 'lock.json'))).toBe(true);
    expect(fs.readdirSync(repo)).toEqual([]); // no .petal, no .claude in the repo
    expect(setLock(repo, false, claudeDir)).toBeNull();
    expect(hasLockHook(JSON.parse(fs.readFileSync(settings, 'utf8')))).toBe(true); // the other repo still has its lock on
    expect(setLock(other, false, claudeDir)).toBeNull();
    expect(JSON.parse(fs.readFileSync(settings, 'utf8'))).toEqual({ model: 'opus' });
    fs.writeFileSync(settings, '{ hers, broken');
    expect(setLock(repo, true, claudeDir)).toMatch(/settings.json isn’t valid JSON/);
    expect(fs.readFileSync(settings, 'utf8')).toBe('{ hers, broken');
  });

  it('a newer build refreshes the script only where the user-level entry is on; an older per-repo lock waits for her', () => {
    const home = useTempUserData();
    const claudeDir = tempDir('petal-claude-');
    const repo = tempDir('petal-repo-');
    const inRepo = path.join(repo, '.petal', 'lock.json');
    fs.mkdirSync(path.dirname(inRepo));
    fs.writeFileSync(inRepo, JSON.stringify({ ...emptyManifest(), enabled: true })); // an older build's lock
    expect(loadManifest(repo).enabled).toBe(true); // copied into ~/.petal on first read
    upgradeLock(repo, claudeDir);
    expect(fs.existsSync(path.join(claudeDir, 'settings.json'))).toBe(false); // never registered unasked
    expect(lockHookPresent(claudeDir)).toBe(false);
    expect(setLock(repo, true, claudeDir)).toBeNull();
    fs.writeFileSync(path.join(home, '.petal', 'test-lock.mjs'), '// old build\n');
    upgradeLock(repo, claudeDir);
    expect(fs.readFileSync(path.join(home, '.petal', 'test-lock.mjs'), 'utf8')).toContain('findLocked');
    expect(lockHookPresent(claudeDir)).toBe(true);
    expect(fs.readFileSync(inRepo, 'utf8')).toBe(JSON.stringify({ ...emptyManifest(), enabled: true })); // the repo's copy untouched
  });
});

describe('what is locked', () => {
  it('tests named in the criteria and test files any session edited; never the suite or app code', () => {
    const criteria = parseCriteria('## Scenarios\n- [pass] rounds · test: src/cart.test.ts::rounds · ticket: AB#1\n- [pass] two · test: src/a.test.ts::x · test: e2e/a.spec.ts::y\n## Bugs\n- [open] b · test: src/app.ts\n');
    const locked = lockedFiles({
      root: ROOT, criteria,
      touches: [{ target: 'e2e/flow.spec.ts', at: 1, sessionId: 'main', kind: 'edit', cwd: ROOT }, { target: `${ROOT}/src/cart.ts`, at: 2, sessionId: 'fixer', kind: 'edit', cwd: ROOT }, { target: '.petal/suite.json', at: 3, sessionId: 'main', kind: 'edit', cwd: ROOT }],
    });
    expect(locked).toEqual(['e2e/a.spec.ts', 'e2e/flow.spec.ts', 'src/a.test.ts', 'src/cart.test.ts']);
    expect(repoPath('../x', ROOT, `${ROOT}/src`)).toBe('x');
    expect(repoPath('/etc/passwd', ROOT)).toBeNull();
    const app = 'app/[lang]/preview/preview-view.tsx';
    const test = 'app/[lang]/preview/preview-view.vn-salary.test.tsx';
    for (const file of [app, test, 'src/a.ts', 'tests/x.py', '.petal/suite.json', 'latest/a.ts']) expect(sharedIsTestPath(file), file).toBe(isTestPath(file)); // one list in both places
  });

  it('an older lock set drops its app code: the fix stays, the copy moves to locked-dropped, tests stay locked', () => {
    useTempUserData();
    const repo = tempDir('petal-repo-');
    const app = 'app/[lang]/preview/preview-view.tsx';
    const test = 'app/[lang]/preview/preview-view.vn-salary.test.tsx';
    const file = (rel: string) => path.join(repo, ...rel.split('/'));
    const copy = (rel: string, dir = lockedCopiesDir(repo)) => path.join(dir, ...rel.split('/'));
    const sha = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
    for (const [rel, text] of [[app, 'old view\n'], [test, 'it("vn")\n']]) {
      fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
      fs.writeFileSync(file(rel), text);
      fs.mkdirSync(path.dirname(copy(rel)), { recursive: true });
      fs.writeFileSync(copy(rel), text);
    }
    setLock(repo, true, tempDir('petal-claude-'));
    const older = loadManifest(repo);
    const flags = [{ path: app, at: 1, taskId: 't', by: 'fixer' as const }, { path: app, at: 2, taskId: 't', by: 'unconfirmed' as const }, { path: test, at: 3, taskId: 't', by: 'main' as const }];
    fs.writeFileSync(path.join(repoDir(repo), 'lock.json'), JSON.stringify({ ...older, lockedPaths: [app, test], owners: { [app]: 't', [test]: 't' }, approved: { [app]: sha('old view\n'), [test]: sha('it("vn")\n') }, restored: flags }));
    fs.writeFileSync(file(app), 'fixed view\n'); // the bug fix agent's fix
    const fixerTouch = { target: app, at: Date.now(), sessionId: 'fixer', kind: 'edit' as const, cwd: repo };
    const agents = [{ sessionId: 'tester', role: 'tester' as const, taskId: 't' }, { sessionId: 'fixer', role: 'fixer' as const, taskId: 't' }];
    const testerTouch = { target: app, at: 0, sessionId: 'tester', kind: 'edit' as const, cwd: repo }; // the edit that locked it before
    const after = refreshLock(repo, { criteria: parseCriteria(`## Scenarios\n- [pass] vn · test: ${test} · round 1 · task: t\n`), touches: [testerTouch, fixerTouch] }, agents, {});
    expect(fs.readFileSync(file(app), 'utf8')).toBe('fixed view\n');
    expect(after.lockedPaths).toEqual([test]);
    expect(Object.keys(after.approved)).toEqual([test]);
    expect(after.restored).toEqual([flags[2]]);
    expect(fs.existsSync(copy(app))).toBe(false);
    expect(fs.readFileSync(copy(app, droppedCopiesDir(repo)), 'utf8')).toBe('old view\n');
    expect(fs.readFileSync(copy(test), 'utf8')).toBe('it("vn")\n');
    fs.writeFileSync(file(app), 'fixed again\n');
    refreshLock(repo, { criteria: null, touches: [testerTouch, { ...fixerTouch, at: Date.now() }] }, agents, {});
    expect(fs.readFileSync(file(app), 'utf8')).toBe('fixed again\n'); // never put back again
    expect(fs.readFileSync(copy(app, droppedCopiesDir(repo)), 'utf8')).toBe('old view\n');
  });

  it('the integrity step: approve any whole change, restore a Claude session’s weakening, ask about one nobody made', () => {
    const sessions = { tester: { role: 'tester' as const, taskId: 't' }, fixer: { role: 'fixer' as const, taskId: 't' } };
    const whole = { hash: 'h2', weakened: null };
    const skipped = { hash: 'h2', weakened: 'skipped' };
    for (const who of ['tester', 'fixer', 'main', null]) expect(integrityStep('a', whole, 'h1', who, sessions)).toEqual({ kind: 'approve', path: 'a' });
    expect(integrityStep('a', skipped, 'h1', 'tester', sessions)).toEqual({ kind: 'restore', path: 'a', by: 'tester', why: 'skipped' });
    expect(integrityStep('a', skipped, 'h1', 'main', sessions)).toEqual({ kind: 'restore', path: 'a', by: 'main', why: 'skipped' });
    expect(integrityStep('a', skipped, 'h1', null, sessions)).toEqual({ kind: 'unconfirmed', path: 'a', why: 'skipped' });
    expect(integrityStep('a', { hash: null, weakened: 'deleted' }, 'h1', null, sessions)).toEqual({ kind: 'unconfirmed', path: 'a', why: 'deleted' });
    expect(integrityStep('a', { hash: 'h1', weakened: null }, 'h1', 'main', sessions)).toEqual({ kind: 'keep', path: 'a' });
    expect(integrityStep('a', whole, undefined, 'main', sessions)).toEqual({ kind: 'approve', path: 'a' });
    const names = { tester: 'Quinn', fixer: 'Fixie' };
    expect(restoredText({ path: 'src/a.test.ts', at: 1, taskId: null, by: 'unconfirmed', why: 'skipped' }, names)).toBe('src/a.test.ts skipped outside Claude. Keep it or restore the locked copy?');
    expect(restoredText({ path: 'a', at: 1, taskId: null, by: 'main', why: 'deleted' }, names)).toBe('A Claude session deleted a test. Restored.');
    expect(restoredText({ path: 'a', at: 1, taskId: null, by: 'fixer', why: 'removed an assertion' }, names)).toBe('Fixie weakened a test. Restored.');
    expect(restoredText({ path: 'a', at: 1, taskId: null, by: 'tester', why: 'skipped' }, names)).toBe('Quinn skipped a test. Restored.');
  });

  it('refusals of sessions that aren’t agents show in the lock bar until dismissed', () => {
    useTempUserData();
    const repo = tempDir('petal-repo-');
    setLock(repo, true, tempDir('petal-claude-'));
    refreshLock(repo, { criteria: null, touches: [] }, [{ sessionId: 'fixer', role: 'fixer', taskId: 't' }], {});
    const lines = [
      { at: 10, session: 'main', tool: 'Edit', target: `${repo}/src/cart.test.ts`, reason: 'x' },
      { at: 11, session: 'fixer', tool: 'Edit', target: 'src/cart.test.ts', reason: 'x' },
      { at: 12, session: 'main', tool: 'Bash', target: 'rm src/cart.test.ts', reason: 'x' },
    ];
    fs.writeFileSync(path.join(repoDir(repo), 'lock-refusals.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\nnot json\n`);
    expect(lockRefusals(repo, loadManifest(repo))).toEqual([
      { at: 10, text: 'A Claude session tried to edit src/cart.test.ts. Refused.' },
      { at: 12, text: 'A Claude session tried to run rm src/cart.test.ts. Refused.' },
    ]);
    dismissRestored(repo, 11);
    expect(lockRefusals(repo, loadManifest(repo)).map((r) => r.at)).toEqual([12]);
    expect(mainRefusals('', emptyManifest(), repo)).toEqual([]);
    expect(lockRefusals(tempDir('petal-repo-'), emptyManifest())).toEqual([]);
  });

  it('restores a locked test any Claude session weakened, and keeps any session’s whole change', () => {
    const userData = useTempUserData();
    const repo = tempDir('petal-repo-');
    fs.mkdirSync(path.join(repo, 'src'));
    const test = path.join(repo, 'src', 'cart.test.ts');
    fs.writeFileSync(test, BEFORE);
    setLock(repo, true, tempDir('petal-claude-'));
    const criteria = parseCriteria('## Scenarios\n- [pass] rounds · test: src/cart.test.ts::rounds · ticket: AB#1\n');
    const agents = [{ sessionId: 'tester', role: 'tester' as const, taskId: 't-cart' }];
    const touched = (sessionId: string) => ({ criteria, touches: [{ target: 'src/cart.test.ts', at: Date.now(), sessionId, kind: 'edit' as const, cwd: repo }] });
    expect(refreshLock(repo, { criteria, touches: [] }, agents, {}).approved['src/cart.test.ts']).toBeTruthy();
    fs.writeFileSync(test, SKIPPED);
    const after = refreshLock(repo, touched('tester'), agents, {});
    expect(fs.readFileSync(test, 'utf8')).toBe(BEFORE); // the testing agent gets no pass either
    expect(after.restored).toMatchObject([{ path: 'src/cart.test.ts', taskId: null, by: 'tester', why: 'skipped' }]);
    const renamed = BEFORE.replace('rounds', 'rounds to the cent');
    fs.writeFileSync(test, renamed);
    refreshLock(repo, touched('main'), agents, {});
    expect(fs.readFileSync(test, 'utf8')).toBe(renamed); // the main session may change it
    expect(fs.readFileSync(path.join(lockedCopiesDir(repo), 'src', 'cart.test.ts'), 'utf8')).toBe(renamed);
    expect(lockedCopiesDir(repo).startsWith(userData)).toBe(true);
    expect(fs.existsSync(path.join(repo, '.petal', 'locked'))).toBe(false); // never in the repo, where test runners look
    expect(readManifest(JSON.parse(fs.readFileSync(path.join(repoDir(repo), 'lock.json'), 'utf8'))).sessions).toEqual({ tester: { role: 'tester', taskId: 't-cart' } });
  });

  it('a weakening no Claude session made is never reverted: it asks once, then Keep or Restore settles it', () => {
    useTempUserData();
    const repo = tempDir('petal-repo-');
    fs.mkdirSync(path.join(repo, 'src'));
    const test = path.join(repo, 'src', 'cart.test.ts');
    fs.writeFileSync(test, BEFORE);
    setLock(repo, true, tempDir('petal-claude-'));
    const criteria = parseCriteria('## Scenarios\n- [pass] rounds · test: src/cart.test.ts::rounds\n');
    const inputs = { criteria, touches: [] };
    refreshLock(repo, inputs, [], {});
    const asked = (m: ReturnType<typeof loadManifest>) => m.restored.filter((f) => f.by === 'unconfirmed');

    const hers = BEFORE.replace('rounds', 'rounds, her edit');
    fs.writeFileSync(test, hers);
    expect(asked(refreshLock(repo, inputs, [], {}))).toEqual([]); // a whole change is taken quietly

    fs.writeFileSync(test, hers.replace('it(', 'it.skip('));
    const first = refreshLock(repo, inputs, [], {});
    expect(fs.readFileSync(test, 'utf8')).toBe(hers.replace('it(', 'it.skip('));
    expect(asked(first)).toMatchObject([{ path: 'src/cart.test.ts', by: 'unconfirmed', why: 'skipped' }]);
    expect(asked(refreshLock(repo, inputs, [], {}))).toEqual(asked(first)); // asks once, same flag

    dismissRestored(repo);
    expect(asked(loadManifest(repo))).toHaveLength(1); // Dismiss clears Restored lines, not questions

    expect(resolveUnconfirmed(repo, 'src/cart.test.ts', false)).toBeNull();
    expect(fs.readFileSync(test, 'utf8')).toBe(hers);
    expect(asked(refreshLock(repo, inputs, [], {}))).toEqual([]);
    expect(resolveUnconfirmed(repo, 'src/cart.test.ts', true)).toBe('That change was already handled.');

    fs.writeFileSync(test, hers.replace('it(', 'it.skip('));
    refreshLock(repo, inputs, [], {});
    expect(resolveUnconfirmed(repo, 'src/cart.test.ts', true)).toBeNull();
    expect(fs.readFileSync(path.join(lockedCopiesDir(repo), 'src', 'cart.test.ts'), 'utf8')).toBe(hers.replace('it(', 'it.skip('));
    expect(asked(refreshLock(repo, inputs, [], {}))).toEqual([]);
  });
});

describe('copies an older build kept in the repo', () => {
  const put = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  const legacy = (repo: string, ...rel: string[]) => path.join(repo, '.petal', 'locked', ...rel);
  const copy = (repo: string, ...rel: string[]) => path.join(lockedCopiesDir(repo), ...rel);

  it('the first refresh moves them to Petal’s storage, paths kept, and removes the in-repo folder', () => {
    useTempUserData();
    const repo = tempDir('petal-repo-');
    put(path.join(repo, 'app', '[lang]', 'preview.vn-salary.test.tsx'), 'it("vn")\n');
    put(legacy(repo, 'app', '[lang]', 'preview.vn-salary.test.tsx'), 'it("vn")\n');
    put(legacy(repo, 'src', 'cart.test.ts'), 'it("rounds")\n');
    setLock(repo, true, tempDir('petal-claude-'));
    refreshLock(repo, { criteria: null, touches: [] }, [], {});
    expect(fs.readFileSync(copy(repo, 'app', '[lang]', 'preview.vn-salary.test.tsx'), 'utf8')).toBe('it("vn")\n');
    expect(fs.readFileSync(copy(repo, 'src', 'cart.test.ts'), 'utf8')).toBe('it("rounds")\n');
    expect(fs.existsSync(legacy(repo))).toBe(false);
    expect(fs.existsSync(path.join(repoDir(repo), 'lock.json'))).toBe(true);
  });

  it('moves them with the lock off too, so a runner stops finding them', () => {
    useTempUserData();
    const repo = tempDir('petal-repo-');
    put(legacy(repo, 'a.test.ts'), 'a\n');
    refreshLock(repo, { criteria: null, touches: [] }, [], {});
    expect(fs.readFileSync(copy(repo, 'a.test.ts'), 'utf8')).toBe('a\n');
    expect(fs.existsSync(legacy(repo))).toBe(false);
  });

  it('never loses a copy: the approved one wins a clash, two unapproved ones both stay, a link stays put', () => {
    useTempUserData();
    const repo = tempDir('petal-repo-');
    const sha = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
    put(legacy(repo, 'approved.test.ts'), 'new\n');
    put(copy(repo, 'approved.test.ts'), 'old\n');
    put(legacy(repo, 'stale.test.ts'), 'stale\n');
    put(copy(repo, 'stale.test.ts'), 'approved\n');
    put(legacy(repo, 'both.test.ts'), 'one\n');
    put(copy(repo, 'both.test.ts'), 'two\n');
    fs.symlinkSync('/etc/hosts', legacy(repo, 'link.test.ts'));
    migrateLegacyCopies(repo, { 'approved.test.ts': sha('new\n'), 'stale.test.ts': sha('approved\n'), 'both.test.ts': sha('three\n') });
    expect(fs.readFileSync(copy(repo, 'approved.test.ts'), 'utf8')).toBe('new\n');
    expect(fs.existsSync(legacy(repo, 'approved.test.ts'))).toBe(false);
    expect(fs.readFileSync(copy(repo, 'stale.test.ts'), 'utf8')).toBe('approved\n');
    expect(fs.existsSync(legacy(repo, 'stale.test.ts'))).toBe(false);
    expect(fs.readFileSync(copy(repo, 'both.test.ts'), 'utf8')).toBe('two\n');
    expect(fs.readFileSync(legacy(repo, 'both.test.ts'), 'utf8')).toBe('one\n');
    expect(fs.lstatSync(legacy(repo, 'link.test.ts')).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(copy(repo, 'link.test.ts'))).toBe(false);
  });

  it('a locked test that is a link is never copied or approved', () => {
    useTempUserData();
    const repo = tempDir('petal-repo-');
    put(path.join(repo, 'real.ts'), 'x\n');
    fs.mkdirSync(path.join(repo, 'src'));
    fs.symlinkSync(path.join(repo, 'real.ts'), path.join(repo, 'src', 'cart.test.ts'));
    setLock(repo, true, tempDir('petal-claude-'));
    const criteria = parseCriteria('## Scenarios\n- [pass] rounds · test: src/cart.test.ts::rounds · round 1 · task: t-cart\n');
    const after = refreshLock(repo, { criteria, touches: [] }, [], {});
    expect(after.approved['src/cart.test.ts']).toBeUndefined();
    expect(fs.existsSync(copy(repo, 'src', 'cart.test.ts'))).toBe(false);
  });
});

describe('agent names', () => {
  it('trimmed, 1 to 32 characters, one line; empty resets; refused otherwise', () => {
    expect(cleanAgentName('  Quinn ')).toBe('Quinn');
    expect(cleanAgentName('   ')).toBeNull();
    expect(cleanAgentName('x'.repeat(33))).toBeUndefined();
    expect(cleanAgentName('a\nb')).toBeUndefined();
    expect(cleanAgentName(3)).toBeUndefined();
    expect(agentName({}, 'tester')).toBe('Testing agent');
    expect(agentName({ fixer: 'Fixie' }, 'fixer')).toBe('Fixie');
    expect(agentName({ fixer: 'a\nb' }, 'fixer')).toBe('Bug fix agent');
  });
});

describe('lastToucher', () => {
  const root = '/repo';
  const touch = (at: number, sessionId: string) => ({ target: '/repo/test/a.test.ts', at, sessionId, kind: 'edit' as const, cwd: root });

  it('credits the newest Claude touch that made the change', () => {
    expect(lastToucher([touch(1000, 's1'), touch(2000, 's2')], 'test/a.test.ts', root, 2000)).toBe('s2');
  });

  it('ignores touches from before the file last changed, so her own later edit is nobody', () => {
    const changedAt = 2000 + TOUCH_SLACK_MS + 1;
    expect(lastToucher([touch(2000, 'tester')], 'test/a.test.ts', root, changedAt)).toBeNull();
  });
});
