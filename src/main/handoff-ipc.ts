// IPC for "Send to Claude": another session reads a past one through a clean handoff copy.
import { clipboard, type IpcMainInvokeEvent } from 'electron';
import * as history from './history';
import * as links from './links-store';
import { writeHandoff } from './handoff';
import { handle } from './ipc';
import type { ActiveSession } from './tab-session';

export function registerHandoffIpc({ activeSession }: { activeSession: ActiveSession }): void {
  const own = (event: IpcMainInvokeEvent) => activeSession(event.sender.id); // the tab shown in the asking window

  // Another session reads this one: write a clean copy, then type a "read this" line for her to finish.
  handle('history:send', async (event, { sessionId }) => {
    const session = own(event);
    const record = history.findRecord(sessionId);
    if (!session || !record) return { note: 'That session is no longer on disk.' };
    if (!session.feed.claudePid) return { note: 'Start Claude in this tab first, then send.' };
    if (session.feed.session?.sessionId === sessionId) return { note: 'That is the session running here already.' };
    const { file, turns } = await writeHandoff(record);
    clipboard.writeText(file);
    session.pty.write(`Read "${file}", my earlier session "${record.title || 'Untitled'}" (${turns} turns). `);
    links.addLink({ from: sessionId, to: session.feed.session?.sessionId ?? null, kind: 'send' });
    return { ok: true, file };
  });
}
