// IPC for the Customize page: everything it shows in one read, config edits, the hook test, the output style switch, and Look setters.
import fs from 'node:fs';
import path from 'node:path';
import { app, shell } from 'electron';
import { CAT_CHOICES, SCENE_CHOICES, READING_CHOICES, isReadingChoice } from './menu';
import * as organizer from './session-organizer';
import * as configStore from './config-store';
import * as responseHook from './response-hook';
import { toMarkdown } from './handoff';
import { applyCat, applyReading, applyScene, applyTheme, settings, themes } from './look';
import { handle, on } from './ipc';
import { activeStyleName, defaultClaudeDir, listOutputStyles, setOutputStyle } from './output-styles';
import { installPetalStyles, petalStyles, type PetalPaths, type PetalStyles } from './petal-styles';
import { isSnapshotRun, stylesFixture } from './snapshot-mode';
import type { StyleSwitch } from './output-styles';
import type { CustomizeState } from '../shared/ipc';
import type { Choice } from '../shared/types';

// Snapshot runs read and write a stand-in ~/.claude when the harness sets one.
const claudeDir = (): string => (isSnapshotRun() && stylesFixture.claudeDir) || defaultClaudeDir();

// Opens a listed style in her default editor; any other path is refused.
async function openStyle(file: string): Promise<{ ok: true }> {
  if (!listOutputStyles(claudeDir()).styles.some((s) => s.file === file)) throw new Error('not one of your output styles');
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
  return setOutputStyle(name, claudeDir());
}

// Packaged: Contents/Resources/output-styles (electron-builder extraResources); dev: the repo's resources folder.
export const bundleDir = (): string => (app.isPackaged ? path.join(process.resourcesPath, 'output-styles') : path.join(app.getAppPath(), 'resources', 'output-styles'));
const petalPaths = (): PetalPaths => ({ claudeDir: claudeDir(), bundleDir: bundleDir(), recordFile: path.join(app.getPath('userData'), 'petal-styles.json') });

function addPetalStyles(): PetalStyles {
  refuseRealWriteInSnapshot();
  return installPetalStyles(petalPaths());
}

const HANDOFF_SAMPLE = {
  record: { title: 'Fix the reader session', cwd: '~/Code/petal', sessionId: '<session id>', file: '~/.claude/projects/<folder>/<session id>.jsonl' },
  turns: [{ prompt: 'why did the reader switch sessions?', reply: ['**The reader now follows only the claude inside this window.**'] }],
};

// Everything the Customize page shows, in one read.
function customizeState(): CustomizeState {
  const magazinePath = path.join(claudeDir(), 'output-styles', 'magazine.md');
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
    outputStyle: activeStyleName(claudeDir()),
    outputStyles: listOutputStyles(claudeDir()),
    petalStyles: petalStyles(petalPaths()),
    magazinePath: fs.existsSync(magazinePath) ? magazinePath : null,
    organizer: organizer.status(),
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
  on('look:theme', (_event, id) => { if (themes[id]) applyTheme(id); });
  on('look:reading', (_event, id) => { if (isReadingChoice(id)) applyReading(id); });
  on('look:cat', (_event, id) => { if (valid(CAT_CHOICES, id)) applyCat(id); });
  on('look:scene', (_event, id) => { if (valid(SCENE_CHOICES, id)) applyScene(id); });
}
