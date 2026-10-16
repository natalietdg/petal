// IPC for the Customize page: everything it shows in one read, config edits, the hook test, the output style switch, and Look setters.
import fs from 'node:fs';
import path from 'node:path';
import { app, shell } from 'electron';
import { CAT_CHOICES, SCENE_CHOICES, READING_CHOICES, isReadingChoice } from './menu';
import * as organizer from './session-organizer';
import { callsToday } from './background-calls';
import * as configStore from './config-store';
import * as responseHook from './response-hook';
import { toMarkdown } from './handoff';
import { applyCat, applyReading, applyScene, applyTheme, settings, themes } from './look';
import { handle, on } from './ipc';
import { activeStyleName, listOutputStyles, setOutputStyle, type OutputStyles } from './output-styles';
import { installPetalStyles, petalStyles, type PetalPaths, type PetalStyles } from './petal-styles';
import { installPetalSkills, petalSkills, type PetalSkillPaths, type PetalSkills } from './petal-skills';
import { libraryDir } from './library-store';
import { isSnapshotRun, stylesFixture } from './snapshot-mode';
import { allowedClaudeHome } from './claude-folder';
import type { StyleSwitch } from './output-styles';
import type { CustomizeState } from '../shared/ipc';
import type { Choice } from '../shared/types';

const FOLDER_OFF = 'Petal isn’t reading your Claude folder. Allow it under Customize › Get started.';

// Her ~/.claude once she allows reading it; snapshot runs read and write a stand-in when the harness sets one.
function claudeDir(): string | null {
  const home = allowedClaudeHome();
  return home && ((isSnapshotRun() && stylesFixture.claudeDir) || home);
}
function claudeDirOrRefuse(): string {
  const dir = claudeDir();
  if (!dir) throw new Error(FOLDER_OFF);
  return dir;
}

// Opens a listed style in her default editor; any other path is refused.
async function openStyle(file: string): Promise<{ ok: true }> {
  if (!listOutputStyles(claudeDirOrRefuse()).styles.some((s) => s.file === file)) throw new Error('not one of your output styles');
  if (isSnapshotRun()) {
    stylesFixture.opened.push(file);
    return { ok: true };
  }
  const failure = await shell.openPath(file);
  if (failure) throw new Error(failure);
  return { ok: true };
}

// A snapshot run without a stand-in ~/.claude never writes there.
function refuseRealWriteInSnapshot(): void {
  if (isSnapshotRun() && !stylesFixture.claudeDir) throw new Error('snapshot runs only write a stand-in ~/.claude');
}

// Writes outputStyle in settings.json.
function useStyle(name: string): StyleSwitch {
  refuseRealWriteInSnapshot();
  return setOutputStyle(name, claudeDirOrRefuse());
}

// Packaged: Contents/Resources/output-styles (electron-builder extraResources); dev: the repo's resources folder.
export const bundleDir = (): string => (app.isPackaged ? path.join(process.resourcesPath, 'output-styles') : path.join(app.getAppPath(), 'resources', 'output-styles'));
const petalPaths = (): PetalPaths => ({ claudeDir: claudeDirOrRefuse(), bundleDir: bundleDir(), recordFile: path.join(app.getPath('userData'), 'petal-styles.json') });

function addPetalStyles(): PetalStyles {
  refuseRealWriteInSnapshot();
  return installPetalStyles(petalPaths());
}

// Packaged: Contents/Resources/skills; dev: the repo's resources folder.
export const skillsBundleDir = (): string => (app.isPackaged ? path.join(process.resourcesPath, 'skills') : path.join(app.getAppPath(), 'resources', 'skills'));
const petalSkillPaths = (): PetalSkillPaths => ({ claudeDir: claudeDirOrRefuse(), bundleDir: skillsBundleDir(), recordFile: path.join(app.getPath('userData'), 'petal-skills.json'), libraryDir: libraryDir() });

