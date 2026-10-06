// Typed wrappers over ipcMain and webContents.send, checked against the contract in shared/ipc.ts.
import { ipcMain, type IpcMainEvent, type WebContents } from 'electron';
import { guard, type InvokeHandler } from './ipc-guard';
import type { EventArgs, EventChannel, InvokeArgs, InvokeChannel, SendChannel, SendChannels } from '../shared/ipc';

// Every invoke handler is wrapped by guard(); see ipc-guard.ts for what a failure returns.
export function handle<C extends InvokeChannel>(channel: C, handler: InvokeHandler<C>): void {
  const guarded = guard(channel, handler);
  // ipcMain hands over untyped args; the contract is what both sides agreed to send.
  ipcMain.handle(channel, (event, ...args) => guarded(event, ...(args as InvokeArgs<C>)));
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
