// What a new user sees when the folder is off or Claude Code isn't installed: no setup room, and the right reader line.
import { describe, expect, it } from 'vitest';
import { factsFrom, needsSetupRoom, stepStates } from '../src/shared/get-started';
import { emptyLine, type EmptyFacts } from '../src/shared/reader-empty';
import { INSTALL_COMMAND } from '../src/shared/claude-setup-hints';

const liveTab = { state: 'live' as const, sessionId: null, replies: 0 };
const facts = (over: Partial<EmptyFacts>): EmptyFacts => ({ hasReply: false, live: false, claudeSetup: false, folderAllowed: true, claudeMissing: false, ...over });

describe('setup room', () => {
  it('folder off: sign-in can never be seen, so the terminal is not held open for it', () => {
    expect(needsSetupRoom(stepStates([], factsFrom([liveTab], true, false, true)))).toBe(false);
  });

  it('not installed: there are no first-run screens to make room for', () => {
    expect(needsSetupRoom(stepStates([], factsFrom([{ ...liveTab, state: 'none' }], false)))).toBe(false);
    expect(needsSetupRoom(stepStates(['install'], factsFrom([], false)))).toBe(false); // a hand tick is not a seen install
  });

  it('installed, folder on, not signed in: room as before', () => {
    expect(needsSetupRoom(stepStates([], factsFrom([liveTab], true)))).toBe(true);
  });
});

describe('empty reader line', () => {
  it('folder off wins over setting up', () => {
    expect(emptyLine(facts({ live: true, claudeSetup: true, folderAllowed: false }))).toBe('folder-off');
    expect(emptyLine(facts({ hasReply: true, folderAllowed: false }))).toBe('folder-off');
  });

  it('a new user with the folder on sees the setting-up line while claude runs', () => {
    expect(emptyLine(facts({ live: true, claudeSetup: true }))).toBe('setting-up');
    expect(emptyLine(facts({ live: true }))).toBe('running');
  });

  it('no claude installed and none running: the not-installed line', () => {
    expect(emptyLine(facts({ claudeMissing: true }))).toBe('not-installed');
    expect(emptyLine(facts({}))).toBe('start');
    expect(emptyLine(facts({ hasReply: true }))).toBeNull();
  });

  it('the install command is the official native installer', () => {
    expect(INSTALL_COMMAND).toBe('curl -fsSL https://claude.ai/install.sh | bash');
  });
});
