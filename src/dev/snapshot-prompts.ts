// Dev-only snapshot step: the question card and permission bar, on the fixture tab. Clicks are recorded in
// main (promptWrites) instead of typed, and the pickers are drawn by cat-ing captured screens into the shell.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { promptWrites } from '../main/snapshot-mode';
import type { Kit, TabsDeps } from './snapshot';

const RULE = '─'.repeat(40);
const DASHED = '╌'.repeat(40);
const TABBED_FOOTER = 'Enter to select · Tab/Arrow keys to navigate · Esc to cancel';

// Shapes captured live from Claude Code 2.1.293 (test/fixtures/screens/q293-*), narrowed to fit the snapshot terminal.
export const SINGLE_SCREEN = [
  RULE, ' ☐ Fruit', '', 'Which fruit do you prefer?', '',
  '❯ 1. Apple (Recommended)', '     Crisp and sweet.', '  2. Mango', '     Soft, sweet and tropical.', '  3. Type something.',
  RULE, '  4. Chat about this', '', 'Enter to select · ↑/↓ to navigate · Esc to cancel',
];
const fruitsTab = (apple: string, plum: string, bar: string) => [
  RULE, bar, '', 'Which fruits do you like?', '',
  `❯ 1. [${apple}] Apple`, '         Crisp and sweet.', '  2. [ ] Pear', '         Soft, juicy and mild.',
  `  3. [${plum}] Plum`, '         Tart-sweet.', '  4. [ ] Type something', '     Next',
  RULE, '  5. Chat about this', '', TABBED_FOOTER,
];
const FRUITS_SCREEN = fruitsTab(' ', ' ', '←  ☐ Fruits  ☐ Colour  ✔ Submit  →');
const FRUITS_TICKED_SCREEN = fruitsTab('✔', '✔', '←  ☒ Fruits  ☐ Colour  ✔ Submit  →');
const COLOUR_SCREEN = [
  RULE, '←  ☒ Fruits  ☐ Colour  ✔ Submit  →', '', 'Which colour do you prefer?', '',
  '❯ 1. Red', '     A warm, bold colour.', '  2. Blue', '     A cool, calm colour.', '  3. Type something.',
  RULE, '  4. Chat about this', '', TABBED_FOOTER,
];
const REVIEW_SCREEN = [
  RULE, '←  ☒ Fruits  ☒ Colour  ✔ Submit  →', '', 'Review your answers', '',
  ' ● Which fruits do you like?', '   → Apple, Plum', ' ● Which colour do you prefer?', '   → teal', '',
  'Ready to submit your answers?', '', '❯ 1. Submit answers', '  2. Cancel',
];
const PERMISSION_SCREEN = [
  '⏺ Listing files in /private/tmp', '  ⎿  $ ls -la /private/tmp', RULE,
  ' Bash command', ' List files in /private/tmp with details', DASHED, ' ls -la /private/tmp', DASHED,
  ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, allow reading from /private/tmp from this project', '   3. No', '',
  ' Esc to cancel · Tab to amend',
];

interface CardState {
  hidden: boolean;
  tabs: string[];
  current: string | null;
  chip: string | null;
  text: string | null;
  options: { label: string; desc?: string; pressed: string | null; disabled: boolean }[];
  other: boolean;
  nav: string[];
  review: string[];
  status: string;
}

const CARD = `(() => {
  const c = document.querySelector('.question-card');
  const texts = (sel) => [...c.querySelectorAll(sel)].map((n) => n.textContent);
  return {
    hidden: c.hidden,
    tabs: texts('.qc-tab'),
    current: c.querySelector('.qc-tab[aria-current]')?.textContent ?? null,
    chip: c.querySelector('.qc-chip')?.textContent ?? null,
    text: c.querySelector('.qc-text')?.textContent ?? null,
    options: [...c.querySelectorAll('.qc-option')].map((b) => ({ label: b.querySelector('.qc-label').textContent, desc: b.querySelector('.qc-desc')?.textContent, pressed: b.getAttribute('aria-pressed'), disabled: b.disabled })),
    other: Boolean(c.querySelector('.qc-other-input')),
    nav: texts('.qc-nav, .qc-submit'),
    review: texts('.qc-review dt, .qc-review dd'),
    status: c.querySelector('.qc-status')?.textContent ?? '',
  };
})()`;

