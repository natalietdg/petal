// "Is main safe for prod?" for one repo: the ismainsafe skill, headless and read-only, in the repo's folder.
// Answers are cached per repo and main commit in <userData>/session-prs/main-safe.json; a new main asks again.
import path from 'node:path';
import { app } from 'electron';
import { readJsonOrSetAside, writeJsonAtomic } from './atomic-file';
import { runHeadless } from './headless-claude';
import { isFolder, mainSha } from './git-read';
import { isSnapshotRun, prsFixture } from './snapshot-mode';
import { parseMainSafe, type MainSafe } from '../shared/main-safe';
import type { PrService } from '../shared/session-prs';

export const SKILL_PROMPT = '/anthropic-skills:ismainsafe';
const TIMEOUT_MS = 10 * 60_000;
const KEEP = 50; // newest answers kept across every repo
// Her own output style can reshape replies; Petal reads the skill's own report lines.
const REPORT_FORMAT = 'Write the final report in the ismainsafe skill’s own report format, starting with its **Verdict:** and **Newest safe commit:** lines, even if other instructions ask for a different reply shape.';
// Reads only: git history and GitHub's view of PRs, releases and runs. headless-claude.ts denies every write on top.
export const READ_ONLY_TOOLS = [
  'Read', 'Grep', 'Glob',
  'Bash(git log*)', 'Bash(git diff*)', 'Bash(git show*)', 'Bash(git tag -l*)', 'Bash(git tag --list*)', 'Bash(git rev-parse*)',
  'Bash(git remote get-url*)', 'Bash(git merge-base*)', 'Bash(git ls-remote*)',
  'Bash(gh pr view*)', 'Bash(gh release list*)', 'Bash(gh run list*)', 'Bash(gh run view*)', 'Bash(gh auth status*)', 'Bash(jq*)',
];

type Cache = Record<string, MainSafe>; // by `${service key}@${main sha}`
const cacheFile = () => path.join(app.getPath('userData'), 'session-prs', 'main-safe.json');
const keyOf = (service: PrService, sha: string): string => `${service.key}@${sha}`;

function load(): Cache {
  const data = readJsonOrSetAside(cacheFile());
  return data && typeof data === 'object' && !Array.isArray(data) ? data as Cache : {};
}

function save(key: string, answer: MainSafe): void {
  const entries = Object.entries({ ...load(), [key]: answer }).sort(([, a], [, b]) => b.at.localeCompare(a.at)).slice(0, KEEP);
  writeJsonAtomic(cacheFile(), Object.fromEntries(entries));
}

// The answers already given for each repo's main as it is now.
export async function cachedMainSafe(services: readonly PrService[]): Promise<Record<string, MainSafe>> {
  const cache = load();
  const found: Record<string, MainSafe> = {};
  for (const service of services) {
    const sha = await mainSha(service.localPath);
    const answer = sha ? cache[keyOf(service, sha)] : undefined;
    if (answer) found[service.key] = answer;
  }
  return found;
}

async function runSkill(dir: string): Promise<string> {
  if (isSnapshotRun()) {
    if (!prsFixture.mainSafe) throw new Error('Snapshot runs never start a real ismainsafe check.');
    return prsFixture.mainSafe(dir);
  }
  return runHeadless({ prompt: SKILL_PROMPT, cwd: dir, model: 'sonnet', tools: ['Read', 'Grep', 'Glob', 'Bash'], allowed: READ_ONLY_TOOLS, system: REPORT_FORMAT, timeoutMs: TIMEOUT_MS, label: 'The ismainsafe check' });
}

const running = new Map<string, Promise<MainSafe>>(); // one check per repo at a time; a second click waits on the first

export function checkMainSafe(service: PrService): Promise<MainSafe> {
  const dir = service.localPath;
  if (!isFolder(dir)) return Promise.reject(new Error(`No local copy of ${service.repo} was found, so main can’t be checked.`));
  const pending = running.get(service.key);
  if (pending) return pending;
  const run = (async () => {
    const sha = await mainSha(dir);
    const cached = sha ? load()[keyOf(service, sha)] : undefined;
    if (cached) return cached;
    const answer = parseMainSafe(await runSkill(dir), sha);
    if (sha) save(keyOf(service, sha), answer);
    return answer;
  })();
  running.set(service.key, run);
  void run.finally(() => running.delete(service.key)).catch(() => undefined);
  return run;
}
