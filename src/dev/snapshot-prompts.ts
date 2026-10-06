// Dev-only snapshot step: the question card and permission bar, on the fixture tab. Clicks are recorded in
// main (promptWrites) instead of typed, and the pickers are drawn by cat-ing captured screens into the shell.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { fixtureFile, promptWrites } from '../main/snapshot-mode';
import { assertFixtureOutsideClaude } from './snapshot-views';
import type { Kit, TabsDeps } from './snapshot';

const RULE = '─'.repeat(40);
const DASHED = '╌'.repeat(40);

// Shapes measured from Claude Code 2.1.291 (see shared/prompt-answer.ts), narrowed to fit the snapshot terminal.
const SINGLE_SCREEN = [
  RULE, ' ☐ Fruit', 'Which fruit do you prefer?',
  '❯ 1. Apple', '     A crisp, round fruit', '  2. Pear', '     A sweet, bell-shaped fruit', '  3. Type something.',
  RULE, '  4. Chat about this', 'Enter to select · ↑/↓ to navigate · Esc to cancel',
];
const TWO_SCREEN = [
  RULE, '←  ☐ Fruits  ☐ Colour  ✔ Submit  →', 'Which fruits do you like?',
  '❯ 1. [ ] Apple', '  2. [ ] Pear', '  3. [ ] Plum', '  4. [ ] Type something', '     Next',
  RULE, '  5. Chat about this', 'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
];
const PERMISSION_SCREEN = [
  '⏺ Listing files in /private/tmp', '  ⎿  $ ls -la /private/tmp', RULE,
  ' Bash command', ' List files in /private/tmp with details', DASHED, ' ls -la /private/tmp', DASHED,
  ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, allow reading from /private/tmp from this project', '   3. No', '',
  ' Esc to cancel · Tab to amend',
];

const SINGLE = [{
  question: 'Which fruit do you prefer?', header: 'Fruit', multiSelect: false,
  options: [{ label: 'Apple', description: 'A crisp, round fruit' }, { label: 'Pear', description: 'A sweet, bell-shaped fruit' }],
}];
const TWO = [
  {
    question: 'Which fruits do you like?', header: 'Fruits', multiSelect: true,
    options: [{ label: 'Apple', description: 'Crisp' }, { label: 'Pear', description: 'Soft' }, { label: 'Plum', description: 'Tangy' }],
  },
  {
    question: 'Which colour do you prefer?', header: 'Colour', multiSelect: false,
    options: [{ label: 'Red', description: 'Warm' }, { label: 'Blue', description: 'Cool' }],
  },
];