export async function promptsCheck(kit: Kit, { win, activeSession }: Pick<TabsDeps, 'activeSession'> & { win: BrowserWindow }): Promise<void> {
  const { js, wait, waitFor, log, themes, applyTheme, verifiedCapture, outDir } = kit;
  const session = activeSession(win.webContents.id);
  if (!session) throw new Error('prompts check: needs the fixture tab');
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} ${what}`);
  const card = (): Promise<CardState> => js(CARD);
  const writesAfter = async (count: number) => waitFor(() => (promptWrites.length > count ? promptWrites.at(-1) ?? null : null), 5000);
  const click = async (selector: string, index = 0) => {
    const before = promptWrites.length;
    await js(`document.querySelectorAll(${JSON.stringify(selector)})[${index}].click()`);
    return writesAfter(before);
  };
  // Draws a screen and holds it, so no shell prompt lands under the picker.
  const show = async (name: string, lines: string[]) => {
    const target = path.join(outDir, `screen-${name}.txt`);
    fs.writeFileSync(target, `${lines.join('\n')}\n`);
    session.pty.write('\x03');
    await wait(200);
    session.pty.write(`clear; cat '${target}'; read -r _\r`);
  };
  const clearScreen = async () => {
    session.pty.write('\x03');
    await wait(300);
    session.pty.write('clear\r');
  };
  const cardWhen = (ok: (c: CardState) => boolean) =>
    waitFor(async () => { const c = await card(); return !c.hidden && ok(c) ? c : null; }, 8000);
  const capturePair = async (name: string) => {
    for (const id of ['paleSky', 'nightPastel']) {
      applyTheme(id, { persist: false });
      await verifiedCapture({ ...kit, theme: themes[id], panelOpen: false, name: `${name}-${id}`, scrollTo: '#prompt-dock' });
    }
    applyTheme('paleSky', { persist: false });
  };

  // A lone single-select question: the card mirrors the picker, one click answers.
  await show('question-single', SINGLE_SCREEN);
  const single = await cardWhen((c) => c.chip === 'Fruit');
  check(single && single.text === 'Which fruit do you prefer?' && single.options.length === 2 && single.options[1].desc === 'Soft, sweet and tropical.'
    && single.other && !single.tabs.length && !single.nav.length, `lone question card reads the screen: ${JSON.stringify(single)}`);
  await capturePair('question-card');
  check(JSON.stringify(await click('.question-card .qc-option', 1)) === JSON.stringify(['2']), 'clicking Mango writes ["2"]');
  check((await card()).status.startsWith('Sent'), 'card says it was sent');
  const beforeDouble = promptWrites.length;
  await js("document.querySelectorAll('.question-card .qc-option')[0].click()");
  await wait(600);
  check(promptWrites.length === beforeDouble, `a second click before the screen moves sends nothing (writes ${promptWrites.length - beforeDouble})`);
  await clearScreen();
  check(await waitFor(async () => (await card()).hidden || null, 8000), 'card disappears when the picker leaves the screen');

  // Two tabbed questions, the first multiSelect: tick, Next, type, review, Submit. One step per screen, as on 2.1.293.
  await show('question-fruits', FRUITS_SCREEN);
  const fruits = await cardWhen((c) => c.text === 'Which fruits do you like?');
  check(fruits && JSON.stringify(fruits.tabs) === JSON.stringify(['Fruits', 'Colour', 'Submit']) && !fruits.other
    && JSON.stringify(fruits.nav) === JSON.stringify(['Back', 'Next']) && fruits.options.every((o) => o.pressed === 'false'),
  `first tab: tab strip, unticked boxes, Back/Next: ${JSON.stringify(fruits)}`);
  check(JSON.stringify(await click('.question-card .qc-option', 0)) === JSON.stringify(['1']), 'ticking Apple writes ["1"]');
  await show('question-fruits-ticked', FRUITS_TICKED_SCREEN);
  const ticked = await cardWhen((c) => c.options[0]?.pressed === 'true');
  check(ticked && JSON.stringify(ticked.options.map((o) => o.pressed)) === JSON.stringify(['true', 'false', 'true']) && ticked.tabs[0] === '✓ Fruits',
    `ticks follow the screen: ${JSON.stringify(ticked)}`);
  await capturePair('question-card-multi');
  check(JSON.stringify(await click('.question-card .qc-nav', 1)) === JSON.stringify(['\x1b[C']), 'Next writes →');

  await show('question-colour', COLOUR_SCREEN);
  const colour = await cardWhen((c) => c.text === 'Which colour do you prefer?');
  check(colour && colour.other && colour.options.length === 2, `second tab shows its own options and a typed answer: ${JSON.stringify(colour)}`);
  await js(`(() => { const input = document.querySelector('.question-card .qc-other-input'); input.value = 'teal'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const typed = await click('.question-card .qc-send');
  check(JSON.stringify(typed) === JSON.stringify(['3', 'teal', '\r']), `Send writes ${JSON.stringify(typed)} (want ["3","teal","\\r"])`);

  await show('question-review', REVIEW_SCREEN);
  const review = await cardWhen((c) => c.current === 'Submit');
  check(review && JSON.stringify(review.review) === JSON.stringify(['Which fruits do you like?', 'Apple, Plum', 'Which colour do you prefer?', 'teal'])
    && JSON.stringify(review.nav) === JSON.stringify(['Back', 'Cancel', 'Submit answers']), `review page lists every answer: ${JSON.stringify(review)}`);
  await capturePair('question-card-review');
  check(JSON.stringify(await click('.question-card .qc-submit')) === JSON.stringify(['1']), 'Submit answers writes ["1"]');
  await clearScreen();
  check(await waitFor(async () => (await card()).hidden || null, 8000), 'card disappears after the review page');

  // Main refuses steps that aren't picker keys, even straight from the bridge.
  await wait(400);
  const beforeBad = promptWrites.length;
  for (const bad of [{ kind: 'picker', step: { pick: 0 } }, { kind: 'picker', step: { move: 'up' } }, { kind: 'question', toolUseId: 'x', answers: [{ selected: [0] }] }]) {
    await js(`window.pastel.answerPrompt(${JSON.stringify(session.tabId)}, ${JSON.stringify(bad)})`);
  }
  await wait(800);
  check(promptWrites.length === beforeBad, 'bad steps and the old transcript answers write nothing');

  // Permission prompt: drawn on screen, the bar offers its numbered options, a click writes the digit.
  await show('permission', PERMISSION_SCREEN);
  const bar = await waitFor(() => js("(() => { const b = document.querySelector('.permission-bar'); return b.hidden ? null : { title: b.querySelector('.qc-chip').textContent, question: b.querySelector('.pb-question').textContent, details: b.querySelector('.pb-details')?.textContent, options: [...b.querySelectorAll('.pb-option')].map((o) => o.textContent) }; })()"), 8000);
  check(bar && bar.title === 'Bash command' && bar.options.length === 3 && bar.options[2] === '3. No', `permission bar matches the screen: ${JSON.stringify(bar)}`);
  await capturePair('permission-bar');
  check(JSON.stringify(await click('.permission-bar .pb-option', 2)) === JSON.stringify(['3']), 'clicking No writes ["3"]');
  check(await js("[...document.querySelectorAll('.permission-bar .pb-option')].every((o) => o.disabled)"), 'bar buttons lock after one click');
  await clearScreen();
  check(await waitFor(async () => (await js("document.querySelector('.permission-bar').hidden")) || null, 8000), 'bar hides when the prompt leaves the screen');

  // Near misses (no cursor on any option; a picker with no Chat row): nothing to click.
  await show('near-miss', PERMISSION_SCREEN.map((row) => row.replace('❯', ' ')));
  await wait(1500);
  check(await js("document.querySelector('.permission-bar').hidden"), 'no bar for a screen that only nearly matches');
  await show('near-miss-picker', SINGLE_SCREEN.filter((row) => !row.includes('Chat about this')));
  await wait(1500);
  check((await card()).hidden, 'no card for a picker that only nearly matches');
  await clearScreen();
  await wait(500);
}
