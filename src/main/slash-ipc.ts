// IPC for the reply box's "/" menu. Read-only, behind the Claude folder gate; the project folder too.
import path from 'node:path';
import { handle } from './ipc';
import { allowedClaudeHome, projectClaudeDir } from './claude-folder';
import { isSnapshotRun, slashFixture } from './snapshot-mode';
import { slashCatalog } from './slash-catalog';
import type { SlashList } from '../shared/slash';

const FRESH_MS = 5000; // a menu opened again within this reuses the last read
const cache = new Map<string, { at: number; list: SlashList }>();

export function registerSlashIpc(): void {
  handle('slash:list', (_event, request) => {
    const home = allowedClaudeHome();
    if (!home) return { allowed: false, items: [] };
    const claudeDir = (isSnapshotRun() && slashFixture.claudeDir) || home;
    const cwd = request?.cwd;
    const projectDir = typeof cwd === 'string' && path.isAbsolute(cwd) ? projectClaudeDir(cwd) : null;
    const key = `${claudeDir}\n${projectDir ?? ''}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < FRESH_MS) return hit.list;
    const list: SlashList = { allowed: true, items: slashCatalog({ claudeDir, projectDir }) };
    cache.set(key, { at: Date.now(), list });
    return list;
  });
}
