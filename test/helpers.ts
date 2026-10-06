// Temp dirs and transcript fixtures shared by the suites. Nothing here touches ~/.claude or ~/Library.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TranscriptEntry } from '../src/main/transcript-entry';

const made: string[] = [];

export function tempDir(prefix = 'petal-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

// Points the electron mock's app.getPath at a fresh temp dir and returns it.
export function useTempUserData(): string {
  const dir = tempDir('petal-userdata-');
  globalThis.__electronStub.userData = dir;
  globalThis.__electronStub.notices = [];
  globalThis.__electronStub.notificationsSupported = true;
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export const tmpLeftovers = (dir: string): string[] => fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));

export const userEntry = (text: string, extra: Partial<TranscriptEntry> = {}): TranscriptEntry => ({
  type: 'user',
  uuid: `u-${text.slice(0, 8)}`,
  message: { role: 'user', content: text },
  ...extra,
});

export const assistantEntry = (text: string, uuid = `a-${text.slice(0, 8)}`, extra: Partial<TranscriptEntry> = {}): TranscriptEntry => ({
  type: 'assistant',
  uuid,
  timestamp: '2026-10-06T00:00:00.000Z',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
  ...extra,
});

export const toolResultEntry = (): TranscriptEntry => ({
  type: 'user',
  uuid: 'tool-result',
  message: { role: 'user', content: [{ type: 'tool_result', text: 'output' }] },
});

export const toolUseEntry = (): TranscriptEntry => ({
  type: 'assistant',
  uuid: 'tool-use',
  message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] },
});

export function writeJsonl(file: string, entries: (TranscriptEntry | string)[]): string {
  fs.writeFileSync(file, entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n') + '\n');
  return file;
}
