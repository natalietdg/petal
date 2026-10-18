// Distillation (PASTEL_SNAPSHOT_MODE=distillation): fixture loop replies for two rounds render as one collapsible section
// with Q/A pairs and each round's Open threads as cards (round 1 leaves two; round 2 settles one, carries one and adds a
// needs-you thread); a card asks through the reply box's paste path; the needs-you thread shows "Claude needs you" in the
// reader and on the Board, and the answer is pasted; .petal/distillation.jsonl and Activity keep the rounds; Suite health
// shows flaky and core from a fixture history, and Add core stage puts it first, still asking before its first run.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { FIXTURE_TASK, seedTestingProject, useAgentFixtures } from './snapshot-testing';
import { resizeOffscreen } from '../main/snapshot-window';
import { fixtureFile, pasteWrites, testingFixture } from '../main/snapshot-mode';
import { READING_CHOICES } from '../main/menu';
import * as store from '../main/testing-store';
import { listActivity } from '../main/activity-feed';
import type { PipelineRun, TestCase } from '../shared/testing';

const MIN_RATIO = 4.5;
const WIDTHS = [800, 1280, 1600];
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

export const ROUND_1 = [
  '**Round 1: five checkout scenarios, one real bug.**',
  '',
  'The coupon cap bug is filed with a failing regression test.',
  '',
  '## Distillation',
  '- Q: What changed this round? · A: Five checkout scenarios were added as tests under src/checkout.',
  '- Q: Why did the coupon test fail? · A: totals.ts subtracts the coupon after tax, so the total goes below zero.',
  '- Q: Is the retry failure flaky or real? · A: Flaky so far: it passed on the rerun with the same code.',
  '**Course:** fix bug · the coupon can take the total below zero',
  '',
  '## Open threads',
  '- Does the retry test fail on a slow network too? *Check: run src/api/client.test.ts with the 2s delay*',
  '- Is tax rounded per line in the API as well? *Check: read api/tax.ts*',
  '',
  '**Loop:** round 1/5 · fixing · 1 open',
].join('\n');

export const ROUND_2 = [
  '**Round 2: the coupon cap is fixed and verified.**',
  '',
  'One product question is yours before refunds get scenarios.',
  '',
  '## Distillation',
  '- Q: Does the retry test fail on a slow network too? · A: settled · it passed 5 of 5 runs with the 2s delay',
  '- Q: Is tax rounded per line in the API as well? · A: carried · api/tax.ts calls a helper outside the repo',
  '- Q: Does the fix cover the cause? · A: Yes, the cap lives in totals.ts, which every checkout path goes through.',
  '- Q: What would a user hit next? · A: A 100% coupon, which now makes the total exactly zero.',
  '**Course:** retest · the cap fix needs one more green run',
  '',
  '## Open threads',
  '- Is tax rounded per line in the API as well? *Check: read the helper in the tax package*',
  '- May a 100% coupon make an order free? *Check: needs you · the product rule for zero-total orders*',
  '',
  '**Loop:** round 2/5 · verifying · 0 open',
].join('\n');

const NEEDS_YOU = 'May a 100% coupon make an order free?';

// Petal's own runs of the fixture task's suite, for Suite health: the retry test flips within minutes, totals failed recently, theme always passes.
function seedHistory(project: string): void {
  const now = Date.now();
  const test = (file: string, name: string, status: TestCase['status'], durationMs = 12): TestCase => ({ file, name, status, durationMs });
  for (let i = 0; i < 12; i += 1) {
    const at = now - (12 - i) * 60 * 60 * 1000;
    const tests = [
      test('src/api/client.test.ts', 'client > retries a 503 twice', i === 9 ? 'failed' : 'passed'),
      test('src/cart/totals.test.ts', 'totals > rounds tax per line', i === 10 ? 'failed' : 'passed'),
      test('src/theme.test.ts', 'theme > renders', 'passed', 4),
      test('src/settings.test.ts', 'settings > renders', 'passed', 5),
      test('e2e/checkout.test.ts', 'checkout > pays with a saved card', 'passed', 4200 + i * 10),
    ];
    const failed = tests.filter((t) => t.status === 'failed').length;
    const counts = { passed: tests.length - failed, failed, skipped: 0 };
    const run: PipelineRun = {
      id: `distill-run-${i}`, by: 'you', trigger: 'click', startedAt: at, finishedAt: at + 9000, state: failed ? 'failed' : 'passed', totals: counts, taskId: FIXTURE_TASK,
      stages: [{ stageId: 'unit', name: 'Unit', command: 'npm test', status: failed ? 'failed' : 'passed', exitCode: failed ? 1 : 0, durationMs: 9000, counts, tests, output: '', runner: 'vitest' }],
    };
    store.putRun(project, run);
  }
  // The retry test passes again four minutes after it failed, on the same code.
  const at = now - 3 * 60 * 60 * 1000 + 4 * 60 * 1000;
  const tests = [test('src/api/client.test.ts', 'client > retries a 503 twice', 'passed')];
  store.putRun(project, { id: 'distill-run-retry', by: 'you', trigger: 'click', startedAt: at, finishedAt: at + 2000, state: 'passed', totals: { passed: 1, failed: 0, skipped: 0 }, taskId: FIXTURE_TASK,
    stages: [{ stageId: 'unit', name: 'Unit', command: 'npm test', status: 'passed', exitCode: 0, durationMs: 2000, counts: { passed: 1, failed: 0, skipped: 0 }, tests, output: '', runner: 'vitest' }] });
}

