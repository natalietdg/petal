const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULTS = { theme: 'paleSky', cat: 'mika', scene: 'none', reading: 'newspaper' };

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
// The app was renamed from "Pastel Term"; its userData folder moved with the name.
const legacySettingsFile = () => path.join(app.getPath('appData'), 'Pastel Term', 'settings.json');

// One-time copy of the saved theme into the new folder.
function migrateLegacySettings() {
  if (fs.existsSync(settingsFile()) || !fs.existsSync(legacySettingsFile())) return;
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.copyFileSync(legacySettingsFile(), settingsFile());
}

function loadSettings() {
  try {
    migrateLegacySettings();
  } catch {
    // Unreadable old folder: start from defaults.
  }
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(settings) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}

module.exports = { loadSettings, saveSettings };
