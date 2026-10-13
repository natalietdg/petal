// Which process is the claude CLI, for every documented install (native, Homebrew cask, npm), from synthetic `ps` output.
import { describe, expect, it } from 'vitest';
import { claudeRunsUnder, isClaudeCli, parseProcessRows, type ProcessRow } from '../src/main/claude-session';

describe('isClaudeCli', () => {
  it('native installer and Homebrew cask: a binary named claude', () => {
    expect(isClaudeCli('claude')).toBe(true); // run as `claude` from PATH
    expect(isClaudeCli('/Users/x/.local/bin/claude')).toBe(true);
    expect(isClaudeCli('/opt/homebrew/bin/claude')).toBe(true);
    expect(isClaudeCli('/opt/homebrew/Caskroom/claude-code/2.1.296/claude')).toBe(true);
  });

  it('npm today: the bin/claude link, or the claude.exe it points at', () => {
    expect(isClaudeCli('/usr/local/lib/node_modules/.bin/claude')).toBe(true);
    expect(isClaudeCli('/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe')).toBe(true);
  });

  it('npm before the native package: node running the claude bin or cli.js', () => {
    expect(isClaudeCli('node', 'node /usr/local/bin/claude --resume')).toBe(true);
    expect(isClaudeCli('/opt/homebrew/bin/node', '/opt/homebrew/bin/node /Users/x/.npm-global/lib/node_modules/@anthropic-ai/claude-code/cli.js')).toBe(true);
    expect(isClaudeCli('claude', 'claude')).toBe(true); // after it renames itself
  });

  it('not helpers, other node scripts, or node without its command line', () => {
    expect(isClaudeCli('claude bg-spare')).toBe(false);
    expect(isClaudeCli('claude bg-pty-host')).toBe(false);
    expect(isClaudeCli('node', 'node /Users/x/app/server.js --name claude')).toBe(false);
    expect(isClaudeCli('node', 'node /Users/x/claude-notes/index.js')).toBe(false);
    expect(isClaudeCli('node')).toBe(false);
    expect(isClaudeCli('/usr/bin/env', '/usr/bin/env node /usr/local/bin/claude')).toBe(false); // the instant before node starts
  });
});

describe('the claude in a tab', () => {
  const PETAL = 100;
  const tree = (claude: Omit<ProcessRow, 'pid' | 'ppid'>): ProcessRow[] => [
    ...parseProcessRows(`  200   ${PETAL} Petal Helper\n  201   200 -zsh\n`),
    { pid: 300, ppid: 201, ...claude },
  ];

  it('parses ps rows, keeping spaces in the command name', () => {
    expect(parseProcessRows('  201   200 -zsh\n 300 201 claude bg-spare\njunk\n')).toEqual([
      { pid: 201, ppid: 200, comm: '-zsh' },
      { pid: 300, ppid: 201, comm: 'claude bg-spare' },
    ]);
  });

  it('is found under every install shape', () => {
    expect(claudeRunsUnder(PETAL, tree({ comm: 'claude' }))).toBe(true);
    expect(claudeRunsUnder(PETAL, tree({ comm: '/opt/homebrew/bin/claude' }))).toBe(true);
    expect(claudeRunsUnder(PETAL, tree({ comm: '/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe' }))).toBe(true);
    expect(claudeRunsUnder(PETAL, tree({ comm: 'node', args: 'node /usr/local/bin/claude' }))).toBe(true);
  });

  it('a plain node process in the tab is not claude', () => {
    expect(claudeRunsUnder(PETAL, tree({ comm: 'node', args: 'node server.js' }))).toBe(false);
  });
});
