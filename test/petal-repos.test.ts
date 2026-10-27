// Petal's per-repo folder and the one-time copy of a checkout's old .petal/: byte-equal, never overwriting, never
// touching the repo, once. Also the one-off script that runs the same copy for a list of checkouts without the app.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir } from './helpers';
import { ADOPTED_MARKER, adoptRepoPetal, repoDirIn, repoKey, verifyAdopted } from '../src/main/petal-repos';

afterEach(removeTempDirs);

const put = (file: string, text: string | Buffer) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const snapshot = (dir: string): Record<string, string> => Object.fromEntries(
  (fs.readdirSync(dir, { recursive: true }) as string[]).sort().map((rel) => {
    const file = path.join(dir, rel);
    const stat = fs.lstatSync(file);
    return [rel, stat.isSymbolicLink() ? `link:${fs.readlinkSync(file)}` : stat.isDirectory() ? 'dir' : fs.readFileSync(file).toString('base64')];
  }),
);

// A checkout with every kind of file an older build left in .petal/.
function oldCheckout(): string {
  const repo = tempDir('petal-old-repo-');
  const petal = path.join(repo, '.petal');
  put(path.join(petal, '.gitignore'), '*\n');
  put(path.join(petal, 'suite.json'), '{"stages":[]}');
  put(path.join(petal, 'criteria.md'), '## Scenarios\n');
  put(path.join(petal, 'tasks.json'), '{"version":2,"prds":[],"tasks":[]}');
  put(path.join(petal, 'factory.json'), '{}');
  put(path.join(petal, 'factory.md'), '# f\n');
  put(path.join(petal, 'lock.json'), '{"enabled":true}');
  put(path.join(petal, 'lock-refusals.jsonl'), '{"at":1}\n');
  put(path.join(petal, 'distillation.jsonl'), Buffer.from([0, 1, 2, 255]));
  put(path.join(petal, 'suites', 't-a.json'), '[]');
  put(path.join(petal, 'criteria', 't-a.md'), '- [todo] x\n');
  put(path.join(petal, 'criteria', '.gitignore'), '*\n');
  put(path.join(petal, 'test-lock.mjs'), '// old hook\n');
  put(path.join(petal, 'locked', 'src', 'a.test.ts'), 'it()\n');
  fs.symlinkSync('/etc/hosts', path.join(petal, 'link.json'));
  return repo;
}

describe('the repo key', () => {
  it('replaces every non-alphanumeric with "-", like ~/.claude/projects', () => {
    expect(repoKey('/home/me/shop-app')).toBe('-home-me-shop-app');
    expect(repoKey('/a/b_c.d e')).toBe('-a-b-c-d-e');
    expect(repoDirIn('/h', '/a/b')).toBe('/h/.petal/repos/-a-b');
  });
});

describe('adopting a checkout’s old .petal/', () => {
  it('copies plain files byte for byte, skips the hook script, locked copies, .gitignore and links, and leaves the repo exactly as it was', () => {
    const repo = oldCheckout();
    const home = tempDir('petal-home-');
    const before = snapshot(repo);
    const result = adoptRepoPetal(repo, home);
    expect(result.copied.map((c) => c.rel)).toEqual(['criteria/t-a.md', 'criteria.md', 'distillation.jsonl', 'factory.json', 'factory.md', 'lock-refusals.jsonl', 'lock.json', 'suite.json', 'suites/t-a.json', 'tasks.json']);
    expect(result.skipped).toEqual([{ rel: 'link.json', why: 'not a plain file' }]);
    expect(verifyAdopted(result)).toEqual([]);
    const dir = repoDirIn(home, repo);
    expect(fs.readFileSync(path.join(dir, 'distillation.jsonl'))).toEqual(Buffer.from([0, 1, 2, 255]));
    for (const gone of ['.gitignore', 'test-lock.mjs', 'locked', 'link.json', 'criteria/.gitignore']) expect(fs.existsSync(path.join(dir, gone)), gone).toBe(false);
    expect(snapshot(repo)).toEqual(before);
  });

  it('runs once: a marker stops later runs, and a file Petal already has is never written over', () => {
    const repo = oldCheckout();
    const home = tempDir('petal-home-');
    const dir = repoDirIn(home, repo);
    put(path.join(dir, 'tasks.json'), 'Petal’s newer copy');
    const first = adoptRepoPetal(repo, home);
    expect(first.kept).toEqual([{ rel: 'tasks.json', same: false }]);
    expect(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')).toBe('Petal’s newer copy');
    expect(fs.existsSync(path.join(dir, ADOPTED_MARKER))).toBe(true);
    put(path.join(repo, '.petal', 'suite.json'), 'changed later');
    expect(adoptRepoPetal(repo, home)).toMatchObject({ already: true, copied: [] });
    expect(fs.readFileSync(path.join(dir, 'suite.json'), 'utf8')).toBe('{"stages":[]}');
  });

  it('a checkout with no .petal/ copies nothing and makes no folder', () => {
    const home = tempDir('petal-home-');
    const repo = tempDir('petal-new-repo-');
    expect(adoptRepoPetal(repo, home)).toMatchObject({ already: false, copied: [], kept: [], skipped: [] });
    expect(fs.existsSync(path.join(home, '.petal'))).toBe(false);
  });
});

describe('the one-off import script', () => {
  const script = path.resolve(__dirname, '../scripts/import-repo-petal.ts');
  const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

  it('copies each checkout into --home, prints and verifies every copy, and leaves the repos untouched', () => {
    const one = oldCheckout();
    const two = oldCheckout();
    const none = tempDir('petal-new-repo-');
    const home = tempDir('petal-home-');
    const before = [snapshot(one), snapshot(two)];
    const out = run('--home', home, one, two, none);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain(`copied   suite.json (13 bytes)`);
    expect(out.stdout.match(/verified: 10 copies byte-equal/g)).toHaveLength(2);
    expect(out.stdout).toContain('no .petal folder');
    expect([snapshot(one), snapshot(two)]).toEqual(before);
    expect(fs.readFileSync(path.join(repoDirIn(home, two), 'lock.json'), 'utf8')).toBe('{"enabled":true}');
    expect(run('--home', home, one).stdout).toContain('already imported earlier');
  });

  it('fails when a checkout is missing or Petal already holds a different copy', () => {
    const home = tempDir('petal-home-');
    expect(run('--home', home, path.join(home, 'nope')).status).toBe(1);
    const repo = oldCheckout();
    put(path.join(repoDirIn(home, repo), 'tasks.json'), 'different');
    const out = run('--home', home, repo);
    expect(out.status).toBe(1);
    expect(out.stdout).toContain('kept     tasks.json (Petal already had it; DIFFERENT from the repo copy)');
  });
});