const CONTRAST = `
  const rgb = (s) => (s.match(/[\\d.]+/g) ?? []).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const backOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c; } return [255, 255, 255]; };
  const ratio = (el) => { const a = lum(rgb(getComputedStyle(el).color)), b = lum(backOf(el)); const [hi, lo] = a > b ? [a, b] : [b, a]; return Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100; };
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const worstOf = (nodes) => nodes.filter(visible).map((t) => [ratio(t), t.className || t.tagName, t.textContent.slice(0, 30)]).sort((a, b) => a[0] - b[0])[0] ?? [99];
`;

const PROBE = `(() => {
  ${CONTRAST}
  const view = document.getElementById('testing');
  if (!view || view.hidden) return null;
  const loop = view.querySelector('.tst-loop .tst-distill');
  const health = view.querySelector('.tst-health');
  const texts = [...view.querySelectorAll('.tst-distill-title, .tst-distill-count, .tst-distill-round-title, .tst-distill-reason, .tst-course, .tst-distill-ask span, .tst-distill-answer span, .tst-needs-you, .tst-distill-threads-title, .thread-question, .thread-check, .thread-ask, .tst-thread-word, .tst-thread-note, .tst-health span, .tst-health .tst-muted, .tst-health-command, .tst-health-add:not(:disabled), .tst-section-title')];
  const worst = worstOf(texts);
  const rounds = loop ? [...loop.querySelectorAll('.tst-distill-round')] : [];
  return {
    state: PastelTerm.testing.state(),
    loopOpen: loop?.open ?? null,
    summary: loop?.querySelector('.tst-distill-summary')?.textContent ?? '',
    rounds: rounds.map((r) => ({
      title: r.querySelector('.tst-distill-round-title')?.textContent, course: r.querySelector('.tst-course')?.textContent,
      qs: r.querySelectorAll('.tst-distill-q').length,
      threads: [...r.querySelectorAll('.tst-thread')].map((t) => [t.querySelector('.thread-question')?.textContent, t.querySelector('.tst-thread-word')?.textContent, t.classList.contains('is-needs-you')]),
    })),
    historyDistill: view.querySelectorAll('.tst-runs .tst-distill').length,
    flaky: [...(health?.querySelectorAll('[aria-label="Flaky"] .tst-health-name') ?? [])].map((n) => n.textContent),
    core: health?.querySelector('.tst-health-command')?.textContent ?? null,
    addCore: health?.querySelector('.tst-health-add')?.textContent ?? null,
    minRatio: worst[0], worst,
    overflowX: Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, view.scrollWidth - view.clientWidth),
    inWindow: [...view.querySelectorAll('.tst-distill, .tst-thread, .tst-health-row, .tst-health-command')].filter(visible).every((n) => { const b = n.getBoundingClientRect(); return b.left >= -1 && b.right <= window.innerWidth + 1; }),
  };
})()`;

const READER_CARD = `(() => {
  ${CONTRAST}
  const card = document.querySelector('#latest .distill-card');
  if (!card) return null;
  const b = card.getBoundingClientRect();
  return { question: card.querySelector('.distill-card-question')?.textContent, label: card.querySelector('.distill-card-label')?.textContent,
    worst: worstOf([...card.querySelectorAll('.distill-card-label, .distill-card-question, .distill-card-input, .distill-card-send, .distill-card-reason, li')]),
    inWindow: b.left >= -1 && b.right <= window.innerWidth + 1, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
})()`;

