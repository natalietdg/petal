// Where Petal keeps what it stores per repo: <home>/.petal/repos/<repoKey>/, never inside a repo or worktree.
// Also the one-time adoption of a checkout's old in-repo .petal/ folder: copied, checked byte for byte, never changed.
// Node built-ins only, no relative imports, so scripts/import-repo-petal.ts runs it under plain node.
import fs from 'node:fs';
import path from 'node:path';

export const REPOS_SHOWN = '~/.petal/repos';
export const ADOPTED_MARKER = '.adopted.json'; // in the repo's Petal folder once its old .petal/ was copied
const IN_REPO_DIR = '.petal';
const ADOPT_FILE_CAP = 8 * 1024 * 1024;
// Not copied: the folder's own .gitignore, the old per-repo hook script (one script lives in ~/.petal now) and the old
// locked copies (test-lock.ts moves those to userData).
const NOT_ADOPTED = new Set(['.gitignore', 'test-lock.mjs', 'locked']);

// A checkout's absolute path with every non-alphanumeric as "-", as ~/.claude/projects names its folders.
export const repoKey = (checkout: string): string => path.resolve(checkout).replace(/[^A-Za-z0-9]/g, '-');

export const reposRootIn = (home: string): string => path.join(home, '.petal', 'repos');
export const repoDirIn = (home: string, checkout: string): string => path.join(reposRootIn(home), repoKey(checkout));
export const repoDirShown = (checkout: string): string => `${REPOS_SHOWN}/${repoKey(checkout)}`;

export interface AdoptResult {
  from: string;
  to: string;
  already: boolean; // adopted before: nothing read this time
  copied: { rel: string; bytes: number }[];
  kept: { rel: string; same: boolean }[]; // Petal's copy was already there and wins; same: byte-equal to the repo's
  skipped: { rel: string; why: string }[];
}

const sameBytes = (a: string, b: string): boolean => { try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch { return false; } };

// Every plain file under dir, repo-relative with "/", links and NOT_ADOPTED names left out.
function plainFiles(dir: string, prefix: string, skipped: AdoptResult['skipped']): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const rel = `${prefix}${entry.name}`;
    if (NOT_ADOPTED.has(entry.name) && (prefix === '' || entry.name === '.gitignore')) return [];
    if (entry.isDirectory()) return plainFiles(path.join(dir, entry.name), `${rel}/`, skipped);
    if (!entry.isFile()) { skipped.push({ rel, why: 'not a plain file' }); return []; }
    return [rel];
  });
}

// Copies <checkout>/.petal/ into <home>/.petal/repos/<repoKey>/ once. A file Petal already has is never written over;
// the repo's folder is only read. The marker records the run, so a later in-repo change is not taken again.
export function adoptRepoPetal(checkout: string, home: string): AdoptResult {
  const from = path.join(checkout, IN_REPO_DIR);
  const to = repoDirIn(home, checkout);
  const result: AdoptResult = { from, to, already: false, copied: [], kept: [], skipped: [] };
  try {
    if (!fs.lstatSync(from).isDirectory()) return result;
  } catch {
    return result; // no old folder
  }
  if (fs.existsSync(path.join(to, ADOPTED_MARKER))) return { ...result, already: true };
  for (const rel of plainFiles(from, '', result.skipped)) {
    const source = path.join(from, ...rel.split('/'));
    const target = path.join(to, ...rel.split('/'));
    const size = fs.statSync(source).size;
    if (size > ADOPT_FILE_CAP) { result.skipped.push({ rel, why: `over ${ADOPT_FILE_CAP / 1024 / 1024} MB` }); continue; }
    if (fs.existsSync(target)) { result.kept.push({ rel, same: sameBytes(source, target) }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    if (!sameBytes(source, target)) { fs.rmSync(target, { force: true }); result.skipped.push({ rel, why: 'the copy didn’t match' }); continue; }
    result.copied.push({ rel, bytes: size });
  }
  fs.mkdirSync(to, { recursive: true });
  fs.writeFileSync(path.join(to, ADOPTED_MARKER), `${JSON.stringify({ from, at: new Date().toISOString(), copied: result.copied.map((c) => c.rel) }, null, 2)}\n`);
  return result;
}

// Every copied file still byte-equal to the repo's: the check before anyone deletes the in-repo folder.
export const verifyAdopted = (result: AdoptResult): string[] =>
  result.copied.filter(({ rel }) => !sameBytes(path.join(result.from, ...rel.split('/')), path.join(result.to, ...rel.split('/')))).map((c) => c.rel);
