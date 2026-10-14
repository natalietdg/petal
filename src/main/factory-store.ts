// Where the factory lives and how Claude picks it up.
//   global:   <claudeDir>/petal-factory.json  ->  <claudeDir>/skills/factory/SKILL.md (Claude Code loads it as a skill)
//   project:  <repo>/.petal/factory.json      ->  <repo>/.petal/factory.md (the global skill says to follow it when present)
//             and <repo>/.claude/skills/factory/SKILL.md (a project skill, so the override works with no global skill;
//             Claude Code prefers a personal skill of the same name, which then points at factory.md)
// Both project folders get a .gitignore of `*`, so nothing Petal writes in a repo is ever committed.
// claudeDir is null when she hasn't allowed the Claude folder: nothing there is read or written.
// Every write is atomic; a file Petal didn't generate, or a JSON file that doesn't parse, is never replaced.
import fs from 'node:fs';
import path from 'node:path';
import { writeFileDurable } from './atomic-file';
import { PROJECT_SKILL_PATH, defaultFactory, isGenerated, renderSkill, validateFactory, type Factory } from '../shared/factory';

export type FactoryScope = 'global' | 'project';
// What Claude follows right now: the project's file, the global skill, nothing yet, or a factory skill she wrote herself.
export type Follows = 'project' | 'global' | 'none' | 'foreign';

export interface FactoryPaths {
  claudeDir: string | null;
  repo: string | null; // git toplevel of the active tab's session, if any
}

export interface FactoryState {
  folderOff: boolean;
  global: { factory: Factory | null; saved: boolean; problem: string | null; file: string | null };
  skill: { file: string | null; state: 'generated' | 'missing' | 'foreign' };
  project: { repo: string; name: string; factory: Factory | null; problem: string | null; file: string } | null;
  follows: Follows;
}

export const FOLDER_OFF = 'Petal isn’t reading your Claude folder. Allow it under Customize › Get started.';

export const globalJson = (claudeDir: string): string => path.join(claudeDir, 'petal-factory.json');
export const skillFile = (claudeDir: string): string => path.join(claudeDir, 'skills', 'factory', 'SKILL.md');
export const projectJson = (repo: string): string => path.join(repo, '.petal', 'factory.json');
export const projectMd = (repo: string): string => path.join(repo, '.petal', 'factory.md');
export const projectSkillFile = (repo: string): string => path.join(repo, ...PROJECT_SKILL_PATH.split('/'));
const SELF_IGNORE = '*\n'; // ignores the folder it sits in, itself included

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

// null factory and null problem: no file yet.
function readFactoryFile(file: string): { factory: Factory | null; problem: string | null } {
  let text: string | null;
  try {
    text = readText(file);
  } catch {
    return { factory: null, problem: `Couldn’t read ${file}.` };
  }
  if (text === null) return { factory: null, problem: null };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { factory: null, problem: `${file} isn’t valid JSON. Fix or delete it; Petal won’t replace it.` };
  }
  const result = validateFactory(raw);
  return result.ok ? { factory: result.factory, problem: null } : { factory: null, problem: `${file}: ${result.problem} Fix or delete it; Petal won’t replace it.` };
}

function generatedState(file: string): 'generated' | 'missing' | 'foreign' {
  const text = readText(file);
  if (text === null) return 'missing';
  return isGenerated(text) ? 'generated' : 'foreign';
}

export function loadFactoryState({ claudeDir, repo }: FactoryPaths): FactoryState {
  const globalRead = claudeDir ? readFactoryFile(globalJson(claudeDir)) : { factory: null, problem: null };
  const global = {
    factory: globalRead.factory ?? (globalRead.problem ? null : defaultFactory()),
    saved: globalRead.factory !== null,
    problem: globalRead.problem,
    file: claudeDir && globalJson(claudeDir),
  };
  const skill = claudeDir ? { file: skillFile(claudeDir), state: generatedState(skillFile(claudeDir)) } : { file: null, state: 'missing' as const };
  const project = repo ? { repo, name: path.basename(repo), ...readFactoryFile(projectJson(repo)), file: projectJson(repo) } : null;
  let follows: Follows = 'none';
  if (skill.state === 'foreign') follows = 'foreign';
  else if (skill.state === 'generated') follows = repo && fs.existsSync(projectMd(repo)) ? 'project' : 'global';
  else if (claudeDir && repo && generatedState(projectSkillFile(repo)) === 'generated') follows = 'project';
  return { folderOff: !claudeDir, global, skill, project, follows };
}

// Replaces only a file Petal generated (or creates it); anything else is hers and stays.
function writeGenerated(file: string, text: string, foreignMessage: string): void {
  const state = generatedState(file);
  if (state === 'foreign') throw new Error(foreignMessage);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileDurable(file, text);
}

