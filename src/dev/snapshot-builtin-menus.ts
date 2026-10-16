// Dev-only snapshot step: Claude Code's own menus in the prompt dock, and the "asking in the terminal" fallback.
// Screens are cat-ed into the fixture tab's shell; clicks are recorded in main (promptWrites), never typed.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { promptWrites } from '../main/snapshot-mode';
import { harnessLine, plainText, shellOutput } from '../main/snapshot-shell';
import type { Kit, TabsDeps } from './snapshot';
import { unclippedCheck } from './snapshot-divider';

const BORDER = '▔'.repeat(40);
const DOWN = '\x1b[B';
const MODEL_FOOTER = ' Enter to set as default · s to use this session only · Esc to cancel';

// Shapes captured from Claude Code 2.1.301 (test/fixtures/screens/builtin-*), narrowed to fit the snapshot terminal.
export const MODEL_SCREEN = [
  BORDER, ' Select model', ' Switch between Claude models. Your pick becomes', ' the default for new sessions.', '',
  '   1. Default (recommended)  Opus 5.5', '   2. Opus                   Opus 5.5 · Everyday work',
  '   3. Fable                  Fable 5.1 · Hardest tasks', '   4. Sonnet                 Sonnet 5.5 · Routine tasks',
  ' ❯ 5. Haiku ✔                Haiku 5.5 · Quick answers', '', ' ◐ Medium effort (default) ←/→ to adjust', '', MODEL_FOOTER,
];
// Her Team account: 13 models, so digits stop at 9 and the list scrolls.
const MODEL_LONG_SCREEN = [
  BORDER, ' Select model', '',
  '   1.  Default (recommended)  Fable 5', '   2.  Opus 5.5               Everyday work', '   3.  Fable 5.1              Toughest work',
  '   4.  Sonnet 5.5             Simpler tasks', ' ❯ 5.  Haiku 5.5 ✔            Quick answers', '   6.  Haiku 4.5              Quick answers',
  '   7.  Sonnet 5               Routine tasks', '   8.  Opus 5                 Complex tasks', '   9.  Fable 5                Longest tasks',
  ' ↓ 10. Opus 4.8               Complex tasks', '    … +3 models', '', MODEL_FOOTER,
];
const memoryScreen = (cursor: number) => [
  BORDER, ' Memory', '', ' ❯ Auto-memory  true', '',
  ...['User instructions      Saved in ~/.claude/CLAUDE.md', 'Project instructions   Saved in ./CLAUDE.md', 'Open auto-memory folder']
    .map((row, i) => `${i === cursor ? ' ❯ ' : '   '}${row}`),
  '', ' Learn more: https://code.claude.com/docs/en/memory', '', ' Enter to confirm · Esc to cancel',
];
// /resume: a search box over the list, a footer that wraps; no card reads it.
const RESUME_SCREEN = [
  BORDER, ' Resume session', ' ╭──────────────────────────────────╮', ' │ ⌕ Search…                        │', ' ╰──────────────────────────────────╯',
  '   acme-notes', '', ' ❯ add a slash menu', '   18 seconds ago · main · 6KB', '', '   fix the build', '   2 hours ago · main · 3.9KB', '',
  '   Ctrl+A to show all projects · Type to search · Esc to', '   cancel',
];

interface MenuState {
  hidden: boolean;
  title: string | null;
  subtitle: string | null;
  options: { num: string | null; label: string; desc: string | null; current: boolean; focused: boolean; disabled: boolean }[];
  hint: string | null;
  status: string;
}

const MENU = `(() => {
  const c = document.querySelector('.menu-card');
  return {
    hidden: c.hidden,
    title: c.querySelector('.qc-text')?.textContent ?? null,
    subtitle: c.querySelector('.mc-subtitle')?.textContent ?? null,
    options: [...c.querySelectorAll('.mc-option')].map((b) => ({ num: b.querySelector('.qc-num')?.textContent ?? null, label: b.querySelector('.qc-label').textContent,
      desc: b.querySelector('.qc-desc')?.textContent ?? null, current: Boolean(b.querySelector('.mc-current')), focused: b.dataset.focused === 'true', disabled: b.disabled })),
    hint: c.querySelector('.qc-hint')?.textContent ?? null,
    status: c.querySelector('.qc-status')?.textContent ?? '',
  };
})()`;

