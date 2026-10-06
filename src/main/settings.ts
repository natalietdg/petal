import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export interface Settings {
  theme: string;
  cat: string;
  scene: string;
  reading: string;
}

const DEFAULTS: Settings = { theme: 'paleSky', cat: 'mika', scene: 'none', reading: 'newspaper' };

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
// The app was renamed from "Pastel Term"; its userData folder moved with the name.
const legacySettingsFile = () => path.join(app.getPath('appData'), 'Pastel Term', 'settings.json');

// One-time copy of the saved theme into the new folder.
function migrateLegacySettings(): void {
  if (fs.existsSync(settingsFile()) || !fs.existsSync(legacySettingsFile())) return;
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.copyFileSync(legacySettingsFile(), settingsFile());
}

export function loadSettings(): Settings {
  try {
    migrateLegacySettings();
  } catch {
    // Unreadable old folder: start from defaults.
  }
  try {
    return { ...DEFAULTS, ...(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}
