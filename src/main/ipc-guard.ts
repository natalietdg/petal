// Every invoke handler runs through guard(): a failure is logged with its channel, then returned
// as { error }, so the renderer's promise never rejects and it can say what went wrong.
import type { IpcMainInvokeEvent } from 'electron';
import type { InvokeArgs, InvokeChannel, InvokeResult } from '../shared/ipc';
import type { IpcError } from '../shared/types';

// Channels whose result lacks Guarded<>; AssertNone makes typecheck fail and name them if there are any.
type Unguarded = { [C in InvokeChannel]: IpcError extends InvokeResult<C> ? never : C }[InvokeChannel];
type AssertNone<T extends never> = T;
export type EveryChannelGuarded = AssertNone<Unguarded>;

export type InvokeHandler<C extends InvokeChannel> =
  (event: IpcMainInvokeEvent, ...args: InvokeArgs<C>) => InvokeResult<C> | Promise<InvokeResult<C>>;

export function guard<C extends InvokeChannel>(channel: C, handler: InvokeHandler<C>): InvokeHandler<C> {
  return async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (error) {
      console.error(`[petal] ${channel} failed:`, error);
      const failure: IpcError = { error: (error as Error).message || String(error) };
      return failure as InvokeResult<C>; // every result includes IpcError (checked above)
    }
  };
}
