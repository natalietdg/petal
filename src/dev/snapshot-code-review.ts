// Code review: a reply that changed code gets "Reply · Code review (N)" in History and in the reader; the cards show
// a diff, the token estimate comes before any call, and Explain fills recorded and inferred answers with a Retry for a gap.
// The reviewer is the snapshot stub (codeReviewFixture), never a real claude. The Board's roll-up opens and goes Back.
// Everything it adds is taken out again: the History fixture, its cached answers, the stub, and the reader tab choice.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { Kit } from './snapshot';
import { codeReviewFixture, historyFixture } from '../main/snapshot-mode';
import { assertFixtureOutsideClaude } from './snapshot-views';
import { keepActivity } from './snapshot-activity';
import { listActivity } from '../main/activity-feed';

const SESSION = 'c0dec0de-0000-4000-8000-00000000c0de';
const ORIGINAL = "import { round } from './money';\n\nexport function total(items: Item[]): number {\n  return items.reduce((sum, i) => sum + i.price, 0);\n}\n";
const OLD = 'return items.reduce((sum, i) => sum + i.price, 0);';
const NEW = 'return round(items.reduce((sum, i) => sum + i.price * i.qty, 0));';
const REASON = 'Quantities were ignored, so multiply by qty and round once at the end.';

// One turn as Claude Code logs it: her prompt, Claude's text, an Edit and its result with the original file.
function turnLines(prefix: string, cwd: string, prompt: string): unknown[] {
  const at = new Date().toISOString();
  const file = path.join(cwd, 'src', 'cart.ts');
  const base = { isSidechain: false, cwd, timestamp: at };
  return [
    { ...base, type: 'user', uuid: `${prefix}-u`, message: { role: 'user', content: prompt } },
    { ...base, type: 'assistant', uuid: `${prefix}-a`, message: { role: 'assistant', content: [{ type: 'text', text: REASON }] } },
    { ...base, type: 'assistant', uuid: `${prefix}-e`, message: { role: 'assistant', content: [{ type: 'tool_use', id: `${prefix}-t1`, name: 'Edit', input: { file_path: file, old_string: OLD, new_string: NEW } }] } },
    { ...base, type: 'user', uuid: `${prefix}-r`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `${prefix}-t1`, content: 'ok' }] }, toolUseResult: { filePath: file, originalFile: ORIGINAL } },
    { ...base, type: 'assistant', uuid: `${prefix}-w`, message: { role: 'assistant', content: [{ type: 'tool_use', id: `${prefix}-t2`, name: 'Write', input: { file_path: path.join(cwd, 'NOTES.md'), content: '# Cart\n' } }] } },
    { ...base, type: 'user', uuid: `${prefix}-r2`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `${prefix}-t2`, content: 'ok' }] }, toolUseResult: { type: 'create', filePath: path.join(cwd, 'NOTES.md'), originalFile: null } },
    { ...base, type: 'assistant', uuid: `${prefix}-d`, message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed: totals count quantity.' }] } },
  ];
}

const jsonl = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';

// F1 recorded with a real quote; F2 left out, so its card shows No answer and Retry.
const STUB_REPLY = JSON.stringify({
  type: 'result', is_error: false, usage: { input_tokens: 10, output_tokens: 90 },
  result: JSON.stringify({ answers: [{ id: 'F1', shape: 'One reduce over the items, rounded once.', driver: 'The total ignored quantity.', alternatives: 'Rounding each line would drift by cents.', risk: 'none seen', basis: 'recorded', quote: 'multiply by qty and round once at the end' }] }),
});

const PROBE = (root: string) => `(() => {
  const root = document.querySelector(${JSON.stringify(root)});
  if (!root) return null;
  const tabs = root.querySelector('.cr-tabs');
  return {
    tabs: tabs ? [...tabs.querySelectorAll('.cr-tab')].map((b) => b.textContent) : [],
    selected: tabs?.querySelector('[aria-selected="true"]')?.textContent ?? null,
    cards: [...root.querySelectorAll('.cr-card')].map((c) => ({ name: c.querySelector('.cr-name')?.textContent ?? '', diff: Boolean(c.querySelector('.cr-diff .cr-add')), why: c.querySelector('.cr-basis')?.textContent ?? '', missing: Boolean(c.querySelector('.cr-missing .cr-retry')) })),
    explain: root.querySelector('.cr-explain-button')?.textContent ?? '',
    replyHidden: [...root.querySelectorAll('.prose')].every((p) => p.closest('[hidden]')),
  };
})()`;

