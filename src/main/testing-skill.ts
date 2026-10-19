// The testing-suite skill as the drafting agent will meet it: used as installed, Petal's unedited old copy updated
// first, or (missing, edited, or a snapshot run with no stand-in folder) its bundled instructions put in the brief.
import path from 'node:path';
import { app } from 'electron';
import { bundledSkill, petalSkills, updatePetalSkill, type PetalSkillPaths } from './petal-skills';
import { libraryDir } from './library-store';
import { TESTING_SKILL, draftBrief, skillUse, type SkillState } from '../shared/suite-draft';

// Packaged: Contents/Resources/skills; dev: the repo's resources folder.
export const skillsBundleDir = (): string => (app.isPackaged ? path.join(process.resourcesPath, 'skills') : path.join(app.getAppPath(), 'resources', 'skills'));

export const petalSkillPaths = (claudeDir: string): PetalSkillPaths => ({
  claudeDir, bundleDir: skillsBundleDir(), recordFile: path.join(app.getPath('userData'), 'petal-skills.json'), libraryDir: libraryDir(),
});

export interface DraftSkill { brief: string; updated: boolean; inline: boolean }

// claudeDir: the Claude folder she allowed (its consent covers skills/petal-*), or null when it must not be read or written.
export function draftWithSkill(claudeDir: string | null, request: string): DraftSkill {
  const bundle = petalSkillPaths(claudeDir ?? '');
  const text = bundledSkill(bundle, TESTING_SKILL) ?? '';
  const state: SkillState | null = claudeDir ? petalSkills(bundle).skills.find((s) => s.dir === TESTING_SKILL)?.state ?? null : null;
  let use = skillUse(state);
  let updated = false;
  if (use === 'update' && claudeDir) {
    try {
      updated = updatePetalSkill(bundle, TESTING_SKILL) === 'outdated';
    } catch (error) {
      console.warn('[petal] testing skill update failed, putting its instructions in the brief:', error);
    }
    use = updated ? 'skill' : 'inline';
  }
  const inline = use !== 'skill' && Boolean(text); // an app without the bundled copy can only name the skill
  return { brief: draftBrief(inline, request, text), updated, inline };
}
