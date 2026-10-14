// The one-time "Updated to X · What's new" note after restarting into a new version, with notes from the bundled CHANGELOG.md.
import fs from 'node:fs';
import path from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import * as configStore from './config-store';
import type { WhatsNew } from '../shared/ipc';

// The bullet lines under "## [version] · date", up to the next release heading; null when the version has no entry.
export function changelogSection(changelog: string, version: string): string | null {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
  return body || null;
}

export interface LaunchRecord {
  current: string;
  lastSeen: string;
  usedBefore: boolean; // a fresh install has nothing to announce
  saveSeen: (version: string) => void;
}

// Records this launch's version; returns the version to announce, once, or null.
export function versionToAnnounce({ current, lastSeen, usedBefore, saveSeen }: LaunchRecord): string | null {
  if (lastSeen === current) return null;
  saveSeen(current);
  // '' with an existing setup: the first version that records this, reached by an update.
  return lastSeen || usedBefore ? current : null;
}

// Packaged: Contents/Resources/CHANGELOG.md (electron-builder extraResources); dev: the repo root.
const changelogPath = (): string => (app.isPackaged ? path.join(process.resourcesPath, 'CHANGELOG.md') : path.join(app.getAppPath(), 'CHANGELOG.md'));

function readNotes(version: string): string | null {
  try {
    return changelogSection(fs.readFileSync(changelogPath(), 'utf8'), version);
  } catch {
    return null;
  }
}

let pending: WhatsNew | null = null;

// Called once at launch, before any window asks.
export function recordLaunch(): void {
  const config = configStore.load();
  const version = versionToAnnounce({
    current: app.getVersion(),
    lastSeen: config.updates.lastSeenVersion,
    usedBefore: config.welcome.seen,
    saveSeen: (seen) => { configStore.save({ updates: { lastSeenVersion: seen } }); },
  });
  pending = version ? { version, hasNotes: readNotes(version) !== null } : null;
}

// The first window to ask shows the note; later windows don't repeat it.
export function takeWhatsNew(): WhatsNew | null {
  const note = pending;
  pending = null;
  return note;
}

export async function showWhatsNew(win: BrowserWindow | null): Promise<void> {
  const version = app.getVersion();
  const notes = readNotes(version);
  if (!notes) return;
  const options = { type: 'info' as const, message: `What's new in Petal ${version}`, detail: notes.replace(/^- /gm, '• '), buttons: ['OK'] };
  await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
}
