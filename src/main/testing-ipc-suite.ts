// Testing IPC for the repo's suite and criteria file: editing, seeding, undoing, and her manual results.
import { shell } from 'electron';
import { handle } from './ipc';
import { isSnapshotRun, testingFixture } from './snapshot-mode';
import { undoSuiteChange, writeSuite } from './repo-suite-store';
import { criteriaFile, prepareCriteria, saveManualResult } from './criteria-store';
import { checkSuite, emptySuite } from '../shared/repo-suite';
import { MANUAL_STATUSES, type ManualStatus } from '../shared/test-loop';
import type { TestingIpcContext } from './testing-ipc-context';

export function registerSuiteIpc({ projectTarget, projectSeed }: TestingIpcContext): void {
  // The repo's suite, from the editor: written to its file. Confirmations only ever come from a confirmed run.
  handle('testing:save-suite', async (event, { tabId, root: picked, suite }) => {
    const target = await projectTarget(event.sender.id, tabId, picked);
    if ('note' in target) return target;
    const check = checkSuite(suite);
    if (!check.ok) return { note: 'Each stage needs a name, a one-line command and a level.' };
    writeSuite(target.root, check.suite);
    return { ok: true };
  });

  // Start from the project's commands: re-read here, never the renderer's copy. New commands still ask before their first run.
  handle('testing:seed-suite', async (event, { tabId, root: picked }) => {
    const target = await projectTarget(event.sender.id, tabId, picked);
    if ('note' in target) return target;
    const seed = projectSeed(target.root);
    if (!seed || !('stages' in seed)) return { note: 'The project has no commands to start from.' };
    writeSuite(target.root, emptySuite(seed.stages));
    return { ok: true };
  });

  handle('testing:undo-suite', async (event, { tabId, root: picked }) => {
    const target = await projectTarget(event.sender.id, tabId, picked);
    if ('note' in target) return target;
    return undoSuiteChange(target.root) ? { ok: true } : { note: 'There is no change to undo.' };
  });

  // Edit scenarios: the repo's criteria file, made first if missing, in her default editor.
  handle('testing:open-criteria', async (event, { tabId, root: picked }) => {
    const target = await projectTarget(event.sender.id, tabId, picked);
    if ('note' in target) return target;
    prepareCriteria(target.root);
    const file = criteriaFile(target.root);
    if (isSnapshotRun()) { testingFixture.opened.push(file); return { ok: true as const }; }
    const failure = await shell.openPath(file); // '' means it opened
    return failure ? { note: `Couldn’t open the scenarios file: ${failure}` } : { ok: true as const };
  });

  // Her pass, fail or blocked on a manual case, with her Result note, written back into the criteria file.
  handle('testing:manual-result', async (event, { tabId, root: picked, name, status, result }) => {
    const target = await projectTarget(event.sender.id, tabId, picked);
    if ('note' in target) return target;
    if (typeof name !== 'string' || !name || !(MANUAL_STATUSES as readonly string[]).includes(status) || typeof result !== 'string') return { note: 'That result can’t be saved.' };
    const problem = saveManualResult(target.root, name, status as ManualStatus, result);
    return problem ? { note: problem } : { ok: true };
  });
}
