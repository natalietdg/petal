// The reply box's image paste: main turns the bytes into a PNG file Claude can read by path.
import os from 'node:os';
import { app, nativeImage } from 'electron';
import { handle } from './ipc';
import { MAX_IMAGE_BYTES, pasteDir, removeStale, savePng } from './paste-files';
import { readPromptImage } from './paste-image';
import { isSnapshotRun, snapshotOutDir } from './snapshot-mode';

// Snapshot runs keep their pastes in the scratch folder.
const folder = (): string => pasteDir(isSnapshotRun() ? snapshotOutDir() : app.getPath('temp'));

export function registerPasteIpc(): void {
  removeStale(folder());

  handle('paste:save-image', (_event, { bytes }) => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('That image is too large to attach.');
    const image = nativeImage.createFromBuffer(Buffer.from(bytes));
    if (image.isEmpty()) throw new Error('That clipboard item is not an image Petal can read.');
    return { file: savePng(folder(), image.toPNG()) };
  });

  // A bubble's picture: see paste-image.ts for what is served and what is refused.
  handle('paste:image', (_event, { file, prompt }) =>
    readPromptImage(file, prompt, { pasteDir: folder(), home: os.homedir(), temp: app.getPath('temp'), maxBytes: MAX_IMAGE_BYTES }));
}
