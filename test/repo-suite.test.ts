// The repo's one suite: the file (levels, opt-in, notes), taking any session's change with Undo, which stages Run runs,
// the main checkout every worktree shares, the one-time import of older per-task files, the seed and the agents' task.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';
import { addTask, assignTask, type Task, type TaskData } from '../src/shared/tasks';
import { addPrd, setTaskPrd, splitTask } from '../src/shared/task-groups';
import {
  autoRunStages, checkSuite, mergeSuites, parseSuiteText, shownStages, stagesToRun, suiteText, takeSuiteFile, type RepoSuite, type SuiteStage,
} from '../src/shared/repo-suite';
import { defaultTarget, keepTarget, parseTarget, targetValue, tasksInOrder } from '../src/shared/task-testing';
import { rememberAgent } from '../src/main/task-suites';
import { repoDir } from '../src/main/petal-home';
import { repoKey } from '../src/main/petal-repos';
import { homeFromCommonDir, importLegacySuites, suiteFile, suiteHome, syncSuite, undoSuiteChange, writeSuite } from '../src/main/repo-suite-store';
import { updateTasks } from '../src/main/tasks-store';
import { taskIdAt } from '../src/main/testing-tasks';
import { projectSeed } from '../src/main/testing-ipc';
import * as store from '../src/main/testing-store';

afterEach(removeTempDirs);

const stage = (name: string, extra: Partial<SuiteStage> = {}): SuiteStage => ({ id: name.toLowerCase(), name, command: `npm run ${name.toLowerCase()}`, level: 'regression', ...extra });
const suite = (...stages: SuiteStage[]): RepoSuite => ({ stages, keepGoing: false, autoRun: false });
const put = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });

