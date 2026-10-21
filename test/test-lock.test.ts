// The test lock: the hook's decision, its shell write patterns, failing open, the settings.local.json entry, and the
// integrity check that restores a locked test changed outside the testing agent.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';
// @ts-expect-error: a plain .mjs shipped as the hook, no type declarations
import { bashWrites, configNote, decide, isTestConfig, isTestPath, logRefusal } from '../resources/hooks/petal-test-lock.mjs';
import { LEGACY_LOCK_COMMAND, hasLockHook, lockCommand, lockHookStale, mergeLockHook, unmergeLockHook } from '../src/shared/lock-settings';
import { TOUCH_SLACK_MS, emptyManifest, integrityStep, isTestConfig as sharedIsTestConfig, isTestPath as sharedIsTestPath, lastToucher, lockedFiles, mainRefusals, readManifest, repoPath, restoredText } from '../src/shared/test-lock';
import { parseCriteria } from '../src/shared/test-loop';
import { dismissRestored, droppedCopiesDir, loadManifest, lockRefusals, lockedCopiesDir, migrateLegacyCopies, refreshLock, resolveUnconfirmed, setLock, upgradeLock } from '../src/main/test-lock';
import { agentName, cleanAgentName } from '../src/shared/agent-names';

afterEach(removeTempDirs);

const ROOT = '/r/shop';
const manifest = {
  version: 1, enabled: true, lockedPaths: ['src/cart.test.ts', '.petal/suites/t-cart.json'],
  sessions: { tester: { role: 'tester', taskId: 't-cart' }, fixer: { role: 'fixer', taskId: 't-cart' } }, names: {},
};
const edit = (session: string, file: string, tool = 'Edit') => ({ session_id: session, tool_name: tool, tool_input: { file_path: file }, cwd: ROOT });
const bash = (session: string, command: string) => ({ session_id: session, tool_name: 'Bash', tool_input: { command }, cwd: ROOT });
const TESTS_BELONG = 'Tests belong to Testing agent. Ask it to change them.';

