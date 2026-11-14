// The first conclude asks before Petal closes the session and its tab; after one yes it never asks again.
import { BrowserWindow, dialog } from 'electron';
import * as configStore from './config-store';
import { firstConcludeWarning } from './conclude-tab';
import { isSnapshotRun } from './snapshot-mode';

// True to go ahead with the close. Snapshot runs never ask, so the harness isn't held by a dialog.
export async function confirmConcludeClose(contentsId: number, tabsInWindow: number): Promise<boolean> {
  if (isSnapshotRun()) return true;
  const warning = firstConcludeWarning({ warned: configStore.load().conclude.warned, tabsInWindow });
  if (!warning) return true;
  const options = { type: 'question' as const, message: warning.message, detail: warning.detail, buttons: warning.buttons, defaultId: 0, cancelId: 1 };
  const win = BrowserWindow.getAllWindows().find((w) => w.webContents.id === contentsId);
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  if (response !== 0) return false; // she keeps it; the next conclude asks again
  configStore.save({ conclude: { warned: true } });
  return true;
}
