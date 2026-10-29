// Dev-only snapshot step: a file dropped on the reader types its quoted path into that tab's Claude prompt.
import type { BrowserWindow } from 'electron';
import { ptyWrites } from '../main/snapshot-mode';
import type { Kit, TabsDeps } from './snapshot';

// Where a macOS screenshot thumbnail's file lives; a page-built File has no path, so the uri-list carries it.
const DROPPED = '/var/folders/xx/T/TemporaryItems/NSIRD_screencaptureui_petal/Screenshot 2026-10-27 at 9.41.00 AM.png';
const DROPPED_TYPED = `'${DROPPED}' `;

export async function readerDropCheck(kit: Kit, { activeSession, win }: Pick<TabsDeps, 'activeSession'> & { win: BrowserWindow }): Promise<void> {
  const { js, waitFor, wait, log } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} reader drop: ${what}`);
  const tab = activeSession(win.webContents.id);
  if (!tab) throw new Error('reader drop check: no active tab');
  const writesSince = (from: number) => ptyWrites.slice(from).filter((w) => w.tabId === tab.tabId).map((w) => w.data).join('');

  const from = ptyWrites.length;
  const dropped = await js(`(() => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'Screenshot.png', { type: 'image/png' }));
    data.setData('text/uri-list', ${JSON.stringify(`file://${encodeURI(DROPPED)}`)});
    const reader = document.getElementById('reader');
    const over = new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true });
    reader.dispatchEvent(over);
    const drop = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
    reader.dispatchEvent(drop);
    return { types: [...data.types], files: data.files.length, pathForFile: window.pastel.pathForFile(data.files[0]), accepted: over.defaultPrevented, handled: drop.defaultPrevented,
      focus: Boolean(document.activeElement?.closest('.term-host, #composer')) };
  })()`);
  log(`reader drop: page saw ${JSON.stringify(dropped)}`);
  const typed = await waitFor(() => (writesSince(from).includes(DROPPED_TYPED) ? writesSince(from) : null), 3000);
  check(dropped.accepted && dropped.handled, `the reader accepts the drag and takes the drop: ${JSON.stringify(dropped)}`);
  check(typed, `the quoted path reaches the tab's pty ${JSON.stringify(DROPPED_TYPED)}: ${JSON.stringify(writesSince(from))}`);
  check(dropped.focus, 'focus moves to the prompt after the drop');
  tab.pty.write('\x15'); // clears the typed path from the fixture shell's line
  await wait(300);
}
