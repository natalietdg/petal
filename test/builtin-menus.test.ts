// Claude Code 2.1.301's own menus, captured from a real pty (paths renamed): the third prompt kind and the Esc fallback.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBuiltinMenu, parsePermissionPrompt, parseQuestionPicker, screenIsAsking, screenOffersEsc } from '../src/shared/prompt-answer';
import { keysFor, menuKeys } from '../src/main/prompt-keys';

const screen = (name: string): string[] => fs.readFileSync(path.join(__dirname, 'fixtures', 'screens', `${name}.txt`), 'utf8').split('\n');
const DOWN = '\x1b[B';
const UP = '\x1b[A';

describe('parseBuiltinMenu', () => {
  it('reads /model on a Team account: title, 10 rows on screen, the current model, more below', () => {
    const menu = parseBuiltinMenu(screen('builtin-model-team'));
    expect(menu?.title).toBe('Select model');
    expect(menu?.subtitle).toBe('Switch between Claude models. Your pick becomes the default for new sessions. For other/previous model names, specify with --model.');
    expect(menu?.numbered).toBe(true);
    expect(menu?.scrolled).toBe(true);
    expect(menu?.options.map((o) => o.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(menu?.options[0]).toEqual({ number: 1, label: 'Default (recommended)', description: 'Fable 5', current: false, focused: false });
    expect(menu?.options[4]).toEqual({ number: 5, label: 'Haiku 5.5', description: 'Fastest for quick answers', current: true, focused: true });
    expect(menu?.options[9]?.label).toBe('Opus 4.8');
  });

  it('reads /model on an API account: wrapped descriptions joined, under a ──── border', () => {
    const menu = parseBuiltinMenu(screen('builtin-model-api'));
    expect(menu?.title).toBe('Select model');
    expect(menu?.scrolled).toBe(false);
    expect(menu?.options.map((o) => o.label)).toEqual(['Default (recommended)', 'Opus', 'Fable', 'Sonnet', 'Haiku']);
    expect(menu?.options[2]?.description).toBe('Fable 5.1 · Most capable for your hardest and longest-running tasks · $10/$50 per Mtok');
    expect(menu?.options.filter((o) => o.current).map((o) => o.label)).toEqual(['Haiku']);
  });

  it('follows the cursor after ↑↑: the focus moves, the ✔ stays', () => {
    const menu = parseBuiltinMenu(screen('builtin-model-api-moved'));
    expect(menu?.options.find((o) => o.focused)?.label).toBe('Fable');
    expect(menu?.options.find((o) => o.current)?.label).toBe('Haiku');
  });

  it('reads /memory: the list under its own Auto-memory toggle', () => {
    const menu = parseBuiltinMenu(screen('builtin-memory'));
    expect(menu?.title).toBe('Memory');
    expect(menu?.numbered).toBe(false);
    expect(menu?.options.map((o) => [o.label, o.description, o.focused])).toEqual([
      ['User instructions', 'Saved in ~/.claude/CLAUDE.md', true],
      ['Project instructions', 'Saved in ./CLAUDE.md', false],
      ['Open auto-memory folder', '', false],
    ]);
  });

  it('reads /mcp: one list across its blank-separated sections', () => {
    const menu = parseBuiltinMenu(screen('builtin-mcp'));
    expect(menu?.title).toBe('Manage MCP servers');
    expect(menu?.subtitle).toBe('30 servers');
    expect(menu?.options.find((o) => o.focused)?.label).toBe('✘ notes-server');
    expect(menu?.options.at(-1)?.label).toBe('✔ claude-in-chrome');
    expect(menu?.options.some((o) => o.label === '→ Show unused connectors')).toBe(true);
  });

  it('reads the folder trust prompt', () => {
    expect(parseBuiltinMenu(screen('trust-folder'))?.options.map((o) => o.label)).toEqual(['No, exit', 'Yes, I trust this folder']);
  });

  it.each(['builtin-resume', 'builtin-config'])('leaves %s (search box, wrapped or Esc-to-clear footer) to the fallback', (name) => {
    expect(parseBuiltinMenu(screen(name))).toBeNull();
    expect(screenOffersEsc(screen(name))).toBe(true);
    expect(screenIsAsking(screen(name))).toBe(true);
  });

  it.each(['question-single', 'q293-tabs-first', 'q293-review', 'permission-bash', 'permission-read-wrapped', 'idle-after-answer', 'q293-idle-after-answer'])('finds no menu on %s', (name) => {
    expect(parseBuiltinMenu(screen(name))).toBeNull();
  });

  it.each(['builtin-model-team', 'builtin-model-api', 'builtin-memory', 'builtin-mcp', 'builtin-resume', 'builtin-config'])('the other two kinds find nothing on %s', (name) => {
    expect(parseQuestionPicker(screen(name))).toBeNull();
    expect(parsePermissionPrompt(screen(name))).toBeNull();
  });

  it('refuses near misses: no cursor, anything below the footer, a gap in the numbers', () => {
    const lines = screen('builtin-model-api');
    expect(parseBuiltinMenu(lines.map((line) => line.replace('❯', ' ')))).toBeNull();
    const footer = lines.findIndex((line) => line.includes('Esc to cancel'));
    expect(parseBuiltinMenu([...lines.slice(0, footer + 1), '% '])).toBeNull();
    expect(parseBuiltinMenu(lines.map((line) => line.replace('3. Fable', '7. Fable')))).toBeNull();
  });

  it('an idle prompt offers no Esc', () => {
    expect(screenOffersEsc(screen('idle-after-answer'))).toBe(false);
    expect(screenIsAsking(screen('idle-after-answer'))).toBe(false);
  });
});

describe('menuKeys', () => {
  it('a digit, arrows with or without Enter, and Esc', () => {
    expect(menuKeys({ digit: 4 })).toEqual(['4']);
    expect(menuKeys({ arrows: 5, enter: true })).toEqual([DOWN, DOWN, DOWN, DOWN, DOWN, '\r']);
    expect(menuKeys({ arrows: -2, enter: false })).toEqual([UP, UP]);
    expect(menuKeys({ arrows: 0, enter: true })).toEqual(['\r']);
    expect(menuKeys({ cancel: true })).toEqual(['\x1b']);
    expect(keysFor({ kind: 'menu', step: { digit: 2 } })).toEqual(['2']);
  });

  it('refuses anything else', () => {
    for (const bad of [null, {}, { digit: 0 }, { digit: 10 }, { digit: '3' }, { arrows: 0, enter: false }, { arrows: 1.5, enter: true },
      { arrows: 500, enter: true }, { arrows: 2 }, { cancel: false }]) expect(menuKeys(bad)).toBeNull();
  });
});
