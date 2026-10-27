// Factory storage in temp dirs only: global vs project, the skill Claude reads, files Petal must never replace, consent.
// A project's files live in ~/.petal/repos/<repoKey>/ (the electron mock's home is the temp userData), never in the repo.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOLDER_OFF, globalJson, loadFactoryState, projectJson, projectMd, projectSkillFile, saveFactory, skillFile, useGlobal, type FactoryPaths } from '../src/main/factory-store';
import { GENERATED_MARKER, defaultFactory, renderSkill, type Factory } from '../src/shared/factory';
import { repoRoot } from '../src/main/repo-label';
import { repoKey } from '../src/main/petal-repos';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';

const edited = (name: string): Factory => {
  const factory = defaultFactory();
  factory.stations[0] = { ...factory.stations[0], name, instructions: `${name} instructions` };
  return factory;
};
const read = (file: string): string => fs.readFileSync(file, 'utf8');
const listAll = (dir: string): string[] => fs.readdirSync(dir, { recursive: true }).map(String).sort();

let claudeDir: string;
let repo: string;
let paths: FactoryPaths;
let petalHome: string;

beforeEach(() => {
  petalHome = useTempUserData();
  claudeDir = tempDir('petal-factory-claude-');
  repo = tempDir('petal-factory-repo-');
  fs.mkdirSync(path.join(repo, '.git'));
  paths = { claudeDir, repo };
});

afterEach(() => {
  vi.restoreAllMocks();
  removeTempDirs();
});

describe('loading', () => {
  it('shows the defaults, unsaved, and Claude follows nothing yet', () => {
    const state = loadFactoryState(paths);
    expect(state.global).toEqual({ factory: defaultFactory(), saved: false, problem: null, file: globalJson(claudeDir) });
    expect(state.skill.state).toBe('missing');
    expect(state.project).toMatchObject({ repo, name: path.basename(repo), factory: null, problem: null });
    expect(state.follows).toBe('none');
    expect(listAll(claudeDir)).toEqual([]); // loading writes nothing
  });

  it('reports a broken file in one line and leaves it as it is', () => {
    fs.writeFileSync(globalJson(claudeDir), '{ not json');
    fs.mkdirSync(path.dirname(projectJson(repo)), { recursive: true });
    fs.writeFileSync(projectJson(repo), JSON.stringify({ stations: [] }));
    const state = loadFactoryState(paths);
    expect(state.global.factory).toBeNull();
    expect(state.global.problem).toMatch(/isn’t valid JSON\. Fix or delete it; Petal won’t replace it\.$/);
    expect(state.project?.problem).toContain('at least one station');
    expect(() => saveFactory(paths, 'global', edited('X'))).toThrow(/isn’t valid JSON/);
    expect(() => saveFactory(paths, 'project', edited('X'))).toThrow(/at least one station/);
    expect(read(globalJson(claudeDir))).toBe('{ not json');
    expect(fs.existsSync(skillFile(claudeDir))).toBe(false);
  });
});