// A real repo with one commit and a worktree beside it; both paths with links resolved (macOS /var is /private/var).
function repoWithWorktree(): { main: string; worktree: string } {
  const dir = fs.realpathSync(tempDir('petal-git-'));
  const main = path.join(dir, 'main');
  fs.mkdirSync(main);
  git(main, 'init', '-q');
  put(path.join(main, 'README.md'), 'x\n');
  git(main, 'add', 'README.md');
  git(main, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const worktree = path.join(dir, 'wt');
  git(main, 'worktree', 'add', '-q', worktree, '-b', 'feature');
  return { main, worktree };
}

describe('the suite file', () => {
  it('reads levels, opt-in and notes; a stage with no level is regression', () => {
    const parsed = parseSuiteText(JSON.stringify({ stages: [
      { name: 'Typecheck', command: 'npm run typecheck', level: 'smoke' },
      { name: 'Unit', command: 'npm test' },
      { name: 'Staging e2e', command: 'npm run e2e', level: 'staging', optIn: true, note: 'needs VPN' },
    ], keepGoing: true }));
    expect(parsed).toEqual({ suite: { keepGoing: true, autoRun: false, stages: [
      { id: 'typecheck', name: 'Typecheck', command: 'npm run typecheck', level: 'smoke' },
      { id: 'unit', name: 'Unit', command: 'npm test', level: 'regression' },
      { id: 'staging-e2e', name: 'Staging e2e', command: 'npm run e2e', level: 'staging', optIn: true, note: 'needs VPN' },
    ] } });
  });

  it('refuses what it can’t run: a bad level, a long name, a multi-line command or note, more than 20 stages', () => {
    const one = (item: object) => parseSuiteText(JSON.stringify({ stages: [item] }));
    expect(one({ name: 'Unit', command: 'npm test', level: 'nightly' })).toEqual({ problem: 'stage 1 has a level that isn’t smoke, regression or staging' });
    expect(one({ name: 'x'.repeat(61), command: 'npm test' })).toMatchObject({ problem: expect.stringMatching(/60 characters/) });
    expect(one({ name: 'Unit', command: 'npm test\nrm -rf /' })).toEqual({ problem: 'stage 1 needs a one-line command' });
    expect(one({ name: 'Unit', command: 'npm test', note: 'a\nb' })).toMatchObject({ problem: expect.stringMatching(/one-line note/) });
    expect(parseSuiteText(JSON.stringify({ stages: Array.from({ length: 21 }, (_, i) => ({ name: `S${i}`, command: 'true' })) }))).toEqual({ problem: 'it has more than 20 stages' });
    expect(parseSuiteText('{')).toEqual({ problem: 'it isn’t valid JSON' });
  });

  it('round-trips the shape Petal writes, so Claude edits the same thing', () => {
    const s = suite(stage('Unit', { level: 'smoke' }), stage('E2e', { level: 'staging', optIn: true, note: 'blocked on the staging login' }));
    const text = suiteText(s);
    expect(JSON.parse(text).stages[0]).toEqual({ name: 'Unit', command: 'npm run unit', level: 'smoke' });
    expect(parseSuiteText(text)).toEqual({ suite: s });
    expect(checkSuite({ stages: [] })).toEqual({ ok: true, suite: null });
    expect(checkSuite({ stages: [{ name: '', command: 'x' }] })).toEqual({ ok: false });
  });

  it('merges by name: the first suite’s stage wins, new names join at the end', () => {
    const merged = mergeSuites(suite(stage('Unit', { level: 'smoke' })), { ...suite(stage('Unit'), stage('Lint')), keepGoing: true });
    expect(merged.stages.map((s) => [s.name, s.level])).toEqual([['Unit', 'smoke'], ['Lint', 'regression']]);
    expect(merged.keepGoing).toBe(false);
    expect(mergeSuites(null, suite(stage('Lint'))).stages.map((s) => s.name)).toEqual(['Lint']);
  });
});

describe('taking any session’s change', () => {
  const file = (s: RepoSuite | null, at = 5) => ({ text: s ? suiteText(s) : null, at });

  it('first sight is taken quietly; any later change is taken with the old suite kept for Undo', () => {
    const first = takeSuiteFile(null, file(suite(stage('Unit'))));
    expect(first).toEqual({ text: suiteText(suite(stage('Unit'))), good: suite(stage('Unit')), change: null, problem: null });
    const next = takeSuiteFile(first, file(suite(stage('Unit'), stage('Lint')), 9));
    expect(next?.good?.stages.map((s) => s.name)).toEqual(['Unit', 'Lint']);
    expect(next?.change).toEqual({ at: 9, previous: suite(stage('Unit')) });
    expect(takeSuiteFile(next, file(suite(stage('Unit'), stage('Lint')), 9))).toBe(next); // unchanged text: left alone
  });

  it('a file that doesn’t parse keeps the suite in use and says why', () => {
    const first = takeSuiteFile(null, file(suite(stage('Unit'))));
    const bad = takeSuiteFile(first, { text: '{"stages": 3}', at: 7 });
    expect(bad).toMatchObject({ good: suite(stage('Unit')), problem: 'The suite file can’t be used: it should have a "stages" list.' });
  });
});

describe('what Run runs', () => {
  const stages = [stage('Typecheck', { level: 'smoke' }), stage('Unit'), stage('Staging', { level: 'staging', optIn: true, note: 'VPN' }), stage('Smoke e2e', { level: 'smoke', optIn: true })];

  it('the shown levels only; no level picked shows every one', () => {
    expect(shownStages(stages, []).length).toBe(4);
    expect(shownStages(stages, ['smoke']).map((s) => s.name)).toEqual(['Typecheck', 'Smoke e2e']);
  });

  it('opt-in stages are left out of Run unless she turned them on', () => {
    expect(stagesToRun(stages, { levels: [], optedIn: [] }).map((s) => s.name)).toEqual(['Typecheck', 'Unit']);
    expect(stagesToRun(stages, { levels: [], optedIn: ['staging'] }).map((s) => s.name)).toEqual(['Typecheck', 'Unit', 'Staging']);
    expect(stagesToRun(stages, { levels: ['staging'], optedIn: [] })).toEqual([]);
    expect(stagesToRun(stages, { levels: ['smoke'], optedIn: ['staging', 'smoke e2e'] }).map((s) => s.name)).toEqual(['Typecheck', 'Smoke e2e']);
    expect(stagesToRun(stages, { levels: [], optedIn: [] }, 'staging')).toEqual([]); // its own Run button still needs the toggle
    expect(stagesToRun(stages, { levels: [], optedIn: ['staging'] }, 'staging').map((s) => s.name)).toEqual(['Staging']);
  });

  it('auto-run never runs an opt-in stage', () => {
    expect(autoRunStages(stages).map((s) => s.name)).toEqual(['Typecheck', 'Unit']);
  });
});

describe('the main checkout', () => {
  it('is the parent of git’s common dir when that is a .git folder, else the checkout itself', () => {
    expect(homeFromCommonDir('/code/app/.git', '/code/app-wt')).toBe('/code/app');
    expect(homeFromCommonDir('/code/app.git', '/code/app-wt')).toBe('/code/app-wt'); // a bare repo: no main checkout to share
  });

  it('a worktree resolves to its main checkout, the main checkout to itself, a folder outside git to itself', () => {
    const { main, worktree } = repoWithWorktree();
    expect(suiteHome(worktree)).toBe(main);
    expect(suiteHome(main)).toBe(main);
    const loose = fs.realpathSync(tempDir('petal-loose-'));
    expect(suiteHome(loose)).toBe(loose);
  });

  it('a suite written from a worktree lands in Petal’s folder for main, nothing in either checkout, and both read the same one', () => {
    const home = useTempUserData(); // the electron mock's app.getPath('home')
    const { main, worktree } = repoWithWorktree();
    writeSuite(worktree, suite(stage('Unit')));
    const dir = path.join(home, '.petal', 'repos', repoKey(main));
    expect(suiteFile(suiteHome(worktree))).toBe(path.join(dir, 'suite.json'));
    expect(fs.existsSync(path.join(dir, 'suite.json'))).toBe(true);
    expect(fs.existsSync(path.join(main, '.petal'))).toBe(false);
    expect(fs.existsSync(path.join(worktree, '.petal'))).toBe(false);
    expect(syncSuite(main)).toMatchObject({ suite: suite(stage('Unit')), change: null, problem: null, home: main, dir, shownDir: `~/.petal/repos/${repoKey(main)}` });
    expect(syncSuite(worktree).suite).toEqual(suite(stage('Unit')));
  });

  it('another session’s edit is taken on the next read with Undo, and Undo puts the old stages back', () => {
    useTempUserData();
    const { main, worktree } = repoWithWorktree();
    writeSuite(main, suite(stage('Unit')));
    syncSuite(main);
    put(suiteFile(main), suiteText(suite(stage('Unit'), stage('Lint')))); // another session writes the file
    const changed = syncSuite(worktree);
    expect(changed.suite?.stages.map((s) => s.name)).toEqual(['Unit', 'Lint']);
    expect(changed.change?.previous).toEqual(suite(stage('Unit')));
    expect(undoSuiteChange(worktree)).toBe(true);
    expect(syncSuite(main)).toMatchObject({ suite: suite(stage('Unit')), change: null });
    expect(undoSuiteChange(main)).toBe(false);
  });
});

describe('the repo key', () => {
  it('is the main checkout’s path with every non-alphanumeric as "-": a worktree shares it, a folder outside git keys itself', () => {
    expect(repoKey('/home/me/shop-app')).toBe('-home-me-shop-app');
    expect(repoKey('/Users/n/my repo_2.0/ä')).toBe('-Users-n-my-repo-2-0--');
    const { main, worktree } = repoWithWorktree();
    expect(repoKey(suiteHome(worktree))).toBe(repoKey(main));
    const loose = fs.realpathSync(tempDir('petal-loose-'));
    expect(repoKey(suiteHome(loose))).toBe(repoKey(loose));
  });

  it('in a snapshot run, Petal’s folder is the harness’s fake home, never hers', async () => {
    const out = tempDir('petal-snap-');
    process.env.PASTEL_SNAPSHOT = '1';
    process.env.PASTEL_SNAPSHOT_DIR = out;
    try {
      const { petalHome, reposRoot } = await import('../src/main/petal-home');
      expect(petalHome()).toBe(path.join(out, 'fake-home'));
      expect(reposRoot()).toBe(path.join(out, 'fake-home', '.petal', 'repos'));
    } finally {
      delete process.env.PASTEL_SNAPSHOT;
      delete process.env.PASTEL_SNAPSHOT_DIR;
    }
  });
});

describe('importing a checkout’s old .petal once', () => {
  it('main’s .petal/suite.json becomes Petal’s copy byte for byte; the repo’s file is never changed and never taken again', () => {
    const home = useTempUserData();
    const { main } = repoWithWorktree();
    const old = JSON.stringify({ stages: [{ name: 'Unit', command: 'npm test' }] });
    put(path.join(main, '.petal', 'suite.json'), old);
    put(path.join(main, '.petal', '.gitignore'), '*\n');
    expect(syncSuite(main).suite?.stages.map((s) => s.name)).toEqual(['Unit']);
    const dir = path.join(home, '.petal', 'repos', repoKey(main));
    expect(fs.readFileSync(path.join(dir, 'suite.json'), 'utf8')).toBe(old);
    expect(fs.existsSync(path.join(dir, '.gitignore'))).toBe(false);
    writeSuite(main, suite(stage('Unit'), stage('Lint')));
    put(path.join(main, '.petal', 'suite.json'), JSON.stringify({ stages: [{ name: 'Later', command: 'x' }] })); // an old-skill session
    expect(syncSuite(main).suite?.stages.map((s) => s.name)).toEqual(['Unit', 'Lint']);
    expect(fs.readdirSync(path.join(main, '.petal')).sort()).toEqual(['.gitignore', 'suite.json']);
  });

  it('merges per-task suites and a worktree’s own suite by name, leaves the old files untouched, and never imports twice', () => {
    useTempUserData();
    const { main, worktree } = repoWithWorktree();
    const cart = JSON.stringify({ stages: [{ name: 'Unit', command: 'npm test' }, { name: 'Lint', command: 'npm run lint' }] });
    const coupon = JSON.stringify({ stages: [{ name: 'Unit', command: 'npx vitest' }, { name: 'E2e', command: 'npx playwright test' }] });
    const wtSuite = JSON.stringify({ stages: [{ name: 'Smoke', command: 'npm run smoke', level: 'smoke' }] });
    put(path.join(main, '.petal', 'suites', 't-cart.json'), cart);
    put(path.join(worktree, '.petal', 'suites', 't-coupon.json'), coupon); // written by an agent in the worktree
    put(path.join(worktree, '.petal', 'suite.json'), wtSuite);
    put(path.join(main, '.petal', 'suites', 'broken.json'), '{');
    const read = syncSuite(worktree);
    expect(read.suite?.stages.map((s) => [s.name, s.command, s.level])).toEqual([['Smoke', 'npm run smoke', 'smoke'], ['Unit', 'npm test', 'regression'], ['Lint', 'npm run lint', 'regression'], ['E2e', 'npx playwright test', 'regression']]);
    expect(fs.readFileSync(path.join(main, '.petal', 'suites', 't-cart.json'), 'utf8')).toBe(cart);
    expect(fs.readFileSync(path.join(worktree, '.petal', 'suites', 't-coupon.json'), 'utf8')).toBe(coupon);
    expect(fs.readFileSync(path.join(worktree, '.petal', 'suite.json'), 'utf8')).toBe(wtSuite);
    writeSuite(main, suite(stage('Unit'))); // she trims it; the old files must not bring stages back
    importLegacySuites(worktree);
    expect(syncSuite(main).suite?.stages.map((s) => s.name)).toEqual(['Unit']);
    expect(store.load(main).imported).toHaveLength(4);
  });

  it('a per-task file an older build already imported by its in-repo path is not merged again', () => {
    useTempUserData();
    const { main } = repoWithWorktree();
    const original = path.join(main, '.petal', 'suites', 't-cart.json');
    put(original, JSON.stringify({ stages: [{ name: 'Old', command: 'x' }] }));
    store.save({ ...store.load(main), imported: [original] });
    writeSuite(main, suite(stage('Unit')));
    expect(syncSuite(main).suite?.stages.map((s) => s.name)).toEqual(['Unit']);
  });
});

describe('the project’s commands as a seed', () => {
  it('.petal/pipeline.json first, else the pipeline she saved; a bad file says why', () => {
    useTempUserData();
    const root = tempDir('petal-repo-');
    expect(projectSeed(root)).toBeNull();
    store.savePipeline(root, { stages: [{ id: 'unit', name: 'Unit', command: 'npm test' }], keepGoing: false, autoRun: false, confirmed: [] });
    expect(projectSeed(root)).toEqual({ stages: [{ id: 'unit', name: 'Unit', command: 'npm test' }] });
    fs.mkdirSync(path.join(root, '.petal'));
    fs.writeFileSync(path.join(root, '.petal', 'pipeline.json'), JSON.stringify([{ name: 'Typecheck', command: 'npx tsc --noEmit' }])); // an older skill's file: copied into Petal on first read
    expect(projectSeed(root)).toEqual({ stages: [{ id: 'typecheck', name: 'Typecheck', command: 'npx tsc --noEmit' }] });
    store.savePipeline(root, { stages: [], keepGoing: false, autoRun: false, confirmed: [] });
    fs.writeFileSync(path.join(repoDir(root), 'pipeline.json'), '[1]'); // Petal's copy, keyed by this checkout
    expect(projectSeed(root)).toEqual({ problem: 'stage 1 should have only a name and a command' });
  });
});

// PRD "Checkout" holds a and b; b is split into b1 and b2; c is ungrouped; a is held by session s1.
function board(): TaskData {
  let tasks: Task[] = [];
  tasks = addTask(tasks, { title: 'Fix the cart total' }, 'a', 1);
  tasks = addTask(tasks, { title: 'Coupons' }, 'b', 2);
  tasks = addTask(tasks, { title: 'Docs' }, 'c', 3);
  const prds = addPrd([], { title: 'Checkout' }, 'p1', 4);
  tasks = setTaskPrd({ tasks, prds }, 'a', 'p1');
  tasks = setTaskPrd({ tasks, prds }, 'b', 'p1');
  tasks = splitTask(tasks, 'b', ['Coupon API', 'Coupon UI'], ['b1', 'b2'], 5);
  const given = assignTask(tasks, 'a', { sessionId: 's1', name: 'Cart work', branch: null }, 10);
  return { tasks: 'tasks' in given ? given.tasks : tasks, prds };
}

describe('the task whose agents the lanes show', () => {
  const data = board();

  it('lists PRD tasks first, subtasks under their task, then No PRD', () => {
    expect(tasksInOrder(data).map((t) => t.id)).toEqual(['a', 'b', 'b1', 'b2', 'c']);
  });

  it('defaults to the session’s task, else the first unfinished one; keeps her pick while it exists', () => {
    expect(defaultTarget(data, 'b2')).toEqual({ kind: 'task', id: 'b2' });
    expect(defaultTarget(data, null)).toEqual({ kind: 'task', id: 'a' });
    expect(defaultTarget({ tasks: [], prds: [] }, null)).toBeNull();
    expect(keepTarget({ kind: 'task', id: 'gone' }, data, 'c')).toEqual({ kind: 'task', id: 'c' });
    expect(parseTarget(targetValue({ kind: 'task', id: 'b1' }))).toEqual({ kind: 'task', id: 'b1' });
    expect(parseTarget('nope')).toBeNull();
  });

  it('a testing agent’s runs and rounds file under its task', () => {
    useTempUserData();
    const root = tempDir('petal-repo-');
    updateTasks(root, () => board());
    rememberAgent(root, 'c', 'agent-c');
    expect(taskIdAt(root, 'agent-c', 50)).toBe('c');
    expect(taskIdAt(root, 'nobody', 50)).toBeNull();
  });
});
