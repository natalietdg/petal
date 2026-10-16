// 1.0.7 new-user regressions: claude found but not on the tab's PATH, and a terminal too short for Claude Code's first-run screens.
import { describe, expect, it } from 'vitest';
import { pathWithClaudeDir } from '../src/main/claude-cli';
import { CLAUDE_SETUP_ROWS, READER_SPLIT, readerShareForRows } from '../src/shared/reader-split';
import { factsFrom, needsSetupRoom, stepStates } from '../src/shared/get-started';
import { parseBuiltinMenu, screenIsAsking } from '../src/shared/prompt-answer';
import fs from 'node:fs';
import path from 'node:path';

const screen = (name: string): string[] => fs.readFileSync(path.join(__dirname, 'fixtures', 'screens', `${name}.txt`), 'utf8').split('\n');

const FINDER_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

describe('the tab shell can run the claude Petal found', () => {
  it('adds a fresh native install folder that is not on PATH yet', () => {
    expect(pathWithClaudeDir(FINDER_PATH, '/Users/x/.local/bin')).toBe(`${FINDER_PATH}:/Users/x/.local/bin`);
  });

  it('leaves her PATH alone when the folder is already on it, or nothing was found', () => {
    expect(pathWithClaudeDir('/Users/x/.local/bin:/usr/bin', '/Users/x/.local/bin')).toBe('/Users/x/.local/bin:/usr/bin');
    expect(pathWithClaudeDir(FINDER_PATH, null)).toBe(FINDER_PATH);
  });
});

describe('room for Claude Code first-run screens', () => {
  // The default 1280x900 window as measured in the released 1.0.7: 855px app, 33px rows, 66px of tab strip and padding.
  const window900 = { totalPx: 848, rowPx: 33, paneExtraPx: 66 };
  const rowsAt = (share: number, size: typeof window900) => Math.floor(((1 - share) * size.totalPx - size.paneExtraPx) / size.rowPx);

  it('the usual split leaves about the 7 rows new users saw', () => {
    expect(rowsAt(READER_SPLIT.initial, window900)).toBeLessThanOrEqual(7);
  });

  it('a tall enough window gets every first-run row', () => {
    const window1200 = { ...window900, totalPx: 1148 };
    expect(rowsAt(readerShareForRows(CLAUDE_SETUP_ROWS, window1200), window1200)).toBeGreaterThanOrEqual(CLAUDE_SETUP_ROWS);
  });

  it('a 900px window gives the terminal all it can, short of the reader chrome', () => {
    expect(readerShareForRows(CLAUDE_SETUP_ROWS, window900)).toBe(READER_SPLIT.min);
    expect(rowsAt(READER_SPLIT.min, window900)).toBeGreaterThanOrEqual(16); // the theme picker's list shows from here
  });

  it('never gives the reader more than usual', () => {
    expect(readerShareForRows(1, { totalPx: 3000, rowPx: 33, paneExtraPx: 66 })).toBe(READER_SPLIT.initial);
  });

  it('a new user gets the room until sign-in is behind her', () => {
    const fresh = factsFrom([{ state: 'live', sessionId: null, replies: 0 }], true);
    expect(needsSetupRoom(stepStates([], fresh))).toBe(true);
    const signedIn = factsFrom([{ state: 'live', sessionId: 's1', replies: 0 }], true);
    expect(needsSetupRoom(stepStates([], signedIn))).toBe(false);
    expect(needsSetupRoom(stepStates([], factsFrom([], true, true)))).toBe(false); // History has past sessions
  });
});

// Captured from Claude Code 2.1.301 with an empty CLAUDE_CONFIG_DIR in Petal 1.0.7's terminal; nothing personal on them.
describe('Claude Code first-run pickers as cards', () => {
  it('reads the theme picker with more rows below', () => {
    const menu = parseBuiltinMenu(screen('firstrun-theme-18rows'));
    expect(menu?.title).toBe('Choose the text style that looks best with your terminal');
    expect(menu?.subtitle).toBe('To change this later, run /theme');
    expect(menu?.scrolled).toBe(true);
    expect(menu?.numbered).toBe(false);
    expect(menu?.options.map((o) => [o.label, o.current, o.focused])).toEqual([
      ['Auto (match terminal)', false, false], ['Dark mode', true, true], ['Light mode', false, false],
    ]);
  });

  it('reads the theme picker at the 16 rows a 900px window now gets', () => {
    expect(parseBuiltinMenu(screen('firstrun-theme-16rows'))?.options.map((o) => o.label)).toEqual(['Auto (match terminal)', 'Dark mode']);
  });

  it('reads the login method picker, split into label and description', () => {
    const menu = parseBuiltinMenu(screen('firstrun-login'));
    expect(menu?.title).toBe('Select login method:');
    expect(menu?.subtitle).toBe('');
    expect(menu?.options).toEqual([
      { number: null, label: 'Claude account with subscription', description: 'Pro, Max, Team, or Enterprise', current: false, focused: true },
      { number: null, label: 'Anthropic Console account', description: 'API usage billing', current: false, focused: false },
      { number: null, label: '3rd-party platform', description: 'Amazon Bedrock, Microsoft Foundry, Google Vertex AI', current: false, focused: false },
    ]);
    expect(screenIsAsking(screen('firstrun-login'))).toBe(true);
  });

  it('the 7-row screen 1.0.7 showed has no picker left to read', () => {
    expect(parseBuiltinMenu(screen('firstrun-theme-7rows'))).toBeNull();
  });
});
