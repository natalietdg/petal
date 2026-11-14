// The native folder dialog behind Add Session's "Other folder…" row, for a folder the repo scan does not list.
import { dialog, type BrowserWindow, type OpenDialogOptions } from 'electron';
import os from 'node:os';

const options: OpenDialogOptions = {
  title: 'Where should this session work?',
  message: 'Claude Code keeps memory, AUDIT.md and history per folder.',
  defaultPath: os.homedir(),
  buttonLabel: 'Start here',
  properties: ['openDirectory', 'createDirectory'],
};

// null when she cancels; the caller then opens nothing.
export async function pickFolder(win: BrowserWindow | null): Promise<string | null> {
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}
