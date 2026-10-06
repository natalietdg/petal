// IPC for the Customize page: everything it shows in one read, config edits, the hook test, and Look setters.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { CAT_CHOICES, SCENE_CHOICES, READING_CHOICES } from './menu';
import * as organizer from './session-organizer';
import * as configStore from './config-store';
import * as responseHook from './response-hook';
import { toMarkdown } from './handoff';
import { applyCat, applyReading, applyScene, applyTheme, settings, themes } from './look';
import { handle, on } from './ipc';
import type { CustomizeState } from '../shared/ipc';
import type { Choice } from '../shared/types';

// Her active Claude Code output style, read-only; null when unset or unreadable.
function outputStyle(): string | null {
  try {
    return (JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8')) as { outputStyle?: string }).outputStyle ?? null;
  } catch {
    return null;
  }
}

const HANDOFF_SAMPLE = {
  record: { title: 'Fix the reader session', cwd: '~/CascadeProjects/pastel-term', sessionId: '<session id>', file: '~/.claude/projects/<folder>/<session id>.jsonl' },
  turns: [{ prompt: 'why did the reader switch sessions?', reply: ['**The reader now follows only the claude inside this window.**'] }],
};

// Everything the Customize page shows, in one read.
function customizeState(): CustomizeState {
  const magazinePath = path.join(os.homedir(), '.claude', 'output-styles', 'magazine.md');
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
    outputStyle: outputStyle(),
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
  on('look:theme', (_event, id) => { if (themes[id]) applyTheme(id); });
  on('look:reading', (_event, id) => { if (valid(READING_CHOICES, id)) applyReading(id); });
  on('look:cat', (_event, id) => { if (valid(CAT_CHOICES, id)) applyCat(id); });
  on('look:scene', (_event, id) => { if (valid(SCENE_CHOICES, id)) applyScene(id); });
}
