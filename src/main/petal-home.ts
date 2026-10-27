// Petal's own folder, ~/.petal: per-repo stores in repos/<repoKey>/ and the test-lock hook script. Snapshot runs use the
// harness's fake home, so neither they nor tests touch hers. Nothing Petal stores per repo is written inside the repo.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { fakeHomeDir, isSnapshotRun } from './snapshot-mode';
import { adoptRepoPetal, repoDirIn, reposRootIn } from './petal-repos';

export const petalHome = (): string => (isSnapshotRun() ? fakeHomeDir() : app.getPath('home'));
export const petalDir = (): string => path.join(petalHome(), '.petal');
export const reposRoot = (): string => reposRootIn(petalHome());

const adopted = new Set<string>(); // "<home>\0<checkout>" whose old .petal/ was copied, or tried and failed, this run

// The repo's folder in Petal. The first call that finds an old in-repo .petal/ copies it across, once.
export function repoDir(checkout: string): string {
  const home = petalHome();
  const key = `${home}\0${checkout}`;
  if (!adopted.has(key)) {
    try {
      const result = adoptRepoPetal(checkout, home);
      if (result.already || result.copied.length || result.kept.length || result.skipped.length) adopted.add(key);
      if (result.skipped.length) console.warn(`[petal] some of ${result.from} wasn’t copied to Petal:`, result.skipped);
    } catch (error) {
      adopted.add(key);
      console.warn(`[petal] couldn’t copy ${checkout}/.petal to Petal:`, (error as Error).message);
    }
  }
  return repoDirIn(home, checkout);
}

// The repo's folder, made when missing; writes into it pass it as their `within`.
export function prepareRepoDir(checkout: string): string {
  const dir = repoDir(checkout);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
