import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { replyVisibilityProblem } from '../src/main/reply-visibility';

const made: string[] = [];
function claudeHome(parts: { projects?: boolean; sessions?: boolean }): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petal-visibility-'));
  made.push(home);
  if (parts.projects) fs.mkdirSync(path.join(home, 'projects'));
  if (parts.sessions) fs.mkdirSync(path.join(home, 'sessions'));
  return home;
}

afterEach(() => {
  for (const dir of made.splice(0)) {
    fs.chmodSync(dir, 0o700);
    for (const sub of ['projects', 'sessions']) if (fs.existsSync(path.join(dir, sub))) fs.chmodSync(path.join(dir, sub), 0o700);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('replyVisibilityProblem', () => {
  it('says nothing while the folder is off or Claude Code has never run', () => {
    expect(replyVisibilityProblem(null)).toBeNull();
    expect(replyVisibilityProblem(claudeHome({}))).toBeNull();
  });

  it('says nothing when both folders are readable', () => {
    const home = claudeHome({ projects: true, sessions: true });
    fs.writeFileSync(path.join(home, 'sessions', '123.json'), '{}');
    expect(replyVisibilityProblem(home)).toBeNull();
  });

  it('names the missing sessions folder and the fix', () => {
    const problem = replyVisibilityProblem(claudeHome({ projects: true }));
    expect(problem).toMatch(/sessions is missing\. Claude Code writes it from version 2\.1\.75, so run claude update\./);
    expect(problem).not.toContain('—');
  });

  it.skipIf(process.getuid?.() === 0)('names an unreadable session file and why', () => {
    const home = claudeHome({ projects: true, sessions: true });
    const file = path.join(home, 'sessions', '456.json');
    fs.writeFileSync(file, '{}');
    fs.chmodSync(file, 0o000);
    expect(replyVisibilityProblem(home)).toMatch(/can’t read .*456\.json \(EACCES\)/);
  });

  it.skipIf(process.getuid?.() === 0)('names an unreadable sessions folder', () => {
    const home = claudeHome({ projects: true, sessions: true });
    fs.chmodSync(path.join(home, 'sessions'), 0o000);
    expect(replyVisibilityProblem(home)).toMatch(/can’t open .*sessions \(EACCES\)/);
  });
});