describe('the hook’s decision', () => {
  it('the testing agent edits its tests and suite; anyone else is refused', () => {
    expect(decide(edit('tester', `${ROOT}/src/cart.test.ts`), manifest, ROOT)).toBeNull();
    expect(decide(edit('tester', '.petal/suites/t-cart.json', 'Write'), manifest, ROOT)).toBeNull();
    expect(decide(edit('main', `${ROOT}/src/cart.test.ts`), manifest, ROOT)).toBe(TESTS_BELONG);
    expect(decide(edit('unknown', 'src/cart.test.ts', 'MultiEdit'), manifest, ROOT)).toBe(TESTS_BELONG);
    expect(decide(edit('main', `${ROOT}/.petal/suites/t-other.json`), manifest, ROOT)).toBe(TESTS_BELONG);
    expect(decide({ ...edit('main', ''), tool_name: 'NotebookEdit', tool_input: { notebook_path: 'src/cart.test.ts' } }, manifest, ROOT)).toBe(TESTS_BELONG);
  });

  it('anything not locked goes through for the main session; outside the repo too', () => {
    expect(decide(edit('main', `${ROOT}/src/cart.ts`), manifest, ROOT)).toBeNull();
    expect(decide(edit('main', '/elsewhere/cart.test.ts'), manifest, ROOT)).toBeNull();
    expect(decide({ session_id: 'main', tool_name: 'Read', tool_input: { file_path: 'src/cart.test.ts' } }, manifest, ROOT)).toBeNull();
  });

  it('the bug fix agent fixes app code only; the testing agent changes tests only', () => {
    expect(decide(edit('fixer', `${ROOT}/src/cart.ts`), manifest, ROOT)).toBeNull();
    expect(decide(edit('fixer', `${ROOT}/src/other.test.ts`), manifest, ROOT)).toBe(TESTS_BELONG);
    expect(decide(edit('tester', `${ROOT}/src/cart.ts`), manifest, ROOT)).toBe('Testing agent only changes tests and the suite. App code belongs to Bug fix agent.');
    expect(decide(edit('tester', `${ROOT}/e2e/flow.ts`), manifest, ROOT)).toBeNull();
  });

  it('names are cosmetic: the reason uses them, permissions follow the role', () => {
    const named = { ...manifest, names: { tester: 'Quinn', fixer: 'Fixie' } };
    expect(decide(edit('main', 'src/cart.test.ts'), named, ROOT)).toBe('Tests belong to Quinn. Ask it to change them.');
    expect(decide(edit('tester', 'src/cart.test.ts'), named, ROOT)).toBeNull();
    expect(decide(edit('fixer', 'src/cart.ts'), named, ROOT)).toBeNull();
  });

  it('a shell line that writes to a locked file is refused; reading it is not', () => {
    for (const command of ['sed -i "" s/a/b/ src/cart.test.ts', 'echo x > src/cart.test.ts', 'cat a >> /r/shop/src/cart.test.ts', 'echo x | tee src/cart.test.ts', 'rm src/cart.test.ts', 'mv src/cart.test.ts old.ts', 'cp backup.ts src/cart.test.ts', 'git checkout -- src/cart.test.ts', 'git restore src/cart.test.ts', 'echo [] > .petal/suites/t-x.json']) {
      expect(decide(bash('main', command), manifest, ROOT), command).toBe(TESTS_BELONG);
    }
    for (const command of ['cat src/cart.test.ts', 'npx vitest run src/cart.test.ts', 'cp src/cart.test.ts /tmp/copy.ts', 'grep total src/cart.test.ts > /tmp/out', 'echo hi > src/cart.ts']) {
      expect(decide(bash('main', command), manifest, ROOT), command).toBeNull();
    }
    expect(decide(bash('tester', 'echo x > src/cart.test.ts'), manifest, ROOT)).toBeNull();
    expect(bashWrites('sed -n 1p src/cart.test.ts', 'src/cart.test.ts', ROOT)).toBe(false);
  });

  it('knows test paths', () => {
    expect(['src/a.test.ts', 'src/a.spec.js', 'tests/x.py', 'pkg/a_test.go', 'test_a.py', '.maestro/login.yaml', '__tests__/a.js'].every(isTestPath)).toBe(true);
    expect(['src/a.ts', 'src/testing.ts', 'latest/a.ts'].some(isTestPath)).toBe(false);
  });

  it('the testing agent may add runner setup; other sessions edit it too, noted in the lock log', () => {
    const configs = ['conftest.py', 'tests/conftest.py', 'jest.config.ts', 'vitest.config.mts', 'playwright.config.ts', 'pytest.ini', 'pyproject.toml', 'package.json', 'apps/web/package.json', 'vitest.setup.ts', 'src/setupTests.ts', '.mocharc.json'];
    expect(configs.every(isTestConfig)).toBe(true);
    expect(['src/config.ts', 'tsconfig.json', 'package-lock.json', 'jest.ts'].some(isTestConfig)).toBe(false);
    for (const file of configs) expect(decide(edit('tester', file), manifest, ROOT), file).toBeNull();
    expect(decide(edit('main', 'jest.config.ts'), manifest, ROOT)).toBeNull();
    expect(decide(edit('fixer', 'package.json'), manifest, ROOT)).toBeNull();
    expect(configNote(edit('main', 'jest.config.ts'), manifest, ROOT)).toBe('main edited test config jest.config.ts');
    expect(configNote(edit('tester', 'jest.config.ts'), manifest, ROOT)).toBeNull();
    expect(configNote(edit('main', 'src/cart.ts'), manifest, ROOT)).toBeNull();
    for (const file of [...configs, 'src/config.ts', 'tsconfig.json', 'jest.ts']) expect(sharedIsTestConfig(file), file).toBe(isTestConfig(file)); // one list in both places
    const owners = lockedFiles({ root: ROOT, suiteTasks: [], criteria: null, agents: [{ sessionId: 'tester', role: 'tester', taskId: 't' }], touches: ['package.json', 'jest.config.ts', 'src/a.test.ts'].map((target, at) => ({ target, at, sessionId: 'tester', kind: 'edit' as const, cwd: ROOT })) });
    expect(owners).toEqual({ 'src/a.test.ts': 't' }); // config the tester touched stays editable by everyone
  });

  it('per task: a testing agent edits unowned tests and its own task’s, never another task’s', () => {
    const two = {
      ...manifest,
      lockedPaths: ['src/cart.test.ts', 'src/coupon.test.ts', '.petal/suites/t-cart.json', '.petal/suites/t-coupon.json'],
      owners: { 'src/cart.test.ts': 't-cart', 'src/coupon.test.ts': 't-coupon', '.petal/suites/t-cart.json': 't-cart', '.petal/suites/t-coupon.json': 't-coupon' },
      sessions: { ...manifest.sessions, couponTester: { role: 'tester', taskId: 't-coupon' } },
    };
    const OTHER = (rel: string) => `${rel} belongs to another task's Testing agent. Ask that one to change it.`;
    expect(decide(edit('tester', 'src/cart.test.ts'), two, ROOT)).toBeNull();
    expect(decide(edit('tester', 'src/new.test.ts'), two, ROOT)).toBeNull();
    expect(decide(edit('tester', 'src/coupon.test.ts'), two, ROOT)).toBe(OTHER('src/coupon.test.ts'));
    expect(decide(edit('tester', '.petal/suites/t-coupon.json'), two, ROOT)).toBe(OTHER('.petal/suites/t-coupon.json'));
    expect(decide(edit('tester', '.petal/suites/t-later.json'), two, ROOT)).toBe(OTHER('.petal/suites/t-later.json')); // named by its file
    expect(decide(edit('couponTester', 'src/coupon.test.ts'), two, ROOT)).toBeNull();
    expect(decide(edit('couponTester', 'src/cart.test.ts'), two, ROOT)).toBe(OTHER('src/cart.test.ts'));
    expect(decide(bash('tester', 'echo x > src/coupon.test.ts'), two, ROOT)).toBe(OTHER('src/coupon.test.ts'));
    expect(decide(bash('tester', 'echo x > src/cart.test.ts'), two, ROOT)).toBeNull();
  });

  it('no manifest or a bad one lets everything through', () => {
    expect(decide(edit('main', 'src/cart.test.ts'), null, ROOT)).toBeNull();
    expect(decide(edit('main', 'src/cart.test.ts'), 'junk', ROOT)).toBeNull();
  });
});

