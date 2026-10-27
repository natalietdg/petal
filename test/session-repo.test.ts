// A session in ~ is tested in the repo its own tool calls worked in: edits first, then touches, then the newest,
// a worktree counted for its main checkout, History's project name only when the log names none, and her pick first.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir, useTempUserData, writeJsonl } from './helpers';
import { forgetTranscriptRepos, namedRepo, pickRepo, touchesOf, transcriptRepo } from '../src/main/session-repo';
import { rootFor } from '../src/main/testing-ipc';
import type { TabSession } from '../src/main/tab-session';
import type { ContentItem } from '../src/main/transcript-entry';

beforeEach(useTempUserData);
afterEach(() => { removeTempDirs(); forgetTranscriptRepos(); });

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });

// Two real repos, the first with a worktree beside it; paths with links resolved (macOS /var is /private/var).
function repos(): { a: string; aWorktree: string; b: string } {
  const dir = fs.realpathSync(tempDir('petal-session-repo-'));
  const [a, b] = [path.join(dir, 'alpha'), path.join(dir, 'beta')];
  for (const repo of [a, b]) {
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    git(repo, 'init', '-q');
    fs.writeFileSync(path.join(repo, 'README.md'), 'x\n');
    git(repo, 'add', 'README.md');
    git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  }
  const aWorktree = path.join(dir, 'alpha-wt');
  git(a, 'worktree', 'add', '-q', aWorktree, '-b', 'feature');
  return { a, aWorktree, b };
}

let minute = 0;
const call = (name: string, input: Record<string, string>, extra: Record<string, unknown> = {}) => JSON.stringify({
  type: 'assistant', timestamp: new Date(Date.UTC(2026, 9, 27, 0, (minute += 1))).toISOString(), cwd: os.homedir(),
  message: { role: 'assistant', content: [{ type: 'tool_use', id: `t${minute}`, name, input }] }, ...extra,
});

const transcript = (lines: string[]): string => writeJsonl(path.join(tempDir('petal-log-'), 's.jsonl'), lines);

describe('the paths a tool call names', () => {
  const use = (name: string, input: Record<string, string>): ContentItem => ({ type: 'tool_use', name, input });
  it('edits from Edit/Write/NotebookEdit; touches from Read, Grep/Glob path, and each cd and git -C in a shell line', () => {
    expect(touchesOf(use('Edit', { file_path: '/r/a.ts' }), 1)).toEqual([{ dir: '/r/a.ts', kind: 'edit', at: 1 }]);
    expect(touchesOf(use('NotebookEdit', { notebook_path: '/r/n.ipynb' }), 1)[0].kind).toBe('edit');
    expect(touchesOf(use('Read', { file_path: '/r/b.ts' }), 1)[0]).toMatchObject({ dir: '/r/b.ts', kind: 'touch' });
    expect(touchesOf(use('Grep', { pattern: 'x', path: '/r/src' }), 1)[0].dir).toBe('/r/src');
    expect(touchesOf(use('Bash', { command: 'git -C /r1 status && cd "/r2" && npm test' }), 1).map((t) => t.dir).sort()).toEqual(['/r1', '/r2']);
    expect(touchesOf(use('Bash', { command: 'ls' }), 1)).toEqual([]);
    expect(touchesOf({ type: 'text', text: 'Edit /r/a.ts' }, 1)).toEqual([]);
  });
});

describe('the repo a session worked in', () => {
  it('the repo with the most edits wins over one only read, and a worktree’s edits count for its main checkout', async () => {
    const { a, aWorktree, b } = repos();
    const log = transcript([
      call('Read', { file_path: path.join(b, 'README.md') }), call('Read', { file_path: path.join(b, 'src/x.ts') }), call('Bash', { command: `git -C ${b} log` }),
      call('Edit', { file_path: path.join(aWorktree, 'README.md') }),
    ]);
    expect(await transcriptRepo(log)).toBe(a);
  });

  it('with no edits, most touches wins; on a tie, the most recent', async () => {
    const { a, b } = repos();
    expect(await transcriptRepo(transcript([call('Read', { file_path: path.join(a, 'README.md') }), call('Grep', { pattern: 'x', path: b }), call('Bash', { command: `cd ${b} && ls` })]))).toBe(b);
    expect(await transcriptRepo(transcript([call('Read', { file_path: path.join(b, 'README.md') }), call('Read', { file_path: path.join(a, 'README.md') })]))).toBe(a);
  });

  it('a subagent’s sidechain calls, untimed lines and paths outside any repo name nothing', async () => {
    const { a } = repos();
    const untimed = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: path.join(a, 'README.md') } }] } });
    const log = transcript([call('Edit', { file_path: path.join(a, 'README.md') }, { isSidechain: true }), untimed, call('Read', { file_path: path.join(os.tmpdir(), 'loose.txt') }), 'not json']);
    expect(await transcriptRepo(log)).toBeNull();
    expect(await transcriptRepo(path.join(os.tmpdir(), 'no-such-log.jsonl'))).toBeNull();
  });

  it('a log that grew is read again', async () => {
    const { a, b } = repos();
    const log = transcript([call('Edit', { file_path: path.join(a, 'README.md') })]);
    expect(await transcriptRepo(log)).toBe(a);
    fs.appendFileSync(log, [call('Edit', { file_path: path.join(b, 'README.md') }), call('Write', { file_path: path.join(b, 'src/y.ts') })].join('\n') + '\n');
    expect(await transcriptRepo(log)).toBe(b);
  });

  it('ranks edits, then touches, then the newest', () => {
    expect(pickRepo([{ root: '/a', edits: 1, touches: 0, lastAt: 1 }, { root: '/b', edits: 0, touches: 50, lastAt: 9 }])).toBe('/a');
    expect(pickRepo([{ root: '/a', edits: 2, touches: 1, lastAt: 1 }, { root: '/b', edits: 2, touches: 1, lastAt: 9 }])).toBe('/b');
    expect(pickRepo([])).toBeNull();
  });
});

describe('History’s project name, when the log names no repo', () => {
  it('matches a scanned repo by folder name, as its main checkout; no name or no match is null', () => {
    const { a, aWorktree } = repos();
    const entry = (p: string) => ({ name: path.basename(p), path: p, shortPath: p, branch: null, modifiedMs: 0 });
    expect(namedRepo('ALPHA', [entry(a)])).toBe(a);
    expect(namedRepo('alpha-wt', [entry(aWorktree)])).toBe(a);
    expect(namedRepo(null, [entry(a)])).toBeNull();
    expect(namedRepo('gamma', [entry(a)])).toBeNull();
  });
});

describe('the Testing tab’s project for a tab in ~', () => {
  const tab = (log: string | null): TabSession => ({
    pty: { pid: process.pid } as TabSession['pty'], contentsId: 1, tabId: 't1', agent: false,
    feed: { session: { sessionId: 'aaaaaaaa-0000-4000-8000-000000000001', cwd: os.homedir(), transcript: log, pid: 1 } } as unknown as TabSession['feed'],
  });

  it('follows the repo its session worked in; her pick for the tab still wins; nothing worked in gives null', async () => {
    const { a, b } = repos();
    const log = transcript([call('Edit', { file_path: path.join(a, 'README.md') })]);
    expect(await rootFor(tab(log), null)).toBe(a);
    expect(await rootFor(tab(log), b)).toBe(b);
    expect(await rootFor(tab(transcript([call('Bash', { command: 'ls' })])), null)).toBeNull();
  });
});