export async function codeReviewCheck(kit: Kit, fixtureFile: string): Promise<void> {
  const { js, waitFor, log, capture, outDir, applyTheme } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} code review: ${what}`);
  // any: the probe's shape is built in PROBE.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const probe = (root: string, want: (p: any) => boolean, ms = 8000) => waitFor(async () => { const p = await js(PROBE(root)); return p && want(p) ? p : null; }, ms);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  const dir = path.join(outDir, 'code-review-fixture');
  const file = path.join(dir, `${SESSION}.jsonl`);
  assertFixtureOutsideClaude(file);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, jsonl(turnLines('h', dir, 'the cart total ignores quantity')));
  historyFixture.records = [{ sessionId: SESSION, file, cwd: dir, title: 'Code review fixture', firstPrompt: 'the cart total ignores quantity', lastAt: Date.now() + 60_000, messages: 4, messagesExact: true }];
  const prompts: string[] = [];
  codeReviewFixture.review = async (prompt) => { prompts.push(prompt); return STUB_REPLY; };
  const fixtureBefore = fs.existsSync(fixtureFile) ? fs.readFileSync(fixtureFile, 'utf8') : null;
  const H = '#history-preview';
  const restoreActivity = keepActivity();
  const activityBefore = new Set(listActivity().map((e) => e.id));
  let appended = false;
  try {
    // History: the turn that changed code has the switch; Reply is shown first.
    await js(`PastelTerm.history.open().then(() => { PastelTerm.history.select(${JSON.stringify(SESSION)}); return PastelTerm.history.setPreviewMode('replies'); })`);
    const listed = await probe(H, (p) => p.tabs.length === 2);
    check(listed?.tabs[1] === 'Code review (2)' && listed.selected === 'Reply', `History shows Reply · Code review (2): ${JSON.stringify(listed?.tabs)}`);

    await click(`${H} .cr-tab:last-of-type`);
    const cards = await probe(H, (p) => p.cards.length === 2 && p.explain);
    check(cards?.cards.map((c: { name: string }) => c.name).join() === 'total,Hunk level' && cards.cards[0].diff, `cards: total (with a diff) and the Markdown hunk: ${JSON.stringify(cards?.cards)}`);
    check(/^Explain every function · ~[\d,]+ tokens$/.test(cards?.explain ?? '') && prompts.length === 0, `the estimate shows before any call: ${JSON.stringify(cards?.explain)}`);
    check(cards?.replyHidden, 'the reply text is hidden while Code review is shown');
    await capture('code-review-history-before');

    await click(`${H} .cr-explain-button`);
    const answered = await probe(H, (p) => p.cards.some((c: { why: string }) => c.why));
    check(answered?.cards[0].why.startsWith('Recorded') && answered.cards[1].missing, `F1 recorded, F2 No answer with Retry: ${JSON.stringify(answered?.cards)}`);
    check(prompts.length === 1 && prompts[0].includes('[R1] (said)') && prompts[0].includes(`+  ${NEW}`), 'one stubbed call, with the reasoning and the diff');
    await capture('code-review-history-light');
    applyTheme('nightPastel', { persist: false });
    await capture('code-review-history-dark');
    applyTheme('paleSky', { persist: false });
    await click(`${H} .cr-tab:first-of-type`);
    await js('PastelTerm.history.close()');

    // Reader: the live tab's newest reply changed code, so it has the same switch.
    if (fixtureBefore !== null) {
      fs.appendFileSync(fixtureFile, jsonl(turnLines('r', dir, 'fix the cart total in the reader too')));
      appended = true;
      const reader = await probe('#latest', (p) => p.tabs.length === 2, 10000);
      check(reader?.tabs[1] === 'Code review (2)', `the reader's newest reply has Reply · Code review (2): ${JSON.stringify(reader?.tabs)}`);
      await click('#latest .cr-tab:last-of-type');
      const readerCards = await probe('#latest', (p) => p.cards.length === 2);
      check(readerCards, `the reader shows the cards: ${JSON.stringify(readerCards?.cards)}`);
      await capture('code-review-reader');
      await click('#latest .cr-tab:first-of-type');
      check(await probe('#latest', (p) => p.selected === 'Reply' && !p.replyHidden), 'Reply is back on');
    }

    // Board: the roll-up opens in place of the cards and Back returns (an unknown task says why in plain words).
    await js("PastelTerm.sessionsBoard.open(); PastelTerm.sessionsBoard.openCodeReview({ sessionId: 'snapshot-fixture', taskId: 't-none', title: 'Fixture task' })");
    const rollUp = await waitFor(() => js("document.querySelector('.cr-task .cr-outcome')?.textContent ?? null"), 6000);
    check(rollUp?.startsWith('Couldn’t read this task’s changes:') && await js("document.querySelector('.board-grid').hidden"), `the roll-up replaces the cards and says why it's empty: ${JSON.stringify(rollUp)}`);
    await js("document.querySelector('.cr-task .cr-back').click()");
    check(await js("!document.querySelector('.board-grid').hidden && document.querySelector('.cr-task').hidden"), 'Back shows the cards again');
    await js('PastelTerm.sessionsBoard.close()');
  } finally {
    codeReviewFixture.review = null;
    historyFixture.records = [];
    // The appended turn's edits land in Activity on coord's next tick; wait for that before putting the feed back.
    if (appended) await waitFor(() => listActivity().some((e) => e.kind === 'edits' && !activityBefore.has(e.id)) || null, 8000);
    if (fixtureBefore !== null) fs.writeFileSync(fixtureFile, fixtureBefore);
    restoreActivity();
    fs.rmSync(path.join(app.getPath('userData'), 'code-review', `${SESSION}.json`), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
    await js('PastelTerm.overlays.hideCurrent()');
  }
}