describe('the hook script', () => {
  const script = path.resolve(__dirname, '../resources/hooks/petal-test-lock.mjs');
  const run = (repo: string, input: object): string => execFileSync(process.execPath, [script], { input: JSON.stringify(input), env: { ...process.env, CLAUDE_PROJECT_DIR: repo }, encoding: 'utf8' });

  it('denies with a reason as JSON, logs the refusal, and fails open on a corrupt manifest', () => {
    const repo = tempDir('petal-repo-');
    fs.mkdirSync(path.join(repo, '.petal'));
    fs.writeFileSync(path.join(repo, '.petal', 'lock.json'), JSON.stringify({ ...manifest, lockedPaths: ['src/cart.test.ts'] }));
    const denied = JSON.parse(run(repo, { ...edit('main', 'src/cart.test.ts'), cwd: repo }));
    expect(denied).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: TESTS_BELONG } });
    expect(fs.readFileSync(path.join(repo, '.petal', 'lock-refusals.jsonl'), 'utf8')).toContain('"session":"main"');
    expect(run(repo, { ...edit('main', 'src/cart.ts'), cwd: repo })).toBe('');
    fs.writeFileSync(path.join(repo, '.petal', 'lock.json'), '{ broken');
    expect(run(repo, { ...edit('main', 'src/cart.test.ts'), cwd: repo })).toBe('');
    expect(fs.readFileSync(path.join(repo, '.petal', 'lock.log'), 'utf8')).toMatch(/lock\.json unreadable/);
  });

  it('keeps only the newest 200 refusals', () => {
    const file = path.join(tempDir('petal-refusals-'), 'lock-refusals.jsonl');
    for (let i = 0; i < 205; i += 1) logRefusal(file, { at: i, session: 'main' });
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(200);
    expect(JSON.parse(lines[0] as string).at).toBe(5);
    expect(JSON.parse(lines[199] as string).at).toBe(204);
  });

  it('a copy in <repo>/.petal finds its own repo, whatever folder the session started in', () => {
    const repo = tempDir('petal-repo-');
    fs.mkdirSync(path.join(repo, '.petal'));
    fs.mkdirSync(path.join(repo, 'apps', 'web'), { recursive: true });
    fs.copyFileSync(script, path.join(repo, '.petal', 'test-lock.mjs'));
    fs.writeFileSync(path.join(repo, '.petal', 'lock.json'), JSON.stringify({ ...manifest, lockedPaths: ['apps/web/a.test.ts'] }));
    const sub = path.join(repo, 'apps', 'web');
    const out = execFileSync(process.execPath, [path.join(repo, '.petal', 'test-lock.mjs')], { input: JSON.stringify({ ...edit('main', 'a.test.ts'), cwd: sub }), env: { ...process.env, CLAUDE_PROJECT_DIR: sub }, encoding: 'utf8' });
    expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe('deny');
  });
});

