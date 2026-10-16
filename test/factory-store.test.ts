// Factory storage in temp dirs only: global vs project, the skill Claude reads, files Petal must never replace, consent.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOLDER_OFF, globalJson, loadFactoryState, projectJson, projectMd, projectSkillFile, saveFactory, skillFile, useGlobal, type FactoryPaths } from '../src/main/factory-store';
import { GENERATED_MARKER, defaultFactory, renderSkill, type Factory } from '../src/shared/factory';
import { repoRoot } from '../src/main/repo-label';
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

beforeEach(() => {
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
    fs.mkdirSync(path.join(repo, '.petal'));
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
  it('writes .petal/factory.json, factory.md and a project skill; Claude follows the project and nothing turns on globally', () => {
    const state = saveFactory(paths, 'project', edited('Project intake'));
    expect(JSON.parse(read(projectJson(repo)))).toEqual(edited('Project intake'));
    const md = read(projectMd(repo));
    expect(md.split('\n')[0]).toBe(GENERATED_MARKER);
    expect(md).toContain(`# Software factory for ${path.basename(repo)}`);
    expect(md).toContain('## 1. Project intake');
    expect(read(projectSkillFile(repo))).toBe(renderSkill(edited('Project intake'), 'project-skill', path.basename(repo)));
    expect(listAll(claudeDir)).toEqual([]); // no global skill, no global JSON: other repos stay untouched
    expect(state).toMatchObject({ follows: 'project', skill: { state: 'missing' }, project: { factory: edited('Project intake') } });
    expect(loadFactoryState({ claudeDir, repo: tempDir('petal-factory-other-') }).follows).toBe('none');
  });

  it('keeps every file it writes in the repo out of git, without touching her own .gitignore', () => {
    fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules\n');
    saveFactory(paths, 'project', edited('P'));
    expect(read(path.join(repo, '.petal', '.gitignore'))).toBe('*\n');
    expect(read(path.join(path.dirname(projectSkillFile(repo)), '.gitignore'))).toBe('*\n');
    expect(read(path.join(repo, '.gitignore'))).toBe('node_modules\n');
  });

  it('leaves a .gitignore she put in .petal as it is, on save and on Use global', () => {
    fs.mkdirSync(path.join(repo, '.petal'));
    fs.writeFileSync(path.join(repo, '.petal', '.gitignore'), 'factory.json\n');
    saveFactory(paths, 'project', edited('P'));
    expect(read(path.join(repo, '.petal', '.gitignore'))).toBe('factory.json\n');
    useGlobal(paths);
    expect(fs.readdirSync(path.join(repo, '.petal'))).toEqual(['.gitignore']);
  });

  it('never overwrites a project factory skill she wrote, and writes nothing else either', () => {
    fs.mkdirSync(path.dirname(projectSkillFile(repo)), { recursive: true });
    fs.writeFileSync(projectSkillFile(repo), '---\nname: factory\n---\nTeam steps.\n');
    expect(() => saveFactory(paths, 'project', edited('P'))).toThrow(/A factory skill you wrote already exists/);
    expect(fs.existsSync(path.join(repo, '.petal'))).toBe(false);
    useGlobal(paths);
    expect(read(projectSkillFile(repo))).toBe('---\nname: factory\n---\nTeam steps.\n');
  });

  it('resolves global vs project: the global save leaves the override in charge for its repo', () => {
    saveFactory(paths, 'project', edited('P'));
    saveFactory(paths, 'global', edited('G'));
    expect(loadFactoryState(paths).follows).toBe('project');
    expect(loadFactoryState({ claudeDir, repo: null }).follows).toBe('global');
    const other = tempDir('petal-factory-other-');
    expect(loadFactoryState({ claudeDir, repo: other }).follows).toBe('global');
  });

  it('Use global deletes the override, its .gitignore files, and the folders when nothing else is in them', () => {
    saveFactory(paths, 'global', edited('G'));
    saveFactory(paths, 'project', edited('P'));
    expect(useGlobal(paths)).toMatchObject({ follows: 'global', project: { factory: null } });
    expect(fs.existsSync(path.join(repo, '.petal'))).toBe(false);
    expect(fs.existsSync(path.join(repo, '.claude'))).toBe(false);

    fs.mkdirSync(path.join(repo, '.claude'));
    fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), '{}');
    saveFactory(paths, 'project', edited('P'));
    useGlobal(paths);
    expect(listAll(path.join(repo, '.claude'))).toEqual(['settings.json']);

    saveFactory(paths, 'project', edited('P'));
    fs.writeFileSync(path.join(repo, '.petal', 'notes.txt'), 'mine');
    useGlobal(paths);
    expect(fs.readdirSync(path.join(repo, '.petal'))).toEqual(['notes.txt']);
  });

  it('never overwrites or deletes a factory.md she wrote', () => {
    fs.mkdirSync(path.join(repo, '.petal'));
    fs.writeFileSync(projectMd(repo), '# My project steps\n');
    expect(() => saveFactory(paths, 'project', edited('P'))).toThrow(/wasn’t written by Petal/);
    expect(() => useGlobal(paths)).toThrow(/wasn’t written by Petal/);
    expect(read(projectMd(repo))).toBe('# My project steps\n');
    expect(fs.existsSync(projectJson(repo))).toBe(false);
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

describe('symlinks in a repo', () => {
  it('a cloned repo whose .petal/factory.json links outside it is refused, and nothing lands outside', () => {
    const outsideDir = tempDir('petal-factory-outside-');
    fs.mkdirSync(path.join(repo, '.petal'));
    fs.writeFileSync(path.join(repo, '.petal', '.gitignore'), '*\n');
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