const line = (fields: Record<string, unknown>) => `${JSON.stringify({ isSidechain: false, timestamp: new Date().toISOString(), ...fields })}\n`;
const askLine = (id: string, questions: unknown) => line({ type: 'assistant', uuid: `ask-${id}`, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions } }] } });
const resultLine = (id: string) => line({ type: 'user', uuid: `res-${id}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'answered' }] } });

export async function promptsCheck(kit: Kit, { win, activeSession }: Pick<TabsDeps, 'activeSession'> & { win: BrowserWindow }): Promise<void> {
  const { js, wait, waitFor, log, themes, applyTheme, verifiedCapture, outDir } = kit;
  const session = activeSession(win.webContents.id);
  const file = fixtureFile();
  if (!session || !file) throw new Error('prompts check: needs the fixture tab');
  assertFixtureOutsideClaude(file);
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} ${what}`);
  const dock = () => js('PastelTerm.promptDock.state()');
  const writesAfter = async (count: number) => waitFor(() => (promptWrites.length > count ? promptWrites.at(-1) ?? null : null), 5000);
  const screenFile = (name: string, lines: string[]) => {
    const target = path.join(outDir, `screen-${name}.txt`);
    fs.writeFileSync(target, `${lines.join('\n')}\n`);
    return target;
  };
  const show = (target: string, hold = false) => session.pty.write(`clear; cat '${target}'${hold ? '; read -r _' : ''}\r`);
  const capturePair = async (name: string) => {
    for (const id of ['paleSky', 'nightPastel']) {
      applyTheme(id, { persist: false });
      await verifiedCapture({ ...kit, theme: themes[id], panelOpen: false, name: `${name}-${id}`, scrollTo: '#prompt-dock' });
    }
    applyTheme('paleSky', { persist: false });
  };

  // One single-select question: the card shows from the transcript, wakes when the picker is on screen, one click answers.
  session.pty.write('clear\r');
  fs.appendFileSync(file, askLine('snap-ask-1', SINGLE));
  const card = await waitFor(async () => ((await dock()).question === 'snap-ask-1' ? js(`(() => { const c = document.querySelector('.question-card'); return { hidden: c.hidden, chip: c.querySelector('.qc-chip')?.textContent, text: c.querySelector('.qc-text')?.textContent, options: [...c.querySelectorAll('.qc-option')].map((b) => ({ label: b.querySelector('.qc-label').textContent, desc: b.querySelector('.qc-desc')?.textContent, disabled: b.disabled })), other: Boolean(c.querySelector('.qc-other-input')) }; })()`) : null), 8000);
  check(card && !card.hidden && card.chip === 'Fruit' && card.options.length === 2 && card.options[1].desc === 'A sweet, bell-shaped fruit' && card.other, `question card renders from a pending AskUserQuestion: ${JSON.stringify(card)}`);
  check(card?.options.every((o: { disabled: boolean }) => o.disabled), 'card buttons stay disabled until the terminal shows the picker');
  show(screenFile('question-single', SINGLE_SCREEN));
  const ready = await waitFor(async () => (await dock()).screenReady || null, 8000);
  check(ready && !(await js("document.querySelector('.question-card .qc-option').disabled")), 'card wakes once the picker is on screen');
  await capturePair('question-card');
  let before = promptWrites.length;
  await js("document.querySelectorAll('.question-card .qc-option')[1].click()");
  const single = await writesAfter(before);
  check(JSON.stringify(single) === JSON.stringify(['2']), `clicking Pear writes ${JSON.stringify(single)} (want ["2"])`);
  check((await js("document.querySelector('.question-card .qc-status').textContent")).startsWith('Sent'), 'card says it was sent');
  await js("document.querySelectorAll('.question-card .qc-option')[0].click()");
  await wait(600);
  check(promptWrites.length === before + 1, `a second click sends nothing (writes ${promptWrites.length - before})`);
  fs.appendFileSync(file, resultLine('snap-ask-1'));
  const gone = await waitFor(async () => (await js("document.querySelector('.question-card').hidden")) || null, 8000);
  check(gone, 'card disappears when the tool_result arrives');

  // Two questions, the first multiSelect: toggles, a typed answer, Submit.
  fs.appendFileSync(file, askLine('snap-ask-2', TWO));
  show(screenFile('question-two', TWO_SCREEN));
  const twoReady = await waitFor(async () => {
    const state = await dock();
    return state.question === 'snap-ask-2' && state.screenReady ? state : null;
  }, 8000);
  check(twoReady, 'two-question card shows and wakes');
  await js(`(() => {
    const options = document.querySelectorAll('.question-card .qc-option');
    options[0].click(); options[2].click();
    const input = document.querySelector('.question-card .qc-other-input');
    input.value = 'teal'; input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const pressed = await js("[...document.querySelectorAll('.question-card .qc-option')].map((b) => b.getAttribute('aria-pressed'))");
  check(JSON.stringify(pressed) === JSON.stringify(['true', 'false', 'true', 'false', 'false']), `multiSelect toggles show pressed: ${JSON.stringify(pressed)}`);
  check(!(await js("document.querySelector('.question-card .qc-submit').disabled")), 'Submit enabled once every question has an answer');
  await capturePair('question-card-multi');
  before = promptWrites.length;
  await js("document.querySelector('.question-card .qc-submit').click()");
  const multi = await writesAfter(before);
  const want = ['1', '3', '\x1b[C', '3', 'teal', '\r', '1'];
  check(JSON.stringify(multi) === JSON.stringify(want), `Submit writes ${JSON.stringify(multi)} (want ${JSON.stringify(want)})`);
  fs.appendFileSync(file, resultLine('snap-ask-2'));
  check(await waitFor(async () => (await js("document.querySelector('.question-card').hidden")) || null, 8000), 'two-question card disappears on its tool_result');

  // Main refuses a question that isn't the pending one, even straight from the bridge.
  before = promptWrites.length;
  await js(`window.pastel.answerPrompt(${JSON.stringify(session.tabId)}, { kind: 'question', toolUseId: 'snap-ask-2', answers: [{ selected: [0] }] })`);
  await wait(800);
  check(promptWrites.length === before, 'an answer for a question no longer pending writes nothing');

  // Permission prompt: drawn on screen, the bar offers its numbered options, a click writes the digit.
  show(screenFile('permission', PERMISSION_SCREEN), true);
  const bar = await waitFor(() => js("(() => { const b = document.querySelector('.permission-bar'); return b.hidden ? null : { title: b.querySelector('.qc-chip').textContent, question: b.querySelector('.pb-question').textContent, details: b.querySelector('.pb-details')?.textContent, options: [...b.querySelectorAll('.pb-option')].map((o) => o.textContent) }; })()"), 8000);
  check(bar && bar.title === 'Bash command' && bar.options.length === 3 && bar.options[2] === '3. No', `permission bar matches the screen: ${JSON.stringify(bar)}`);
  await capturePair('permission-bar');
  before = promptWrites.length;
  await js("document.querySelectorAll('.permission-bar .pb-option')[2].click()");
  const no = await writesAfter(before);
  check(JSON.stringify(no) === JSON.stringify(['3']), `clicking No writes ${JSON.stringify(no)} (want ["3"])`);
  check(await js("[...document.querySelectorAll('.permission-bar .pb-option')].every((o) => o.disabled)"), 'bar buttons lock after one click');
  session.pty.write('\x03');
  await wait(300);
  session.pty.write('clear\r');
  check(await waitFor(async () => (await js("document.querySelector('.permission-bar').hidden")) || null, 8000), 'bar hides when the prompt leaves the screen');

  // Near miss (no cursor on any option): no bar, nothing to click.
  show(screenFile('near-miss', PERMISSION_SCREEN.map((row) => row.replace('❯', ' '))), true);
  await wait(1500);
  check(await js("document.querySelector('.permission-bar').hidden"), 'no bar for a screen that only nearly matches');
  session.pty.write('\x03');
  await wait(300);
  session.pty.write('clear\r');
  await wait(500);
}