function addPetalSkills(): PetalSkills {
  refuseRealWriteInSnapshot();
  return installPetalSkills(petalSkillPaths());
}

const HANDOFF_SAMPLE = {
  record: { title: 'Fix the reader session', cwd: '~/Code/petal', sessionId: '<session id>', file: '~/.claude/projects/<folder>/<session id>.jsonl' },
  turns: [{ prompt: 'why did the reader switch sessions?', reply: ['**The reader now follows only the claude inside this window.**'] }],
};

// The bundled petal-magazine.md first, then a hand-made magazine.md.
const MAGAZINE_FILES = ['petal-magazine.md', 'magazine.md'];
export const findMagazineStyle = (stylesDir: string): string | null =>
  MAGAZINE_FILES.map((file) => path.join(stylesDir, file)).find((file) => fs.existsSync(file)) ?? null;

// Everything the Customize page shows, in one read.
// Reading off: no styles listed and nothing to add, so nothing under ~/.claude is read.
const NO_STYLES: OutputStyles = { dir: '', active: null, styles: [], problem: FOLDER_OFF };
const NO_PETAL_STYLES: PetalStyles = { styles: [], installable: false };
const NO_PETAL_SKILLS: PetalSkills = { skills: [], installable: false };

function customizeState(): CustomizeState {
  const dir = claudeDir();
  const magazinePath = dir ? findMagazineStyle(path.join(dir, 'output-styles')) : null;
  const { theme, reading, cat, scene } = settings();
  return {
    config: configStore.load(),
    defaults: configStore.defaults(),
    models: configStore.MODELS,
    look: { theme, reading, cat, scene },
    choices: {
      themes: Object.entries(themes).map(([id, t]): Choice => [id, t.label]),
      reading: READING_CHOICES,
      cats: CAT_CHOICES,
      scenes: SCENE_CHOICES,
    },
    outputStyle: dir ? activeStyleName(dir) : null,
    outputStyles: dir ? listOutputStyles(dir) : NO_STYLES,
    petalStyles: dir ? petalStyles(petalPaths()) : NO_PETAL_STYLES,
    petalSkills: dir ? petalSkills(petalSkillPaths()) : NO_PETAL_SKILLS,
    magazinePath,
    organizer: organizer.status(),
    backgroundCalls: callsToday(),
    backgroundModels: configStore.BACKGROUND_MODELS,
    hookRuns: responseHook.recentRuns(),
    hookDir: responseHook.hookDir(),
    configFile: path.join(app.getPath('userData'), 'config.json'),
    handoffSample: toMarkdown(HANDOFF_SAMPLE.record, HANDOFF_SAMPLE.turns),
  };
}

// Look setters reuse the menu's apply* paths, so checkmarks and every window stay in sync.
export function registerCustomizeIpc(): void {
  const valid = (choices: readonly Choice[], id: string) => choices.some(([choice]) => choice === id);
  handle('config:get', () => customizeState());
  handle('config:save', (_event, patch) => configStore.save(patch));
  handle('config:reset', (_event, keyPath) => configStore.reset(keyPath));
  handle('config:test-hook', () => responseHook.test());
  handle('config:hook-runs', () => responseHook.recentRuns());
  handle('config:organizer', () => organizer.status());
  handle('config:open-style', (_event, file) => openStyle(file));
  handle('config:use-style', (_event, name) => useStyle(name));
  handle('config:add-petal-styles', () => addPetalStyles());
  handle('config:add-petal-skills', () => addPetalSkills());
  on('look:theme', (_event, id) => { if (themes[id]) applyTheme(id); });
  on('look:reading', (_event, id) => { if (isReadingChoice(id)) applyReading(id); });
  on('look:cat', (_event, id) => { if (valid(CAT_CHOICES, id)) applyCat(id); });
  on('look:scene', (_event, id) => { if (valid(SCENE_CHOICES, id)) applyScene(id); });
}