// A JSON file that is there but doesn't parse is hers to fix; saving over it would lose it.
function refuseBrokenJson(file: string): void {
  const { problem } = readFactoryFile(file);
  if (problem) throw new Error(problem);
}

const foreignSkill = (file: string): string => `A factory skill you wrote already exists at ${file}. Petal left it alone.`;
const foreignProjectMd = (file: string): string => `${file} wasn’t written by Petal, so Petal left it alone.`;

function validated(raw: unknown): Factory {
  const result = validateFactory(raw);
  if (!result.ok) throw new Error(result.problem);
  return result.factory;
}

function saveGlobal(claudeDir: string, factory: Factory): void {
  const skill = skillFile(claudeDir);
  if (generatedState(skill) === 'foreign') throw new Error(foreignSkill(skill)); // checked first so nothing is written
  refuseBrokenJson(globalJson(claudeDir));
  fs.mkdirSync(claudeDir, { recursive: true });
  writeFileDurable(globalJson(claudeDir), `${JSON.stringify(factory, null, 2)}\n`);
  writeGenerated(skill, renderSkill(factory, 'global'), foreignSkill(skill));
}

// Keeps a folder Petal writes in a repo out of git; a .gitignore she put there stays as it is.
function ensureSelfIgnore(dir: string): void {
  const file = path.join(dir, '.gitignore');
  if (!fs.existsSync(file)) writeFileDurable(file, SELF_IGNORE);
}

function removeOwnIgnore(dir: string): void {
  const file = path.join(dir, '.gitignore');
  if (readText(file) === SELF_IGNORE) fs.rmSync(file, { force: true });
}

// Removes each folder in turn while it is empty, stopping at the first that isn't.
function removeEmptyDirs(dirs: string[]): void {
  for (const dir of dirs) {
    try {
      fs.rmdirSync(dir);
    } catch {
      return;
    }
  }
}

// The project skill needs her consent for the Claude folder, like the global one, and never turns the factory on elsewhere.
function saveProject(paths: FactoryPaths & { repo: string }, factory: Factory): void {
  const md = projectMd(paths.repo);
  const projectSkill = projectSkillFile(paths.repo);
  if (generatedState(md) === 'foreign') throw new Error(foreignProjectMd(md));
  if (paths.claudeDir && generatedState(projectSkill) === 'foreign') throw new Error(foreignSkill(projectSkill));
  refuseBrokenJson(projectJson(paths.repo));
  const name = path.basename(paths.repo);
  fs.mkdirSync(path.dirname(md), { recursive: true });
  ensureSelfIgnore(path.dirname(md));
  writeFileDurable(projectJson(paths.repo), `${JSON.stringify(factory, null, 2)}\n`);
  writeGenerated(md, renderSkill(factory, 'project', name), foreignProjectMd(md));
  if (!paths.claudeDir) return;
  fs.mkdirSync(path.dirname(projectSkill), { recursive: true });
  ensureSelfIgnore(path.dirname(projectSkill));
  writeGenerated(projectSkill, renderSkill(factory, 'project-skill', name), foreignSkill(projectSkill));
}

export function saveFactory(paths: FactoryPaths, scope: FactoryScope, raw: unknown): FactoryState {
  const factory = validated(raw);
  if (scope === 'global') {
    if (!paths.claudeDir) throw new Error(FOLDER_OFF);
    saveGlobal(paths.claudeDir, factory);
  } else {
    if (!paths.repo) throw new Error('No project here: open a Claude session in a git repo first.');
    saveProject({ ...paths, repo: paths.repo }, factory);
  }
  return loadFactoryState(paths);
}

// "Use global": the project's files go, and their folders too once empty. A factory.md she wrote stops it first;
// a project factory skill she wrote is left alone.
export function useGlobal(paths: FactoryPaths): FactoryState {
  if (!paths.repo) throw new Error('No project here: open a Claude session in a git repo first.');
  const md = projectMd(paths.repo);
  if (generatedState(md) === 'foreign') throw new Error(foreignProjectMd(md));
  fs.rmSync(projectJson(paths.repo), { force: true });
  fs.rmSync(md, { force: true });
  removeOwnIgnore(path.dirname(md));
  removeEmptyDirs([path.dirname(md)]);

  const projectSkill = projectSkillFile(paths.repo);
  if (generatedState(projectSkill) === 'generated') {
    fs.rmSync(projectSkill, { force: true });
    const skillDir = path.dirname(projectSkill);
    removeOwnIgnore(skillDir);
    removeEmptyDirs([skillDir, path.dirname(skillDir), path.dirname(path.dirname(skillDir))]); // factory, skills, .claude
  }
  return loadFactoryState(paths);
}
