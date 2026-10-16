// The JSON inside a headless Claude answer: the CLI's envelope first, then the {...} or [...] in its result, wrapped in prose or a fence or not.
import { squash } from './library-store';

export const MAX_REPLY_CHARS = 64 * 1024;

export function replyJson(stdout: string): unknown {
  if (stdout.length > MAX_REPLY_CHARS) throw new Error('Reply too large');
  let text = stdout;
  try {
    const envelope = JSON.parse(stdout) as { result?: unknown; is_error?: unknown };
    if (envelope?.is_error === true) throw new Error(`Claude error: ${squash(envelope.result, 200)}`);
    if (typeof envelope?.result === 'string') text = envelope.result;
  } catch (error) {
    if ((error as Error).message.startsWith('Claude error')) throw error;
  }
  const open = text.search(/[[{]/);
  const close = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (open === -1 || close < open) throw new Error('No JSON in reply');
  return JSON.parse(text.slice(open, close + 1)) as unknown;
}
