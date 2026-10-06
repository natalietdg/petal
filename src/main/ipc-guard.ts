// Every invoke handler runs through guard(): a failure is logged with its channel, then returned
// as { error } where the contract says so, or rethrown so the renderer's promise rejects as before.
import type { IpcMainInvokeEvent } from 'electron';
import type { InvokeArgs, InvokeChannel, InvokeResult } from '../shared/ipc';
import type { IpcError } from '../shared/types';

// Typed from the contract: a channel's flag must be true exactly when its result includes IpcError.
const RETURNS_ERROR: { [C in InvokeChannel]: IpcError extends InvokeResult<C> ? true : false } = {
  'theme:get': false,
  'cat:get': false,
  'scene:get': false,
  'reading:get': false,
  'claude:installed': false,
  'sessions:snapshot': false,
  'config:get': false,
  'config:save': false,
  'config:reset': false,
  'config:test-hook': false,
  'config:hook-runs': false,
  'config:organizer': false,
  'workflow:today': true,
  'workflow:setup': true,
  'workflow:time': true,
  'workflow:handoffs': true,
  'history:list': false,
  'history:preview': true,
  'history:conversation': true,
  'history:resume': false,
  'history:send': true,
  'history:tidy': true,
  'history:tag-add': true,
  'history:tag-remove': true,
  'history:tag-delete': true,
  'history:tag-rename': true,
  'flow:get': true,
  'flow:create': true,
  'flow:mermaid': false,
  'flow:copy-mermaid': false,
  'flow:save-mermaid': false,
};

export type InvokeHandler<C extends InvokeChannel> =
  (event: IpcMainInvokeEvent, ...args: InvokeArgs<C>) => InvokeResult<C> | Promise<InvokeResult<C>>;

export function guard<C extends InvokeChannel>(channel: C, handler: InvokeHandler<C>): InvokeHandler<C> {
  return async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (error) {
      console.error(`[petal] ${channel} failed:`, error);
      if (!RETURNS_ERROR[channel]) throw error;
      const failure: IpcError = { error: (error as Error).message || String(error) };
      return failure as InvokeResult<C>; // RETURNS_ERROR is true only where IpcError is part of the result
    }
  };
}
