// Typed wrappers over ipcMain and webContents.send, checked against the contract in shared/ipc.ts.
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { IpcError } from '../shared/types';
import type { EventArgs, EventChannel, InvokeArgs, InvokeChannel, InvokeResult, SendChannel, SendChannels } from '../shared/ipc';

export function handle<C extends InvokeChannel>(
  channel: C,
  handler: (event: IpcMainInvokeEvent, ...args: InvokeArgs<C>) => InvokeResult<C> | Promise<InvokeResult<C>>,
): void {
  // ipcMain hands over untyped args; the contract is what both sides agreed to send.
  ipcMain.handle(channel, (event, ...args) => handler(event, ...(args as InvokeArgs<C>)));
}

// One bad session must never blank a pane: a thrown error comes back as an inline { error } message.
type GuardedChannel = { [C in InvokeChannel]: IpcError extends InvokeResult<C> ? C : never }[InvokeChannel];

export function handleGuarded<C extends GuardedChannel>(
  channel: C,
  handler: (event: IpcMainInvokeEvent, ...args: InvokeArgs<C>) => InvokeResult<C> | Promise<InvokeResult<C>>,
): void {
  handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (error) {
      console.error(`[petal] ${channel} failed:`, error);
      return { error: (error as Error).message || String(error) } as InvokeResult<C>; // GuardedChannel ensures IpcError is part of this result
    }
  });
}

export function on<C extends SendChannel>(channel: C, listener: (event: IpcMainEvent, ...args: SendChannels[C]) => void): void {
  ipcMain.on(channel, (event, ...args) => listener(event, ...(args as SendChannels[C])));
}

export function once<C extends SendChannel>(channel: C, listener: (event: IpcMainEvent, ...args: SendChannels[C]) => void): void {
  ipcMain.once(channel, (event, ...args) => listener(event, ...(args as SendChannels[C])));
}

export function send<C extends EventChannel>(contents: WebContents, channel: C, ...payload: EventArgs<C>): void {
  contents.send(channel, ...payload);
}
