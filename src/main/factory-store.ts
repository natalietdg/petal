// Where the factory lives and how Claude picks it up.
//   global:   <claudeDir>/petal-factory.json  ->  <claudeDir>/skills/factory/SKILL.md (Claude Code loads it as a skill)
//   project:  ~/.petal/repos/<repoKey>/factory.json  ->  factory.md beside it (the global skill says to follow it when present)
// Nothing is written inside a repo. A project skill an older build wrote at <repo>/.claude/skills/factory/SKILL.md is
// still read, never changed.
// claudeDir is null when she hasn't allowed the Claude folder: nothing there is read or written.
// Every write is atomic; a file Petal didn't generate, or a JSON file that doesn't parse, is never replaced.
import fs from 'node:fs';
import path from 'node:path';
import { writeFileDurable, type WriteGuard } from './atomic-file';
import { prepareRepoDir, repoDir } from './petal-home';
import { defaultFactory, isGenerated, renderSkill, validateFactory, type Factory } from '../shared/factory';

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
export const projectJson = (repo: string): string => path.join(repoDir(repo), 'factory.json');
export const projectMd = (repo: string): string => path.join(repoDir(repo), 'factory.md');
// An older build's repo-level project skill: read for what Claude follows, never written.
const PROJECT_SKILL_PATH = '.claude/skills/factory/SKILL.md';
export const projectSkillFile = (repo: string): string => path.join(repo, ...PROJECT_SKILL_PATH.split('/'));

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
function writeGenerated(file: string, text: string, foreignMessage: string, guard: WriteGuard = {}): void {
  const state = generatedState(file);
  if (state === 'foreign') throw new Error(foreignMessage);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileDurable(file, text, undefined, guard);
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

// The project's stations, in Petal's folder for the repo; the global skill points Claude at factory.md.
function saveProject(paths: FactoryPaths & { repo: string }, factory: Factory): void {
  const md = projectMd(paths.repo);
  if (generatedState(md) === 'foreign') throw new Error(foreignProjectMd(md));
  refuseBrokenJson(projectJson(paths.repo));
  const inPetal = { within: prepareRepoDir(paths.repo) };
  writeFileDurable(projectJson(paths.repo), `${JSON.stringify(factory, null, 2)}\n`, undefined, inPetal);
  writeGenerated(md, renderSkill(factory, 'project', path.basename(paths.repo)), foreignProjectMd(md), inPetal);
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

// "Use global": the project's files in Petal's folder go. A factory.md she wrote stops it first. An older build's
// project skill in the repo is left alone.
export function useGlobal(paths: FactoryPaths): FactoryState {
  if (!paths.repo) throw new Error('No project here: open a Claude session in a git repo first.');
  const md = projectMd(paths.repo);
  if (generatedState(md) === 'foreign') throw new Error(foreignProjectMd(md));
  fs.rmSync(projectJson(paths.repo), { force: true });
  fs.rmSync(md, { force: true });
  return loadFactoryState(paths);
}