describe('global save', () => {
  it('writes the JSON and the skill, and Claude follows the global factory', () => {
    const state = saveFactory(paths, 'global', edited('Intake plus'));
    expect(JSON.parse(read(globalJson(claudeDir)))).toEqual(edited('Intake plus'));
    const skill = read(skillFile(claudeDir));
    expect(skill).toBe(renderSkill(edited('Intake plus'), 'global'));
    expect(skill).toContain('## 1. Intake plus');
    expect(skill).toContain('Intake plus instructions');
    expect(state).toMatchObject({ follows: 'global', skill: { state: 'generated' }, global: { saved: true, problem: null } });
  });

  it('reflects add, remove and reorder in the skill', () => {
    const factory = defaultFactory();
    factory.stations.splice(1, 1); // remove Research & plan
    factory.stations.push({ id: 'review', name: 'Review', instructions: 'Read the diff.', passCheck: 'No open comments.', runner: 'you' });
    [factory.stations[0], factory.stations[1]] = [factory.stations[1], factory.stations[0]];
    saveFactory(paths, 'global', factory);
    const headings = read(skillFile(claudeDir)).split('\n').filter((l) => l.startsWith('## '));
    expect(headings).toEqual(['## 1. Build', '## 2. Intake', '## 3. Test', '## 4. Integrate', '## 5. Ship', '## 6. Learn', '## 7. Review']);
  });

  it('refuses an invalid factory and writes nothing', () => {
    expect(() => saveFactory(paths, 'global', { stations: [] })).toThrow('at least one station');
    expect(listAll(claudeDir)).toEqual([]);
  });

  it('never overwrites a factory skill she wrote, and writes nothing else either', () => {
    fs.mkdirSync(path.dirname(skillFile(claudeDir)), { recursive: true });
    fs.writeFileSync(skillFile(claudeDir), '---\nname: factory\n---\nMy own steps.\n');
    expect(() => saveFactory(paths, 'global', edited('X'))).toThrow(/^A factory skill you wrote already exists at .*SKILL\.md\. Petal left it alone\.$/);
    expect(read(skillFile(claudeDir))).toBe('---\nname: factory\n---\nMy own steps.\n');
    expect(fs.existsSync(globalJson(claudeDir))).toBe(false);
    expect(loadFactoryState(paths).follows).toBe('foreign');
  });

  it('replaces its own earlier skill', () => {
    saveFactory(paths, 'global', edited('First'));
    saveFactory(paths, 'global', edited('Second'));
    expect(read(skillFile(claudeDir))).toContain('## 1. Second');
    expect(read(skillFile(claudeDir))).not.toContain('First');
  });

  it('is atomic: a failed rename keeps the old file and leaves no temp file', () => {
    saveFactory(paths, 'global', edited('Old'));
    const before = read(globalJson(claudeDir));
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('disk full'); });
    expect(() => saveFactory(paths, 'global', edited('New'))).toThrow('disk full');
    vi.restoreAllMocks();
    expect(read(globalJson(claudeDir))).toBe(before);
    expect(read(skillFile(claudeDir))).toContain('## 1. Old');
    expect(listAll(claudeDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('with the Claude folder off, refuses and touches nothing there', () => {
    const off = { claudeDir: null, repo };
    const state = loadFactoryState(off);
    expect(state).toMatchObject({ folderOff: true, follows: 'none', skill: { file: null, state: 'missing' }, global: { file: null, saved: false } });
    expect(() => saveFactory(off, 'global', edited('X'))).toThrow(FOLDER_OFF);
    expect(listAll(claudeDir)).toEqual([]);
  });
});

describe('project override', () => {
  it('writes factory.json and factory.md in Petal’s folder for the repo, nothing in the repo, nothing global', () => {
    const state = saveFactory(paths, 'project', edited('Project intake'));
    expect(path.dirname(projectJson(repo))).toBe(path.join(petalHome, '.petal', 'repos', repoKey(repo)));
    expect(JSON.parse(read(projectJson(repo)))).toEqual(edited('Project intake'));
    const md = read(projectMd(repo));
    expect(md.split('\n')[0]).toBe(GENERATED_MARKER);
    expect(md).toContain(`# Software factory for ${path.basename(repo)}`);
    expect(md).toContain('## 1. Project intake');
    expect(listAll(repo)).toEqual(['.git']); // no .petal, no .claude, no .gitignore
    expect(listAll(claudeDir)).toEqual([]); // no global skill, no global JSON: other repos stay untouched
    expect(state).toMatchObject({ follows: 'none', skill: { state: 'missing' }, project: { factory: edited('Project intake') } });
  });

  it('the global skill points Claude at the repo’s factory.md in ~/.petal by the repoKey rule', () => {
    const text = renderSkill(edited('G'), 'global');
    expect(text).toContain('`~/.petal/repos/<repoKey>/factory.md`');
    expect(text).toContain('`git rev-parse --show-toplevel`');
    expect(text).not.toContain('`.petal/factory.md` at its root');
  });

  it('an older build’s project skill in the repo is read for what Claude follows and never changed', () => {
    fs.mkdirSync(path.dirname(projectSkillFile(repo)), { recursive: true });
    const old = renderSkill(edited('Old'), 'project-skill', path.basename(repo));
    fs.writeFileSync(projectSkillFile(repo), old);
    expect(saveFactory(paths, 'project', edited('P')).follows).toBe('project');
    useGlobal(paths);
    expect(read(projectSkillFile(repo))).toBe(old);
    expect(fs.existsSync(path.join(repo, '.petal'))).toBe(false);
  });

  it('resolves global vs project: the global save leaves the override in charge for its repo', () => {
    saveFactory(paths, 'project', edited('P'));
    saveFactory(paths, 'global', edited('G'));
    expect(loadFactoryState(paths).follows).toBe('project');
    expect(loadFactoryState({ claudeDir, repo: null }).follows).toBe('global');
    const other = tempDir('petal-factory-other-');
    expect(loadFactoryState({ claudeDir, repo: other }).follows).toBe('global');
  });

  it('Use global deletes the override from Petal’s folder and leaves the repo as it was', () => {
    saveFactory(paths, 'global', edited('G'));
    saveFactory(paths, 'project', edited('P'));
    expect(useGlobal(paths)).toMatchObject({ follows: 'global', project: { factory: null } });
    expect(fs.existsSync(projectJson(repo))).toBe(false);
    expect(fs.existsSync(projectMd(repo))).toBe(false);
    expect(listAll(repo)).toEqual(['.git']);
  });

  it('never overwrites or deletes a factory.md she wrote', () => {
    fs.mkdirSync(path.dirname(projectMd(repo)), { recursive: true });
    fs.writeFileSync(projectMd(repo), '# My project steps\n');
    expect(() => saveFactory(paths, 'project', edited('P'))).toThrow(/wasn’t written by Petal/);
    expect(() => useGlobal(paths)).toThrow(/wasn’t written by Petal/);
    expect(read(projectMd(repo))).toBe('# My project steps\n');
    expect(fs.existsSync(projectJson(repo))).toBe(false);
  });

  it('a repo’s old .petal/factory.json is copied into Petal once and left in the repo as it was', () => {
    fs.mkdirSync(path.join(repo, '.petal'));
    const old = `${JSON.stringify(edited('From repo'), null, 2)}\n`;
    fs.writeFileSync(path.join(repo, '.petal', 'factory.json'), old);
    expect(loadFactoryState(paths).project?.factory).toEqual(edited('From repo'));
    saveFactory(paths, 'project', edited('Edited'));
    expect(read(path.join(repo, '.petal', 'factory.json'))).toBe(old);
    expect(fs.readdirSync(path.join(repo, '.petal'))).toEqual(['factory.json']);
  });

  it('works without the Claude folder but installs no skill anywhere', () => {
    const state = saveFactory({ claudeDir: null, repo }, 'project', edited('P'));
    expect(fs.existsSync(projectMd(repo))).toBe(true);
    expect(listAll(claudeDir)).toEqual([]);
    expect(fs.existsSync(path.join(repo, '.claude'))).toBe(false);
    expect(state.follows).toBe('none');
  });

  it('needs a project', () => {
    expect(() => saveFactory({ claudeDir, repo: null }, 'project', edited('P'))).toThrow(/open a Claude session in a git repo/);
  });
});

describe('repoRoot', () => {
  it('walks up to the git toplevel, a worktree pointer included, and is null outside git', () => {
    const nested = path.join(repo, 'src', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    expect(repoRoot(nested)).toBe(repo);
    const worktree = tempDir('petal-factory-wt-');
    fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(repo, '.git')}\n`);
    expect(repoRoot(worktree)).toBe(worktree);
    expect(repoRoot(tempDir('petal-factory-plain-'))).toBeNull();
    expect(repoRoot(null)).toBeNull();
  });
});

describe('the IPC asks the folder gate', () => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const event = { sender: { id: 1 } };

  async function register(choice: string) {
    vi.resetModules();
    handlers.clear();
    process.env.PASTEL_SNAPSHOT = '1'; // only the stand-in folders below are used
    process.env.PASTEL_SNAPSHOT_DIR = tempDir('petal-factory-snap-'); // its fake home holds ~/.petal
    const userData = useTempUserData();
    fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ claudeFolder: { choice } }));
    vi.doMock('../src/main/ipc', () => ({ handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, handler) }));
    const mode = await import('../src/main/snapshot-mode');
    mode.folderFixture.home = claudeDir;
    mode.factoryFixture.claudeDir = claudeDir;
    mode.factoryFixture.repo = repo;
    const ipc = await import('../src/main/factory-ipc');
    ipc.registerFactoryIpc({ activeSession: () => undefined });
  }

  afterEach(() => {
    delete process.env.PASTEL_SNAPSHOT;
    delete process.env.PASTEL_SNAPSHOT_DIR;
    vi.doUnmock('../src/main/ipc');
  });

  it('declined: reads and writes nothing in the Claude folder', async () => {
    await register('declined');
    expect(handlers.get('factory:get')?.(event)).toMatchObject({ folderOff: true });
    expect(() => handlers.get('factory:save')?.(event, { scope: 'global', repo: null, factory: edited('X') })).toThrow(FOLDER_OFF);
    expect(listAll(claudeDir)).toEqual([]);
  });

  it('allowed: saves to the stand-in, and a project write must name the active repo', async () => {
    await register('allowed');
    handlers.get('factory:save')?.(event, { scope: 'global', repo: null, factory: edited('X') });
    expect(read(skillFile(claudeDir))).toContain('## 1. X');
    expect(() => handlers.get('factory:save')?.(event, { scope: 'project', repo: '/somewhere/else', factory: edited('X') })).toThrow(/another project/);
    expect(() => handlers.get('factory:use-global')?.(event, { repo: '/somewhere/else' })).toThrow(/another project/);
    handlers.get('factory:save')?.(event, { scope: 'project', repo, factory: edited('P') });
    expect(read(projectMd(repo))).toContain('## 1. P');
  });
});

describe('symlinks', () => {
  it('a factory.json in Petal’s folder that links outside it is refused, and nothing lands outside', () => {
    const outsideDir = tempDir('petal-factory-outside-');
    fs.mkdirSync(path.dirname(projectJson(repo)), { recursive: true });
    fs.symlinkSync(path.join(outsideDir, 'planted.json'), projectJson(repo)); // dangling, so it isn't refused as broken JSON
    expect(() => saveFactory(paths, 'project', edited('P'))).toThrow(/^Petal didn’t write .*factory\.json: it leads to .*planted\.json, outside /);
    expect(fs.readdirSync(outsideDir)).toEqual([]);
  });

  it('a symlinked global skill stays a link and its target gets the update', () => {
    saveFactory(paths, 'global', edited('First'));
    const dotfiles = tempDir('petal-factory-dotfiles-');
    const real = path.join(dotfiles, 'SKILL.md');
    fs.renameSync(skillFile(claudeDir), real);
    fs.symlinkSync(real, skillFile(claudeDir));
    saveFactory(paths, 'global', edited('Second'));
    expect(fs.lstatSync(skillFile(claudeDir)).isSymbolicLink()).toBe(true);
    expect(read(real)).toContain('Second');
  });
});