describe('settings.local.json', () => {
  it('adds the lock once, keeps every other key and hook, and removes only its own entry', () => {
    const hers = { permissions: { allow: ['Bash(npm test)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }], Stop: [{ hooks: [] }] } };
    const on = mergeLockHook(hers, ROOT);
    expect(hasLockHook(on)).toBe(true);
    expect(mergeLockHook(on, ROOT)).toEqual(on);
    expect(on.permissions).toEqual(hers.permissions);
    expect((on.hooks as { PreToolUse: unknown[] }).PreToolUse).toHaveLength(2);
    expect(JSON.stringify(on)).toContain(`"command":"node '/r/shop/.petal/test-lock.mjs'"`);
    expect(unmergeLockHook(on)).toEqual(hers);
    expect(unmergeLockHook(mergeLockHook({}, ROOT))).toEqual({});
    expect(unmergeLockHook(hers)).toBe(hers);
  });

  it('the command holds the repo’s absolute path, shell-quoted; the old $CLAUDE_PROJECT_DIR entry upgrades in place', () => {
    expect(lockCommand("/Users/n/it's mono/")).toBe(`node '/Users/n/it'\\''s mono/.petal/test-lock.mjs'`);
    const old = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }, { matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash', hooks: [{ type: 'command', command: LEGACY_LOCK_COMMAND }] }] } };
    expect(hasLockHook(old)).toBe(true);
    expect(lockHookStale(old, ROOT)).toBe(true);
    const upgraded = mergeLockHook(old, ROOT);
    const groups = (upgraded.hooks as { PreToolUse: { hooks: { command: string }[] }[] }).PreToolUse;
    expect(groups.map((g) => g.hooks[0]?.command)).toEqual(['echo mine', lockCommand(ROOT)]);
    expect(lockHookStale(upgraded, ROOT)).toBe(false);
    expect(lockHookStale(upgraded, '/elsewhere')).toBe(true); // a moved repo gets its new path
    expect(unmergeLockHook(old)).toEqual({ hooks: { PreToolUse: [old.hooks.PreToolUse[0]] } });
  });

  it('an older install is upgraded: the bundled script and the absolute command replace the old ones', () => {
    useTempUserData();
    const repo = tempDir('petal-repo-');
    expect(setLock(repo, true)).toBeNull();
    const settingsFile = path.join(repo, '.claude', 'settings.local.json');
    fs.writeFileSync(settingsFile, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash', hooks: [{ type: 'command', command: LEGACY_LOCK_COMMAND }] }] } }));
    fs.writeFileSync(path.join(repo, '.petal', 'test-lock.mjs'), '// old build\n');
    upgradeLock(repo);
    expect(fs.readFileSync(settingsFile, 'utf8')).toContain(repo);
    expect(fs.readFileSync(settingsFile, 'utf8')).not.toContain('CLAUDE_PROJECT_DIR');
    expect(fs.readFileSync(path.join(repo, '.petal', 'test-lock.mjs'), 'utf8')).toContain('isTestConfig');
    fs.writeFileSync(settingsFile, '{ broken');
    upgradeLock(repo);
    expect(fs.readFileSync(settingsFile, 'utf8')).toBe('{ broken');
  });

  it('turning the lock on writes the script and the project’s settings; a broken settings file is left alone', () => {
    useTempUserData();
    const repo = tempDir('petal-repo-');
    expect(setLock(repo, true)).toBeNull();
    expect(fs.existsSync(path.join(repo, '.petal', 'test-lock.mjs'))).toBe(true);
    expect(hasLockHook(JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.local.json'), 'utf8')))).toBe(true);
    expect(loadManifest(repo).enabled).toBe(true);
    expect(setLock(repo, false)).toBeNull();
    expect(JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.local.json'), 'utf8'))).toEqual({});
    fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), '{ hers, broken');
    expect(setLock(repo, true)).toMatch(/settings.local.json isn’t valid JSON/);
    expect(fs.readFileSync(path.join(repo, '.claude', 'settings.local.json'), 'utf8')).toBe('{ hers, broken');
  });
});

describe('what is locked', () => {
  it('suite files, tests named in a task’s criteria lines, and files its testing agent edited', () => {
    const criteria = parseCriteria('## Scenarios\n- [pass] rounds · test: src/cart.test.ts::rounds · round 1 · task: t-cart\n- [pass] old · test: src/old.test.ts · round 1\n');
    const owners = lockedFiles({
      root: ROOT, suiteTasks: ['t-cart'], criteria,
      agents: [{ sessionId: 'tester', role: 'tester', taskId: 't-cart' }, { sessionId: 'fixer', role: 'fixer', taskId: 't-cart' }],
      touches: [{ target: 'e2e/flow.spec.ts', at: 1, sessionId: 'tester', kind: 'edit', cwd: ROOT }, { target: `${ROOT}/src/cart.ts`, at: 2, sessionId: 'fixer', kind: 'edit', cwd: ROOT }],
    });
    expect(owners).toEqual({ '.petal/suites/t-cart.json': 't-cart', 'src/cart.test.ts': 't-cart', 'e2e/flow.spec.ts': 't-cart' });
    expect(repoPath('../x', ROOT, `${ROOT}/src`)).toBe('x');
    expect(repoPath('/etc/passwd', ROOT)).toBeNull();
  });

  it('app code is never locked, though the testing agent edited it or a criteria line names it', () => {
    const app = 'app/[lang]/(modules)/employee/add-single/preview/preview-view.tsx';
    const test = 'app/[lang]/(modules)/employee/add-single/preview/preview-view.vn-salary.test.tsx';
    const criteria = parseCriteria(`## Bugs\n- [fail] vn salary · test: ${app} · round 1 · task: t-vn\n`);
    const owners = lockedFiles({
      root: ROOT, suiteTasks: ['t-vn'], criteria, agents: [{ sessionId: 'tester', role: 'tester', taskId: 't-vn' }],
      touches: [app, test, '.petal/notes.md'].map((target, at) => ({ target, at, sessionId: 'tester', kind: 'edit' as const, cwd: ROOT })),
    });
    expect(owners).toEqual({ '.petal/suites/t-vn.json': 't-vn', [test]: 't-vn' });
    for (const file of [app, test, 'src/a.ts', 'tests/x.py', '.petal/suites/t.json', 'latest/a.ts']) expect(sharedIsTestPath(file), file).toBe(isTestPath(file)); // one list in both places
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
    setLock(repo, true);
    const older = loadManifest(repo);
    const flags = [{ path: app, at: 1, taskId: 't', by: 'fixer' as const }, { path: app, at: 2, taskId: 't', by: 'unconfirmed' as const }, { path: test, at: 3, taskId: 't', by: 'main' as const }];
    fs.writeFileSync(path.join(repo, '.petal', 'lock.json'), JSON.stringify({ ...older, lockedPaths: [app, test], owners: { [app]: 't', [test]: 't' }, approved: { [app]: sha('old view\n'), [test]: sha('it("vn")\n') }, restored: flags }));
    fs.writeFileSync(file(app), 'fixed view\n'); // the bug fix agent's fix
    const fixerTouch = { target: app, at: Date.now(), sessionId: 'fixer', kind: 'edit' as const, cwd: repo };
    const agents = [{ sessionId: 'tester', role: 'tester' as const, taskId: 't' }, { sessionId: 'fixer', role: 'fixer' as const, taskId: 't' }];
    const testerTouch = { target: app, at: 0, sessionId: 'tester', kind: 'edit' as const, cwd: repo }; // the edit that locked it before
    const after = refreshLock(repo, { suiteTasks: [], criteria: parseCriteria(`## Scenarios\n- [pass] vn · test: ${test} · round 1 · task: t\n`), agents, touches: [testerTouch, fixerTouch] }, {});
    expect(fs.readFileSync(file(app), 'utf8')).toBe('fixed view\n');
    expect(after.lockedPaths).toEqual([test]);
    expect(Object.keys(after.approved)).toEqual([test]);
    expect(after.restored).toEqual([flags[2]]);
    expect(fs.existsSync(copy(app))).toBe(false);
    expect(fs.readFileSync(copy(app, droppedCopiesDir(repo)), 'utf8')).toBe('old view\n');
    expect(fs.readFileSync(copy(test), 'utf8')).toBe('it("vn")\n');
    fs.writeFileSync(file(app), 'fixed again\n');
    refreshLock(repo, { suiteTasks: [], criteria: null, agents, touches: [testerTouch, { ...fixerTouch, at: Date.now() }] }, {});
    expect(fs.readFileSync(file(app), 'utf8')).toBe('fixed again\n'); // never put back again
    expect(fs.readFileSync(copy(app, droppedCopiesDir(repo)), 'utf8')).toBe('old view\n');
  });

  it('the integrity step: approve the tester’s change, restore anyone else’s, approve a first sight', () => {
    const sessions = { tester: { role: 'tester' as const, taskId: 't' }, fixer: { role: 'fixer' as const, taskId: 't' } };
    expect(integrityStep('a', 'h2', 'h1', 'tester', sessions)).toEqual({ kind: 'approve', path: 'a' });
    expect(integrityStep('a', 'h2', 'h1', 'fixer', sessions)).toEqual({ kind: 'restore', path: 'a', by: 'fixer' });
    expect(integrityStep('a', 'h2', 'h1', 'main', sessions)).toEqual({ kind: 'restore', path: 'a', by: 'main' });
    expect(integrityStep('a', 'h2', 'h1', null, sessions)).toEqual({ kind: 'unconfirmed', path: 'a' });
    expect(integrityStep('a', null, 'h1', null, sessions)).toEqual({ kind: 'unconfirmed', path: 'a' });
    expect(restoredText({ path: 'src/a.test.ts', at: 1, taskId: 't', by: 'unconfirmed' }, 'Fixie')).toBe('src/a.test.ts changed outside Claude. Keep it or restore the locked copy?');
    expect(integrityStep('a', 'h1', 'h1', 'main', sessions)).toEqual({ kind: 'keep', path: 'a' });
    expect(integrityStep('a', 'h1', undefined, 'main', sessions)).toEqual({ kind: 'approve', path: 'a' });
    expect(restoredText({ path: 'a', at: 1, taskId: 't', by: 'main' }, 'Fixie')).toBe('Main session changed a test. Restored.');
    expect(restoredText({ path: 'a', at: 1, taskId: 't', by: 'fixer' }, 'Fixie')).toBe('Fixie changed a test. Restored.');
  });

  it('per task: another task’s testing agent changing a locked test is put back', () => {
    const sessions = { tester: { role: 'tester' as const, taskId: 't' }, other: { role: 'tester' as const, taskId: 'u' } };
    expect(integrityStep('a', 'h2', 'h1', 'tester', sessions, 't')).toEqual({ kind: 'approve', path: 'a' });
    expect(integrityStep('a', 'h2', 'h1', 'other', sessions, 't')).toEqual({ kind: 'restore', path: 'a', by: 'tester' });
    expect(restoredText({ path: 'a', at: 1, taskId: 't', by: 'tester' }, 'Fixie')).toBe('Another task’s testing agent changed a test. Restored.');
  });

  it('refusals of sessions that aren’t agents show in the lock bar until dismissed', () => {
    useTempUserData();
    const repo = tempDir('petal-repo-');
    setLock(repo, true);
    refreshLock(repo, { suiteTasks: [], criteria: null, agents: [{ sessionId: 'fixer', role: 'fixer', taskId: 't' }], touches: [] }, {});
    const lines = [
      { at: 10, session: 'main', tool: 'Edit', target: `${repo}/src/cart.test.ts`, reason: 'x' },
      { at: 11, session: 'fixer', tool: 'Edit', target: 'src/cart.test.ts', reason: 'x' },
      { at: 12, session: 'main', tool: 'Bash', target: 'rm src/cart.test.ts', reason: 'x' },
    ];
    fs.writeFileSync(path.join(repo, '.petal', 'lock-refusals.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\nnot json\n`);
    expect(lockRefusals(repo, loadManifest(repo))).toEqual([
      { at: 10, text: 'Main session tried to edit src/cart.test.ts. Refused.' },
      { at: 12, text: 'Main session tried to run rm src/cart.test.ts. Refused.' },
    ]);
    dismissRestored(repo, 't', 11);
    expect(lockRefusals(repo, loadManifest(repo)).map((r) => r.at)).toEqual([12]);
    expect(mainRefusals('', emptyManifest(), repo)).toEqual([]);
    expect(lockRefusals(tempDir('petal-repo-'), emptyManifest())).toEqual([]);
  });

  it('restores a locked test the main session changed, and keeps the testing agent’s change', () => {
    const userData = useTempUserData();
    const repo = tempDir('petal-repo-');
    fs.mkdirSync(path.join(repo, 'src'));
    const test = path.join(repo, 'src', 'cart.test.ts');
    fs.writeFileSync(test, 'it("rounds")\n');
    setLock(repo, true);
    const criteria = parseCriteria('## Scenarios\n- [pass] rounds · test: src/cart.test.ts::rounds · round 1 · task: t-cart\n');
    const agents = [{ sessionId: 'tester', role: 'tester' as const, taskId: 't-cart' }];
    const inputs = (touches: { target: string; at: number; sessionId: string; kind: 'edit' | 'bash'; cwd: string | null }[]) => ({ suiteTasks: [], criteria, agents, touches });
    expect(refreshLock(repo, inputs([]), {}).approved['src/cart.test.ts']).toBeTruthy();
    fs.writeFileSync(test, 'it.skip("rounds")\n');
    const after = refreshLock(repo, inputs([{ target: 'src/cart.test.ts', at: Date.now(), sessionId: 'main', kind: 'edit', cwd: repo }]), {});
    expect(fs.readFileSync(test, 'utf8')).toBe('it("rounds")\n');
    expect(after.restored).toMatchObject([{ path: 'src/cart.test.ts', taskId: 't-cart', by: 'main' }]);
    fs.writeFileSync(test, 'it("rounds to the cent")\n');
    refreshLock(repo, inputs([{ target: 'src/cart.test.ts', at: Date.now(), sessionId: 'tester', kind: 'edit', cwd: repo }]), {});
    expect(fs.readFileSync(test, 'utf8')).toBe('it("rounds to the cent")\n');
    expect(fs.readFileSync(path.join(lockedCopiesDir(repo), 'src', 'cart.test.ts'), 'utf8')).toBe('it("rounds to the cent")\n');
    expect(lockedCopiesDir(repo).startsWith(userData)).toBe(true);
    expect(fs.existsSync(path.join(repo, '.petal', 'locked'))).toBe(false); // never in the repo, where test runners look
    expect(readManifest(JSON.parse(fs.readFileSync(path.join(repo, '.petal', 'lock.json'), 'utf8'))).sessions).toEqual({ tester: { role: 'tester', taskId: 't-cart' } });
  });

  it('a change no Claude session made is never reverted: it asks once, then Keep or Restore settles it', () => {
    useTempUserData();
    const repo = tempDir('petal-repo-');
    fs.mkdirSync(path.join(repo, 'src'));
    const test = path.join(repo, 'src', 'cart.test.ts');
    fs.writeFileSync(test, 'it("rounds")\n');
    setLock(repo, true);
    const criteria = parseCriteria('## Scenarios\n- [pass] rounds · test: src/cart.test.ts::rounds · round 1 · task: t-cart\n');
    const inputs = { suiteTasks: [], criteria, agents: [{ sessionId: 'tester', role: 'tester' as const, taskId: 't-cart' }], touches: [] };
    refreshLock(repo, inputs, {});
    const asked = (m: ReturnType<typeof loadManifest>) => m.restored.filter((f) => f.by === 'unconfirmed');

    fs.writeFileSync(test, 'it("rounds, her edit")\n');
    const first = refreshLock(repo, inputs, {});
    expect(fs.readFileSync(test, 'utf8')).toBe('it("rounds, her edit")\n');
    expect(asked(first)).toMatchObject([{ path: 'src/cart.test.ts', taskId: 't-cart', by: 'unconfirmed' }]);
    expect(asked(refreshLock(repo, inputs, {}))).toEqual(asked(first)); // asks once, same flag

    dismissRestored(repo, 't-cart');
    expect(asked(loadManifest(repo))).toHaveLength(1); // Dismiss clears Restored lines, not questions

    expect(resolveUnconfirmed(repo, 'src/cart.test.ts', true)).toBeNull();
    expect(fs.readFileSync(path.join(lockedCopiesDir(repo), 'src', 'cart.test.ts'), 'utf8')).toBe('it("rounds, her edit")\n');
    expect(asked(refreshLock(repo, inputs, {}))).toEqual([]);
    expect(resolveUnconfirmed(repo, 'src/cart.test.ts', true)).toBe('That change was already handled.');

    fs.writeFileSync(test, 'it.skip("rounds")\n');
    refreshLock(repo, inputs, {});
    expect(resolveUnconfirmed(repo, 'src/cart.test.ts', false)).toBeNull();
    expect(fs.readFileSync(test, 'utf8')).toBe('it("rounds, her edit")\n');
    expect(asked(refreshLock(repo, inputs, {}))).toEqual([]);

    fs.writeFileSync(test, 'it.skip("rounds")\n');
    refreshLock(repo, inputs, {});
    fs.writeFileSync(test, 'it("rounds, her edit")\n'); // she put it back herself: the question drops
    expect(asked(refreshLock(repo, inputs, {}))).toEqual([]);
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
    setLock(repo, true);
    refreshLock(repo, { suiteTasks: [], criteria: null, agents: [], touches: [] }, {});
    expect(fs.readFileSync(copy(repo, 'app', '[lang]', 'preview.vn-salary.test.tsx'), 'utf8')).toBe('it("vn")\n');
    expect(fs.readFileSync(copy(repo, 'src', 'cart.test.ts'), 'utf8')).toBe('it("rounds")\n');
    expect(fs.existsSync(legacy(repo))).toBe(false);
    expect(fs.existsSync(path.join(repo, '.petal', 'lock.json'))).toBe(true);
  });

  it('moves them with the lock off too, so a runner stops finding them', () => {
    useTempUserData();
    const repo = tempDir('petal-repo-');
    put(legacy(repo, 'a.test.ts'), 'a\n');
    refreshLock(repo, { suiteTasks: [], criteria: null, agents: [], touches: [] }, {});
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
    setLock(repo, true);
    const criteria = parseCriteria('## Scenarios\n- [pass] rounds · test: src/cart.test.ts::rounds · round 1 · task: t-cart\n');
    const after = refreshLock(repo, { suiteTasks: [], criteria, agents: [], touches: [] }, {});
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
