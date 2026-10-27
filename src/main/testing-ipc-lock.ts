// Testing IPC for the test lock, per project: its manifest in ~/.petal, and the one hook entry in ~/.claude/settings.json.
import { handle } from './ipc';
import { dismissRestored, resolveUnconfirmed, setLock } from './test-lock';
import type { TestingIpcContext } from './testing-ipc-context';

export function registerLockIpc({ rootTarget, projectTarget, lockClaudeDir }: TestingIpcContext): void {
  handle('testing:lock', async (event, { tabId, root: picked, on }) => {
    const target = await rootTarget(event.sender.id, tabId, picked);
    if ('note' in target) return target;
    const problem = setLock(target.root, on === true, lockClaudeDir());
    return problem ? { note: problem } : { ok: true };
  });

  handle('testing:lock-dismiss', async (event, { tabId, root: picked }) => {
    const target = await projectTarget(event.sender.id, tabId, picked);
    if ('note' in target) return target;
    dismissRestored(target.root);
    return { ok: true };
  });

  // Her Keep or Restore for a locked test changed outside Claude.
  handle('testing:lock-resolve', async (event, { tabId, root: picked, path: rel, keep }) => {
    const target = await projectTarget(event.sender.id, tabId, picked);
    if ('note' in target) return target;
    const problem = resolveUnconfirmed(target.root, String(rel), keep === true);
    return problem ? { note: problem } : { ok: true };
  });
}
