// Petal's own Claude Code skills (resources/skills/petal-*/SKILL.md), offered for ~/.claude/skills on request.
// Same rules as the reply styles: only petal-* folders, never overwrites a file Petal didn't write or one the user edited, never deletes.
import fs from 'node:fs';
import path from 'node:path';
import { writeFileDurable, writeJsonAtomic } from './atomic-file';
import { frontmatter, oneLine } from './workflow-frontmatter';
import { createNew, hash, readOrNull, readRecord, stateOf, type PetalStyleState } from './petal-styles';

export const PETAL_SKILL = /^petal-[a-z0-9-]+$/;
const SKILL_FILE = 'SKILL.md';
export const LIBRARY_DIR_TOKEN = '<LIBRARY_DIR>';

export interface PetalSkill {
  dir: string; // e.g. petal-library
  name: string;
  summary: string; // the description's first sentence
  state: PetalStyleState;
}

export interface PetalSkills {
  skills: PetalSkill[];
  installable: boolean; // any missing or outdated
}

export interface PetalSkillPaths {
  claudeDir: string;
  bundleDir: string;
  recordFile: string; // in Petal's userData: "<dir>/SKILL.md" → hash of what Petal last wrote
  libraryDir: string; // fills <LIBRARY_DIR> in the bundled text
}

// The bundled text as it lands on disk: the Library's absolute path filled in.
export const renderSkill = (text: string, libraryDir: string): string => text.split(LIBRARY_DIR_TOKEN).join(libraryDir);

function bundled({ bundleDir, libraryDir }: PetalSkillPaths): { dir: string; text: string }[] {
  let dirs: string[];
  try {
    dirs = fs.readdirSync(bundleDir).filter((d) => PETAL_SKILL.test(d) && fs.existsSync(path.join(bundleDir, d, SKILL_FILE))).sort();
  } catch {
    return [];
  }
  return dirs.map((dir) => ({ dir, text: renderSkill(fs.readFileSync(path.join(bundleDir, dir, SKILL_FILE), 'utf8'), libraryDir) }));
}

const recordKey = (dir: string): string => `${dir}/${SKILL_FILE}`;
const targetOf = (claudeDir: string, dir: string): string => path.join(claudeDir, 'skills', dir, SKILL_FILE);

// Each bundled skill and how its copy in <claudeDir>/skills/<dir>/SKILL.md stands.
export function petalSkills(paths: PetalSkillPaths): PetalSkills {
  const record = readRecord(paths.recordFile);
  const skills = bundled(paths).map(({ dir, text }) => {
    const meta = frontmatter(text);
    return { dir, name: meta.name?.trim() || dir, summary: oneLine(meta.description), state: stateOf(readOrNull(targetOf(paths.claudeDir, dir)), text, record[recordKey(dir)]) };
  });
  return { skills, installable: skills.some((s) => s.state === 'missing' || s.state === 'outdated') };
}

// Adds missing skills and updates Petal's own unedited copies; everything else is left as it is.
export function installPetalSkills(paths: PetalSkillPaths): PetalSkills {
  const record = readRecord(paths.recordFile);
  for (const { dir, text } of bundled(paths)) {
    const target = targetOf(paths.claudeDir, dir);
    const key = recordKey(dir);
    const onDisk = readOrNull(target);
    const state = stateOf(onDisk, text, record[key]);
    if (state === 'missing') {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      createNew(target, text);
    } else if (state === 'outdated') writeFileDurable(target, text, fs.statSync(target).mode & 0o7777);
    if (state === 'missing' || state === 'outdated' || (state === 'current' && record[key] === undefined)) record[key] = hash(text);
  }
  writeJsonAtomic(paths.recordFile, record, 2);
  return petalSkills(paths);
}
