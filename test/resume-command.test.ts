import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildResumeCommand, resumeArgs, shellQuote } from '../src/main/resume-command';

// What a POSIX shell actually sees after parsing the quoted word.
const throughShell = (quoted: string): string => execFileSync('/bin/sh', ['-c', `printf '%s' ${quoted}`], { encoding: 'utf8' });

const NASTY = [
  'plain',
  'with space',
  "it's",
  "''",
  '$HOME',
  '$(touch /tmp/petal-pwned)',
  '`id`',
  '"double"',
  'semi; rm -rf ~',
  'back\\slash',
  'new\nline',
  '*?[glob]',
  '',
];

describe('shellQuote', () => {
  it('wraps in single quotes and escapes embedded quotes', () => {
    expect(shellQuote('abc')).toBe("'abc'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote('')).toBe("''");
    expect(shellQuote(42)).toBe("'42'");
  });

  it.each(NASTY)('round-trips %j through /bin/sh unchanged', (value) => {
    expect(throughShell(shellQuote(value))).toBe(value);
  });
});

describe('resume command', () => {
  it('resumeArgs quotes the session id', () => {
    expect(resumeArgs('0b6d5a1e-1111-2222-3333-444455556666')).toBe("--resume '0b6d5a1e-1111-2222-3333-444455556666'");
    expect(resumeArgs("x'; echo pwned")).toBe("--resume 'x'\\''; echo pwned'");
  });

  it('buildResumeCommand cds into the quoted folder and ends with a carriage return', () => {
    expect(buildResumeCommand('/Users/me/My Project', 'abc')).toBe("cd '/Users/me/My Project' && claude --resume 'abc'\r");
  });

  it('a hostile cwd and id stay literal when the shell parses the line', () => {
    const line = buildResumeCommand("/tmp/a b/$x/`id`/it's", "id'$(whoami)");
    const args = line.replace(/^cd /, '').replace(/\r$/, '').split(' && claude --resume ');
    expect(args).toHaveLength(2);
    expect(throughShell(args[0])).toBe("/tmp/a b/$x/`id`/it's");
    expect(throughShell(args[1])).toBe("id'$(whoami)");
  });
});