type Probe = { state: { loop: string; distillation: number; stages: string[] }; rounds: { title: string; course: string; qs: number; threads: [string, string, boolean][] }[]; [k: string]: unknown };

export async function distillationCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} distillation: ${what}`);
  const probe = (): Promise<Probe | null> => js(PROBE);
  const settle = async (want: (p: Probe) => boolean, ms = 8000) => waitFor(async () => { const p = await probe(); return p && want(p) ? p : null; }, ms);
  const transcript = fixtureFile();
  const line = (fields: Record<string, unknown>) => `${JSON.stringify({ isSidechain: false, timestamp: new Date().toISOString(), ...fields })}\n`;
  const append = (id: string, text: string) => transcript && fs.appendFileSync(transcript, line({ type: 'user', uuid: `distill-u-${id}`, message: { role: 'user', content: `loop prompt ${id}` } })
    + line({ type: 'assistant', uuid: `distill-a-${id}`, message: { role: 'assistant', content: [{ type: 'text', text }] } }));
  const setReading = async (look: string) => {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
  };

  const { project, claudeDir } = seedTestingProject(outDir);
  testingFixture.project = project;
  testingFixture.claudeDir = claudeDir;
  testingFixture.changed = ['src/settings.ts'];
  seedHistory(project);
  testingFixture.loopStarts.length = 0;
  useAgentFixtures(outDir);
  await js('PastelTerm.welcome.close()');
  await js('PastelTerm.overlays.hideCurrent()');
  const [startWidth, startHeight] = win.getContentSize();
  try {
    resizeOffscreen(win, 1280, 900);
    check(await waitFor(async () => (await js("PastelTerm.tabs.get(PastelTerm.tabs.ids()[0])?.update?.state")) === 'live' || null, 15000), 'the fixture tab follows its Claude session');
    await js("document.getElementById('testing-button').click()");
    check(await settle((p) => p.state.stages.length === 3), 'Testing opens on the fixture project');

    // Start: the testing agent's brief asks for distillation with Open threads.
    await js(`(() => { const f = document.querySelector('#testing .tst-loop-focus'); f.value = 'checkout flow'; })()`);
    await js("document.querySelector('#testing .tst-loop-go').click()");
    const brief = (await waitFor(() => testingFixture.loopStarts.find((l) => l.brief?.includes('Run a test loop')) ?? null, 5000))?.brief ?? '';
    check(brief.includes('## Distillation') && brief.includes('## Open threads') && brief.includes('revisiting every open thread from your previous round') && brief.includes('**Course:**') && !/[—–]/.test(brief),
      'the brief asks for Distillation, Open threads, revisits and a Course line, with no long dashes');

    // Two rounds of fixture replies, plus one Claude unit run so the session has a History row.
    append('r1', ROUND_1);
    if (transcript) {
      fs.appendFileSync(transcript, line({ type: 'assistant', uuid: 'distill-a-bash', cwd: project, message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_distill_1', name: 'Bash', input: { command: 'npm test' } }] } })
        + line({ type: 'user', uuid: 'distill-u-bash', cwd: project, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_distill_1', is_error: false, content: ' Test Files  4 passed (4)\n      Tests  16 passed (16)\n' }] } }));
    }
    append('r2', ROUND_2);
    const two = await settle((p) => p.rounds.length === 2 && p.historyDistill === 1, 10000);
    check(two && two.loopOpen === false, `the Distillation section starts collapsed: ${JSON.stringify(two?.summary)}`);
    check(two && /2 rounds · last course: retest/.test(String(two.summary)) && /needs you/.test(String(two.summary)), `the summary names rounds, course and who it needs: ${JSON.stringify(two?.summary)}`);
    await js("document.querySelector('#testing .tst-loop .tst-distill-summary').click()");
    const opened = await settle((p) => p.loopOpen === true);
    const rounds = opened?.rounds ?? [];
    check(rounds[0]?.title === 'Round 1 of 5' && rounds[0]?.course === 'Fix bug' && rounds[0]?.qs === 3 && rounds[1]?.title === 'Round 2 of 5' && rounds[1]?.course === 'Retest' && rounds[1]?.qs === 4,
      `each round shows its Q/A pairs and course: ${JSON.stringify(rounds.map((r) => [r.title, r.course, r.qs]))}`);
    const threads = rounds.map((r) => r.threads);
    check(JSON.stringify(threads) === JSON.stringify([
      [['Does the retry test fail on a slow network too?', 'settled in round 2', false], ['Is tax rounded per line in the API as well?', 'carried to round 2', false]],
      [['Is tax rounded per line in the API as well?', 'open', false], [NEEDS_YOU, 'open', true]],
    ]), `round 1 leaves two threads, round 2 settles one and carries one; the needs-you thread is marked: ${JSON.stringify(threads)}`);
    check(opened?.historyDistill === 1, 'the Claude session in History has its own Distillation section');
    await wait(300);
    await capture('distillation');

    // Stored per loop, and each course is in Activity.
    const jsonl = path.join(project, '.petal', 'distillation.jsonl');
    const stored = fs.existsSync(jsonl) ? fs.readFileSync(jsonl, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { course: string; threads: unknown[] }) : [];
    check(stored.length === 2 && stored[0].course === 'fix-bug' && stored[1].threads.length === 2 && fs.readFileSync(path.join(project, '.petal', '.gitignore'), 'utf8') === '*\n', `.petal/distillation.jsonl keeps both rounds, threads included: ${stored.length}`);
    const activity = listActivity().filter((e) => e.id.startsWith('distill:'));
    check(activity.length === 2 && activity.every((e) => e.kind === 'test') && activity.some((e) => /round 2 in acme: retest/.test(e.text)) && activity.some((e) => e.detail?.includes(`Needs you: ${NEEDS_YOU}`)),
      `Activity records each course: ${JSON.stringify(activity.map((e) => e.text))}`);

    // Suite health from the fixture history.
    const health = await settle((p) => (p.flaky as string[]).length > 0);
    check(JSON.stringify(health?.flaky) === JSON.stringify(['client.test.ts › retries a 503 twice']), `Suite health names the flaky retry test: ${JSON.stringify(health?.flaky)}`);
    // In the full run earlier steps' Claude runs share the fixture log, so their recent failures may join the core too.
    const coreFiles = String(health?.core ?? '').replace(/^npx vitest run /, '').split(' ');
    const mustHave = ['src/api/client.test.ts', 'src/cart/totals.test.ts', 'src/settings.test.ts'];
    check(String(health?.core).startsWith('npx vitest run ') && mustHave.every((f) => coreFiles.includes(f)) && coreFiles.every((f) => f.endsWith('.test.ts') || f.endsWith('.test.js')),
      `core: recent failures plus the changed settings file: ${JSON.stringify(health?.core)}`);
    await js("document.querySelector('#testing .tst-healthbox').scrollIntoView({ block: 'start' })");
    await wait(300);
    await capture('suite-health');
    await js("document.querySelector('#testing .tst-health-add').click()");
    const added = await settle((p) => p.state.stages[0] === 'Core' && p.addCore === 'Core stage is first');
    check(added && added.state.stages.length === 4, `Add core stage puts Core first: ${JSON.stringify(added?.state.stages)}`);
    await js("document.querySelector('#testing .tst-tools-bar .tst-primary').click()");
    const confirm = await waitFor(async () => js('PastelTerm.testing.state().confirming'), 4000);
    check(confirm?.[0]?.startsWith('npx vitest run src/api/client.test.ts'), `running it still asks first, core command first: ${JSON.stringify(confirm?.[0])}`);
    await js("[...document.querySelectorAll('#testing .tst-confirm .tst-button')].find((b) => b.textContent === 'Cancel')?.click()");

    // Contrast across themes and reading styles, then widths.
    await js("document.querySelector('#testing .tst-loop').scrollIntoView({ block: 'start' })");
    for (const theme of ['paleSky', 'blush', 'nightPastel']) {
      applyTheme(theme, { persist: false });
      for (const [look] of READING_CHOICES) {
        await setReading(look);
        await wait(150);
        const p = await probe();
        check(p && (p.minRatio as number) >= MIN_RATIO && (p.overflowX as number) <= 0, `Testing ${theme} ${look}: ${p?.minRatio}:1 ${JSON.stringify(p?.worst)}`);
      }
    }
    applyTheme('paleSky', { persist: false });
    await setReading('newspaper');
    for (const width of WIDTHS) {
      resizeOffscreen(win, width, 900);
      await wait(400);
      const p = await probe();
      check(p && (p.overflowX as number) <= 0 && p.inWindow, `Testing ${width}px: overflow ${p?.overflowX}, in window ${p?.inWindow}`);
    }
    resizeOffscreen(win, 1280, 900);

    // The needs-you thread: "Claude needs you" in the reader and on the Board card.
    await js('PastelTerm.overlays.hideCurrent()');
    await js("PastelTerm.reader.setView('replies')");
    const reader = await waitFor(async () => js(READER_CARD), 6000);
    check(reader?.label === 'Claude needs you:' && reader.question === NEEDS_YOU, `the reader shows the card under the newest reply: ${JSON.stringify(reader?.question)}`);
    for (const theme of ['paleSky', 'blush', 'nightPastel']) {
      applyTheme(theme, { persist: false });
      for (const [look] of READING_CHOICES) {
        await setReading(look);
        await wait(150);
        const r = await js(READER_CARD);
        check(r && r.worst[0] >= MIN_RATIO && r.overflowX <= 0, `reader card ${theme} ${look}: ${r?.worst[0]}:1 ${JSON.stringify(r?.worst)}`);
      }
    }
    applyTheme('paleSky', { persist: false });
    await setReading('newspaper');
    for (const width of WIDTHS) {
      resizeOffscreen(win, width, 900);
      await wait(400);
      const r = await js(READER_CARD);
      check(r && r.inWindow && r.overflowX <= 0, `reader card ${width}px in window`);
    }
    resizeOffscreen(win, 1280, 900);
    await js("document.querySelector('#latest .distill-card').scrollIntoView({ block: 'center' })");
    await js(`(() => { const i = document.querySelector('#latest .distill-card-input'); i.value = 'No, keep a 1 cent floor.'; i.dispatchEvent(new Event('input')); })()`);
    await wait(200);
    await capture('needs-you');

    await js("window.dispatchEvent(new Event('petal:open-board'))");
    const board = await waitFor(async () => js(`(() => {
      ${CONTRAST}
      const card = document.querySelector('#board .board-item .distill-card');
      return card ? { question: card.querySelector('.distill-card-question')?.textContent, worst: worstOf([...card.querySelectorAll('.distill-card-label, .distill-card-question, .distill-card-input, .distill-card-send')]) } : null;
    })()`), 6000);
    check(board?.question === NEEDS_YOU && board.worst[0] >= MIN_RATIO, `the Board card says Claude needs you: ${JSON.stringify(board)}`);
    await capture('needs-you-board');
    await js('PastelTerm.overlays.hideCurrent()');

    // Her answer goes through the reply box's paste path; the card goes.
    const beforeAnswer = pasteWrites.length;
    await js("document.querySelector('#latest .distill-card-send').click()");
    const answer = await waitFor(() => pasteWrites.slice(beforeAnswer).find((w) => w.data.includes('No, keep a 1 cent floor.')) ?? null, 4000);
    check(answer?.data === `${PASTE_START}On your distillation question "${NEEDS_YOU}": No, keep a 1 cent floor.\nCarry on with the test loop from here.${PASTE_END}\r`, `the answer is pasted with its question: ${JSON.stringify(answer?.data)}`);
    check(await waitFor(async () => (await js("!document.querySelector('#latest .distill-card')")) || null, 4000), 'the card goes once she answers');
    // Back in Testing: a thread card asks its question and check through the reply box's paste path.
    await js("document.getElementById('testing-button').click()");
    await settle((p) => p.loopOpen === true);
    const beforeAsk = pasteWrites.length;
    await waitFor(() => js("[...document.querySelectorAll('#testing .tst-loop .tst-thread')].some((t) => t.querySelector('.tst-thread-word')?.textContent === 'open') || null"), 6000);
    await js(`[...document.querySelectorAll('#testing .tst-loop .tst-thread')].find((t) => t.querySelector('.tst-thread-word')?.textContent === 'open')?.querySelector('.thread-card').click()`);
    const asked = await waitFor(() => pasteWrites.slice(beforeAsk).find((w) => w.data.includes('Is tax rounded per line')) ?? null, 4000);
    check(asked?.data === `${PASTE_START}Is tax rounded per line in the API as well? Check: read the helper in the tax package${PASTE_END}\r`, `a thread card sends "Question? Check: ..." to the session: ${JSON.stringify(asked?.data)}`);

  } finally {
    testingFixture.agentIds.length = 0;
    testingFixture.project = null;
    testingFixture.claudeDir = null;
    testingFixture.changed = null;
    await js('PastelTerm.overlays.hideCurrent()');
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
