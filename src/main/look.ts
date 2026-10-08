// Her look: theme, cat, scene and reading style. Every change saves, redraws the menu ticks and reaches every window.
import { BrowserWindow } from 'electron';
import themesJson from '../themes.json';
import { CAT_CHOICES, isReadingChoice } from './menu';
import { loadSettings, saveSettings, type Settings } from './settings';
import { handle, send } from './ipc';
import type { EventArgs, EventChannel } from '../shared/ipc';
import type { Theme, Themes } from '../shared/types';

export const themes: Themes = themesJson;
const DEFAULT_THEME = 'paleSky';

// Retired scene ids and the scene that replaced them.
const RENAMED_SCENES: Readonly<Record<string, string>> = { bakery: 'izakaya' };

// Read on first use, after main.ts has pointed userData at the snapshot scratch folder when it needs to.
let current: Settings | null = null;
export function settings(): Settings {
  if (!current) {
    current = loadSettings();
    // A retired or renamed cat (orange, tabby) in an old settings file becomes Mika, so the menu shows a tick.
    if (!CAT_CHOICES.some(([id]) => id === current?.cat)) current.cat = 'mika';
    if (!themes[current.theme]) current.theme = DEFAULT_THEME;
    if (!isReadingChoice(current.reading)) current.reading = 'newspaper';
    current.scene = RENAMED_SCENES[current.scene] ?? current.scene;
  }
  return current;
}

export const currentTheme = (): Theme => themes[settings().theme];

// main.ts rebuilds the menu after every change, so its checkmarks follow.
let onChange: () => void = () => {};
export const onLookChanged = (listener: () => void): void => { onChange = listener; };

const broadcast = <C extends EventChannel>(channel: C, ...payload: EventArgs<C>) => {
  for (const win of BrowserWindow.getAllWindows()) send(win.webContents, channel, ...payload);
};

export function applyTheme(themeId: string, { persist = true }: { persist?: boolean } = {}): void {
  settings().theme = themeId;
  if (persist) saveSettings(settings());
  onChange();
  for (const win of BrowserWindow.getAllWindows()) {
    win.setBackgroundColor(themes[themeId].reader.background);
    send(win.webContents, 'theme:changed', themes[themeId]);
  }
}

export function applyCat(catId: string): void {
  settings().cat = catId;
  saveSettings(settings());
  onChange();
  broadcast('cat:changed', catId);
}

export function applyReading(readingId: string): void {
  settings().reading = readingId;
  saveSettings(settings());
  onChange();
  broadcast('reading:changed', readingId);
}

export function applyScene(sceneId: string): void {
  settings().scene = sceneId;
  saveSettings(settings());
  onChange();
  broadcast('scene:changed', sceneId);
}

export function registerLookIpc(): void {
  handle('theme:get', () => currentTheme());
  handle('cat:get', () => settings().cat);
  handle('scene:get', () => settings().scene);
  handle('reading:get', () => settings().reading);
}
