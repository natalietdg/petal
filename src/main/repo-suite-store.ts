// The repo's one suite on disk: ~/.petal/repos/<repoKey of the main checkout>/suite.json, in Petal and never in the repo,
// so every worktree shares it. Read with a size cap and no symlinks, written atomically. Any session's change is taken on
// the next read, with Undo; what Petal took is kept in the main checkout's testing store. A checkout's old .petal/ is
// copied across once (petal-home.ts); older per-task and worktree suites among those copies are merged in once.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { writeFileDurable } from './atomic-file';
import { prepareRepoDir, repoDir } from './petal-home';
import { repoDirShown } from './petal-repos';
import * as store from './testing-store';
import {
  LEGACY_SUITES_DIR, SUITE_FILE_BYTES, SUITE_NAME, isTaskId, mergeSuites, parseSuiteText, suiteText, takeSuiteFile, writtenRecord,
  type RepoSuite, type RepoSuiteView, type SuiteFileNow,
} from '../shared/repo-suite';

const homes = new Map<string, string>(); // checkout root -> its main checkout

// The main checkout holding the shared .git: the parent of git's common dir when that is a ".git" folder, else root itself.
export const homeFromCommonDir = (commonDir: string, root: string): string =>
  (path.basename(commonDir) === '.git' ? path.dirname(commonDir) : root);

// The repo's main checkout, for a checkout or any of its worktrees; root itself outside git.
export function suiteHome(root: string): string {
  const known = homes.get(root);
  if (known) return known;
  let home = root;
  try {
    const out = execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out) home = homeFromCommonDir(out, root);
  } catch { /* not a repo, or no git: the checkout stands alone */ }
  homes.set(root, home);
  return home;
}

// The repo's folder in Petal, keyed by its main checkout.
export const suiteDir = (home: string): string => repoDir(home);
export const suiteFile = (home: string): string => path.join(suiteDir(home), SUITE_NAME);
export const prepareSuiteDir = (home: string): string => prepareRepoDir(home);

// A plain file's text and change time; text null when there is none. Too big, or not a plain file, reads as text that won't parse.
export function readCappedFile(file: string, cap = SUITE_FILE_BYTES): SuiteFileNow {
  let stat: fs.Stats;
  try {
    if (!fs.lstatSync(path.dirname(file)).isDirectory()) return { text: null, at: 0 };
    stat = fs.lstatSync(file);
  } catch {
    return { text: null, at: 0 };
  }
  if (!stat.isFile() || stat.size > cap) return { text: `<${stat.isFile() ? `over ${Math.round(cap / 1024)} KB` : 'not a plain file'}>`, at: stat.mtimeMs };
  try {
    return { text: fs.readFileSync(file, 'utf8'), at: stat.mtimeMs };
  } catch {
    return { text: null, at: 0 };
  }
}

// An older file among the copies Petal took of a checkout's .petal/, with the in-repo path it was copied from.
export interface LegacyFile { file: string; original: string; taskId: string | null }

// Each older suite: per-task files from the main checkout and this checkout, and a worktree's own suite.json.
export function legacySuiteFiles(root: string): LegacyFile[] {
  const home = suiteHome(root);
  const perTask = [...new Set([home, root])].flatMap((checkout) => {
    const dir = path.join(repoDir(checkout), ...LEGACY_SUITES_DIR.split('/').slice(1));
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { return []; }
    return names.filter((n) => n.endsWith('.json') && isTaskId(n.slice(0, -5))).sort()
      .map((n) => ({ file: path.join(dir, n), original: path.join(checkout, ...LEGACY_SUITES_DIR.split('/'), n), taskId: n.slice(0, -5) }));
  });
  const ownFile = path.join(repoDir(root), SUITE_NAME);
  const own = root !== home && fs.existsSync(ownFile) ? [{ file: ownFile, original: path.join(root, '.petal', SUITE_NAME), taskId: null }] : [];
  return [...own, ...perTask];
}

// Imported before: by this path, or by its in-repo original under an older build.
export const wasImported = (done: ReadonlySet<string>, f: LegacyFile): boolean => done.has(f.file) || done.has(f.original);

// Older suites not imported yet join the repo's suite, stages merged by name. The old files are only read, never changed;
// each is remembered so it imports once. A file that doesn't parse is skipped, and remembered too.
export function importLegacySuites(root: string): void {
  const home = suiteHome(root);
  const data = store.load(home);
  const done = new Set(data.imported ?? []);
  const fresh = legacySuiteFiles(root).filter((f) => !wasImported(done, f));
  if (!fresh.length) return;
  const current = readCappedFile(suiteFile(home));
  const parsed = current.text === null ? null : parseSuiteText(current.text);
  if (parsed && 'problem' in parsed) return; // never write over a file she is mid-edit on
  let suite: RepoSuite | null = parsed?.suite ?? null;
  for (const { file } of fresh) {
    const old = readCappedFile(file);
    const took = old.text === null ? null : parseSuiteText(old.text);
    if (took && 'suite' in took) suite = mergeSuites(suite, took.suite);
    done.add(file);
  }
  if (suite && (!parsed || suiteText(suite) !== current.text)) {
    writeFileDurable(suiteFile(home), suiteText(suite), undefined, { within: prepareSuiteDir(home) });
  }
  store.save({ ...store.load(home), imported: [...done] });
}

// The repo's suite now: older files imported first, then whatever the file holds taken with Undo. Writes the store only
// when something changed.
export function syncSuite(root: string): RepoSuiteView {
  const home = suiteHome(root);
  try { importLegacySuites(root); } catch (error) { console.warn('[petal] older task suites not imported:', (error as Error).message); }
  const data = store.load(home);
  const before = data.repoSuite ?? null;
  const file = readCappedFile(suiteFile(home));
  const after = takeSuiteFile(before, file);
  if (after && JSON.stringify(after) !== JSON.stringify(before)) store.save({ ...data, repoSuite: after });
  return {
    suite: after?.good ?? null, change: after?.change ?? null, problem: after?.problem ?? null,
    home, dir: suiteDir(home), shownDir: repoDirShown(home), ...(file.at ? { at: file.at } : {}),
  };
}

// Her edit, a seed or an Undo: the file is written (or removed for no suite) and remembered as taken.
export function writeSuite(root: string, suite: RepoSuite | null): void {
  const home = suiteHome(root);
  const file = suiteFile(home);
  if (suite) {
    writeFileDurable(file, suiteText(suite), undefined, { within: prepareSuiteDir(home) });
  } else {
    fs.rmSync(file, { force: true });
  }
  store.save({ ...store.load(home), repoSuite: writtenRecord(suite) });
}

// Puts back the suite from before the last change; false when there is nothing to undo.
export function undoSuiteChange(root: string): boolean {
  const change = store.load(suiteHome(root)).repoSuite?.change;
  if (!change) return false;
  writeSuite(root, change.previous);
  return true;
}
