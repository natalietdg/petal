import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

describe('buildStartCommand', () => {
  it('ends claude options and quotes the prompt, even one starting with a dash or holding quotes', async () => {
    const { buildStartCommand } = await import('../src/main/resume-command');
    expect(buildStartCommand("-it's fine")).toBe("claude -- '-it'\\''s fine'\r");
  });
});

describe('typed prompts keep Tab and newline literal', () => {
  const PROMPTS = ['col1\tcol2', 'line one\nline two\n\tindented', "tab\tthen it's\t\tdone", '\tleading and trailing\t', 'esc \x1b[31m and del \x7f', 'nul\0gone'];
  const expected = (prompt: string): string => prompt.replace(/\0/g, '');

  it('the typed line has no control byte but the final carriage return', async () => {
    const { buildStartCommand } = await import('../src/main/resume-command');
    for (const prompt of PROMPTS) {
      const line = buildStartCommand(prompt);
      expect(line.endsWith('\r')).toBe(true);
      expect(line.slice(0, -1)).not.toMatch(/[\x00-\x1f\x7f]/); // eslint-disable-line no-control-regex
    }
  });

  it('a prompt without controls is typed exactly as before', async () => {
    const { typedQuote } = await import('../src/main/resume-command');
    for (const value of NASTY.filter((v) => !v.includes('\n'))) expect(typedQuote(value)).toBe(shellQuote(value));
  });

  it.each(['/bin/zsh', '/bin/bash'])('%s parses each prompt back to the same text', async (shell) => {
    const { typedQuote } = await import('../src/main/resume-command');
    for (const prompt of PROMPTS) expect(execFileSync(shell, ['-c', `printf '%s' ${typedQuote(prompt)}`], { encoding: 'utf8' })).toBe(expected(prompt));
  });

  // Typed into a real interactive zsh line editor, where a raw Tab would run completion.
  it('an interactive zsh receives the Tabs literally', async () => {
    const { typedQuote } = await import('../src/main/resume-command');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petal-typed-'));
    fs.writeFileSync(path.join(dir, 'col1-completes-here'), ''); // a raw Tab after "col1" would complete to this name
    const out = path.join(dir, 'out');
    const prompt = 'col1\tcol2\n\tsecond line';
    const line = `cd ${shellQuote(dir)} && printf '%s' ${typedQuote(prompt)} > out\rexit\r`;
    execFileSync('python3', ['-c', TYPE_INTO_ZSH, line], { encoding: 'utf8', timeout: 15_000 });
    expect(fs.readFileSync(out, 'utf8')).toBe(prompt);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// Runs `zsh -f -i` on a pty, types argv[1] into it, and waits for it to exit.
const TYPE_INTO_ZSH = `
import os, pty, sys, time, select
pid, fd = pty.fork()
if pid == 0:
    os.execv('/bin/zsh', ['zsh', '-f', '-i'])
time.sleep(0.3)
os.write(fd, sys.argv[1].encode())
deadline = time.time() + 10
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.2)
    if r:
        try:
            if not os.read(fd, 4096): break
        except OSError: break
    done, _ = os.waitpid(pid, os.WNOHANG)
    if done: break
`;
