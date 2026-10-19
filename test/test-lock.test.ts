// The test lock: the hook's decision, its shell write patterns, failing open, the settings.local.json entry, and the
// integrity check that restores a locked test changed outside the testing agent.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';
// @ts-expect-error: a plain .mjs shipped as the hook, no type declarations
import { bashWrites, decide, isTestPath } from '../resources/hooks/petal-test-lock.mjs';
import { LOCK_COMMAND, hasLockHook, mergeLockHook, unmergeLockHook } from '../src/shared/lock-settings';
import { integrityStep, lockedFiles, readManifest, repoPath, restoredText } from '../src/shared/test-lock';
import { parseCriteria } from '../src/shared/test-loop';
import { dismissRestored, loadManifest, refreshLock, resolveUnconfirmed, setLock } from '../src/main/test-lock';
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
});

describe('settings.local.json', () => {
  it('adds the lock once, keeps every other key and hook, and removes only its own entry', () => {
    const hers = { permissions: { allow: ['Bash(npm test)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }], Stop: [{ hooks: [] }] } };
    const on = mergeLockHook(hers);
    expect(hasLockHook(on)).toBe(true);
    expect(mergeLockHook(on)).toEqual(on);
    expect(on.permissions).toEqual(hers.permissions);
    expect((on.hooks as { PreToolUse: unknown[] }).PreToolUse).toHaveLength(2);
    expect(JSON.stringify(on)).toContain(LOCK_COMMAND.replace(/"/g, '\\"'));
    expect(unmergeLockHook(on)).toEqual(hers);
    expect(unmergeLockHook(mergeLockHook({}))).toEqual({});
    expect(unmergeLockHook(hers)).toBe(hers);
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

  it('restores a locked test the main session changed, and keeps the testing agent’s change', () => {
    useTempUserData();
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
    const after = refreshLock(repo, inputs([{ target: 'src/cart.test.ts', at: 5, sessionId: 'main', kind: 'edit', cwd: repo }]), {});
    expect(fs.readFileSync(test, 'utf8')).toBe('it("rounds")\n');
    expect(after.restored).toMatchObject([{ path: 'src/cart.test.ts', taskId: 't-cart', by: 'main' }]);
    fs.writeFileSync(test, 'it("rounds to the cent")\n');
    refreshLock(repo, inputs([{ target: 'src/cart.test.ts', at: 9, sessionId: 'tester', kind: 'edit', cwd: repo }]), {});
    expect(fs.readFileSync(test, 'utf8')).toBe('it("rounds to the cent")\n');
    expect(fs.readFileSync(path.join(repo, '.petal', 'locked', 'src', 'cart.test.ts'), 'utf8')).toBe('it("rounds to the cent")\n');
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
    expect(fs.readFileSync(path.join(repo, '.petal', 'locked', 'src', 'cart.test.ts'), 'utf8')).toBe('it("rounds, her edit")\n');
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