export async function builtinMenusCheck(kit: Kit, { win, activeSession }: Pick<TabsDeps, 'activeSession'> & { win: BrowserWindow }): Promise<void> {
  const { js, wait, waitFor, log, outDir } = kit;
  const session = activeSession(win.webContents.id);
  if (!session) throw new Error('builtin menus check: needs the fixture tab');
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} ${what}`);
  const menu = (): Promise<MenuState> => js(MENU);
  const menuWhen = (ok: (m: MenuState) => boolean) => waitFor(async () => { const m = await menu(); return !m.hidden && ok(m) ? m : null; }, 8000);
  const writesAfter = async (count: number) => waitFor(() => (promptWrites.length > count ? promptWrites.at(-1) ?? null : null), 5000);
  const click = async (selector: string, index = 0) => {
    const before = promptWrites.length;
    await js(`document.querySelectorAll(${JSON.stringify(selector)})[${index}].click()`);
    return writesAfter(before);
  };
  // zsh drops typeahead on ^C, so the next line waits for a fresh prompt; a busy run takes longer than any fixed sleep.
  const interruptToPrompt = async () => {
    const key = `${session.contentsId}:${session.tabId}`;
    const before = (shellOutput.get(key) ?? '').length;
    session.pty.write('\x03');
    for (let waited = 0; waited < 5000; waited += 50) {
      if (plainText((shellOutput.get(key) ?? '').slice(before)).includes('petal-snapshot % ')) break;
      await wait(50);
    }
    await wait(50);
  };
  const show = async (name: string, lines: string[]) => {
    const target = path.join(outDir, `screen-${name}.txt`);
    fs.writeFileSync(target, `${lines.join('\n')}\n`);
    await interruptToPrompt();
    session.pty.write(harnessLine(`clear; cat '${target}'; read -r _`));
  };
  const clearScreen = async () => {
    await interruptToPrompt();
    session.pty.write(harnessLine('clear'));
  };
  const shot = (name: string) => kit.verifiedCapture({ ...kit, theme: kit.themes.paleSky, panelOpen: false, name, scrollTo: '#prompt-dock' });
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  kit.applyTheme('paleSky', { persist: false });
  await js('PastelTerm.layout.setTerminalMinimised(false, false)');
  log(`terminal cols ${await js('PastelTerm.tabs.active().term.cols')}`);

  // /model: options with descriptions, the current one marked; a digit picks it.
  await show('menu-model', MODEL_SCREEN);
  const model = await menuWhen((m) => m.title === 'Select model');
  check(model && model.subtitle === 'Switch between Claude models. Your pick becomes the default for new sessions.'
    && same(model.options.map((o) => o.label), ['Default (recommended)', 'Opus', 'Fable', 'Sonnet', 'Haiku'])
    && model.options[1]?.desc === 'Opus 5.5 · Everyday work' && same(model.options.map((o) => o.current), [false, false, false, false, true])
    && model.options[4]?.focused && model.options[0]?.num === '1.', `dock shows the /model options: ${JSON.stringify(model)}`);
  const asking = await waitFor(async () => (await js("document.querySelector('#latest .reader-asking')?.textContent ?? null")) as string | null, 5000);
  check(asking === 'Claude Code is showing a menu · pick below', `reader says a menu is open: ${JSON.stringify(asking)}`);
  await unclippedCheck(kit, 'menu card', '.menu-card');
  await shot('model-dock');
  check(same(await click('.menu-card .mc-option', 1), ['2']), 'picking Opus writes ["2"]');
  check((await menu()).status.startsWith('Sent'), 'card says it was sent');
  await wait(1800);
  check(same(await click('.menu-card .mc-cancel'), ['\x1b']), 'Esc · Cancel writes Esc');
  await clearScreen();
  check(await waitFor(async () => (await menu()).hidden || null, 8000), 'card disappears when the menu leaves the screen');

  // 13 models: a 2-digit row is reached by arrows from the cursor, then Enter.
  await show('menu-model-long', MODEL_LONG_SCREEN);
  const long = await menuWhen((m) => m.options.length === 10);
  check(long?.hint?.startsWith('More rows in the terminal'), `scrolled list says more rows are in the terminal: ${JSON.stringify(long?.hint)}`);
  check(same(await click('.menu-card .mc-option', 9), [DOWN, DOWN, DOWN, DOWN, DOWN, '\r']), 'picking 10. Opus 4.8 writes ↓×5 then Enter');
  await wait(1800);
  check(same(await click('.menu-card .mc-option', 1), ['\x1b[A', '\x1b[A', '\x1b[A', '\r']), 'picking 2. writes ↑×3 then Enter on a list past 9');

  // /memory, unnumbered: one ↓ per redraw until the cursor is on the row, then Enter.
  await wait(1000); // past main's double-click guard for the last pick
  await show('menu-memory-0', memoryScreen(0));
  await menuWhen((m) => m.title === 'Memory' && m.options[0]?.focused === true);
  const step1 = await click('.menu-card .mc-option', 2);
  // Ends the held `read` and draws the next frame in one write, as Claude redraws in place.
  const redrawn = async (name: string, cursor: number) => {
    const before = promptWrites.length;
    const target = path.join(outDir, `screen-${name}.txt`);
    fs.writeFileSync(target, `${memoryScreen(cursor).join('\n')}\n`);
    session.pty.write(`\r${harnessLine(`clear; cat '${target}'; read -r _`)}`);
    return writesAfter(before);
  };
  const step2 = await redrawn('menu-memory-1', 1);
  const step3 = await redrawn('menu-memory-2', 2);
  check(same([step1, step2, step3], [[DOWN], [DOWN], ['\r']]), `unnumbered pick steers ↓, ↓, then Enter: ${JSON.stringify([step1, step2, step3])}`);
  await clearScreen();
  await waitFor(async () => (await menu()).hidden || null, 8000);

  // Unparsed menu with the terminal minimised: a line and a Show terminal button, never silence.
  await js('PastelTerm.layout.setTerminalMinimised(true, false)');
  await show('menu-resume', RESUME_SCREEN);
  const fallback = await waitFor(() => js("(() => { const a = document.querySelector('.terminal-ask'); return a.hidden ? null : { text: a.querySelector('.ta-text').textContent, button: a.querySelector('.ta-show').textContent }; })()"), 8000);
  check(fallback && fallback.text === 'Claude is asking in the terminal' && fallback.button === 'Show terminal', `fallback line while minimised: ${JSON.stringify(fallback)}`);
  check(await js("document.querySelector('.menu-card').hidden && document.querySelector('.question-card').hidden && document.querySelector('.permission-bar').hidden"), 'no card claims the unparsed menu');
  const fallbackAsking = await js("document.querySelector('#latest .reader-asking')?.textContent ?? null");
  check(fallbackAsking === 'Claude is asking in the terminal', `reader says so too: ${JSON.stringify(fallbackAsking)}`);
  await shot('fallback');
  await js("document.querySelector('.terminal-ask .ta-show').click()");
  check(!(await js('PastelTerm.layout.isTerminalMinimised()')) && await js("document.querySelector('.terminal-ask').hidden"), 'Show terminal restores it and the line goes');
  await js('PastelTerm.layout.setTerminalMinimised(true, false)');
  await clearScreen();
  check(await waitFor(async () => (await js("document.querySelector('.terminal-ask').hidden")) || null, 8000), 'line goes once the menu leaves the screen');
  await js('PastelTerm.layout.setTerminalMinimised(false, false)');
  await wait(500);
}
