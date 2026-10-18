// Test loop: Start pastes the brief into the fixture's Claude tab (never a real claude) and makes .petal/ kept out of git;
// fixture Loop lines drive the round progress here and in the reader's strip; a criteria fixture renders grouped;
// Start stays off while the loop runs; Stop records one Esc, then the stop message only once the tab is idle.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { setFixtureStatus } from './snapshot';
import { FIXTURE_TASK, seedTestingProject } from './snapshot-testing';
import { resizeOffscreen } from '../main/snapshot-window';
import { fixtureFile, pasteWrites, promptWrites, testingFixture } from '../main/snapshot-mode';
import { READING_CHOICES } from '../main/menu';
import { STOP_MESSAGE } from '../shared/test-loop';
import type { ReaderFeed } from '../main/reader-feed';

const MIN_RATIO = 4.5;
const WIDTHS = [800, 1280, 1600];
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

// Every item is filed under the fixture task; the stray line stays unfiled.
export const CRITERIA_FIXTURE = [
  '# Test criteria',
  '',
  '## Scenarios',
  `- [pass] guest checkout with a saved card · test: src/checkout/guest.test.ts::pays with a saved card · round 1 · task: ${FIXTURE_TASK}`,
  `- [pass] coupon applies before tax · test: src/checkout/coupon.test.ts::applies before tax · round 1 · task: ${FIXTURE_TASK}`,
  `- [fail] coupon larger than the cart total · test: src/checkout/coupon.test.ts::caps at the total · round 2 · task: ${FIXTURE_TASK}`,
  `- [flaky] payment retry after a 503 · test: src/api/client.test.ts::retries a 503 twice · round 1 · task: ${FIXTURE_TASK}`,
  `- [pass] checkout flow on a phone · test: .maestro/checkout.yaml · round 2 · task: ${FIXTURE_TASK}`,
  '',
  '## Bugs',
  `- [fixed] tax rounds per order, not per line · test: src/cart/totals.test.ts::rounds tax per line, half up · round 1 · task: ${FIXTURE_TASK}`,
  `- [fail] coupon can take the total below zero · test: src/checkout/coupon.test.ts::caps at the total · round 2 · task: ${FIXTURE_TASK}`,
  `- [fail] Place order stays enabled with an empty cart · round 2 · task: ${FIXTURE_TASK}`,
  '- a stray note Claude left',
  '',
].join('\n');

export const loopReply = (round: number, total: number, phase: string, open: number, lead: string): string =>
  `**${lead}**\n\nWorking through the checkout scenarios.\n\n**Doing:** round ${round} of the test loop.\n**Next:** the next step of the round.\n**Loop:** round ${round}/${total} · ${phase} · ${open} open`;

const PROBE = `(() => {
  const view = document.getElementById('testing');
  const panel = view?.querySelector('.tst-loop');
  if (!view || view.hidden || !panel) return null;
  const rgb = (s) => (s.match(/[\\d.]+/g) ?? []).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const backOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c; } return [255, 255, 255]; };
  const ratio = (el) => { const a = lum(rgb(getComputedStyle(el).color)), b = lum(backOf(el)); const [hi, lo] = a > b ? [a, b] : [b, a]; return Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100; };
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const texts = [...panel.querySelectorAll('.tst-section-title, .tst-loop-state, .tst-button:not(:disabled), .tst-input, .tst-loop-rounds span, .tst-loop-hint, .tst-loop-note, .tst-loop-facts strong, .tst-loop-facts span, .tst-loop-step, .tst-loop-live-name, .tst-loop-live-word, .tst-sub span, .tst-crit-name, .tst-crit-tag, .tst-crit-meta, .tst-muted')].filter(visible);
  const worst = texts.map((t) => [ratio(t), t.className || t.tagName, t.textContent.slice(0, 30)]).sort((a, b) => a[0] - b[0])[0] ?? [99];
  const bar = panel.querySelector('.tst-loop-bar [role="progressbar"]');
  const box = panel.getBoundingClientRect();
  return {
    state: PastelTerm.testing.state(),
    pill: panel.querySelector('.tst-loop-state')?.hidden ? null : panel.querySelector('.tst-loop-state')?.textContent,
    formHidden: panel.querySelector('.tst-loop-start').hidden,
    startDisabled: panel.querySelector('.tst-loop-go').disabled,
    stopShown: !panel.querySelector('.tst-stop').hidden,
    hint: panel.querySelector('.tst-loop-hint').hidden ? '' : panel.querySelector('.tst-loop-hint').textContent,
    facts: panel.querySelector('.tst-loop-facts')?.textContent ?? '',
    bar: bar ? { now: bar.getAttribute('aria-valuenow'), max: bar.getAttribute('aria-valuemax'), segs: bar.querySelectorAll('.station-seg').length, done: bar.querySelectorAll('.station-seg.done').length } : null,
    step: panel.querySelector('.tst-loop-step.is-current')?.textContent ?? null,
    live: [...panel.querySelectorAll('.tst-loop-live-item')].map((i) => [i.querySelector('.tst-loop-live-name').textContent, [...i.classList].find((c) => c.startsWith('is-'))?.slice(3)]),
    columns: [...panel.querySelectorAll('.tst-crit-col')].map((c) => [c.getAttribute('aria-label'), c.querySelectorAll('.tst-crit').length, c.querySelector('.tst-crit-count')?.textContent]),
    tags: [...panel.querySelectorAll('.tst-crit-tag')].map((t) => t.textContent),
    regressions: [...panel.querySelectorAll('.tst-crit')].filter((c) => c.querySelector('.tst-crit-tag.is-regression')).map((c) => c.querySelector('.tst-crit-name').textContent),
    notes: panel.querySelector('.tst-crit-notes')?.textContent ?? '',
    aboveStrip: !!view.querySelector('.tst-strip') && box.bottom <= view.querySelector('.tst-strip').getBoundingClientRect().top + 1,
    minRatio: worst[0],
    worst,
    overflowX: Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, view.scrollWidth - view.clientWidth, panel.scrollWidth - panel.clientWidth),
    inWindow: [...panel.querySelectorAll('.tst-loop-top, .tst-loop-start, .tst-crit, .tst-loop-progress')].filter(visible).every((n) => { const b = n.getBoundingClientRect(); return b.left >= -1 && b.right <= window.innerWidth + 1; }),
  };
})()`;

type Probe = { state: { loop: string; loopProgress: { round: number; total: number; phase: string; open: number | null } | null; project: string | null; stages: string[] }; [k: string]: unknown };

export async function testLoopCheck(kit: Kit, win: BrowserWindow, feed: ReaderFeed): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} test loop: ${what}`);
  const probe = (): Promise<Probe | null> => js(PROBE);
  const settle = async (want: (p: Probe) => boolean = () => true, ms = 8000) => waitFor(async () => { const p = await probe(); return p && want(p) ? p : null; }, ms);
  const transcript = fixtureFile();
  const line = (fields: Record<string, unknown>) => `${JSON.stringify({ isSidechain: false, timestamp: new Date().toISOString(), ...fields })}\n`;
  const append = (id: string, text: string) => transcript && fs.appendFileSync(transcript, line({ type: 'user', uuid: `loop-u-${id}`, message: { role: 'user', content: `loop prompt ${id}` } })
    + line({ type: 'assistant', uuid: `loop-a-${id}`, message: { role: 'assistant', content: [{ type: 'text', text }] } }));
  const setReading = async (look: string) => {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
  };

  const { project, claudeDir } = seedTestingProject(outDir);
  testingFixture.project = project;
  testingFixture.claudeDir = claudeDir;
  testingFixture.loopStarts.length = 0;
  await js('PastelTerm.welcome.close()');
  await js('PastelTerm.overlays.hideCurrent()');
  const [startWidth, startHeight] = win.getContentSize();
  try {
    resizeOffscreen(win, 1280, 900);
    check(await waitFor(async () => (await js("PastelTerm.tabs.get(PastelTerm.tabs.ids()[0])?.update?.state")) === 'live' || null, 15000), 'the fixture tab follows its Claude session');
    await js("document.getElementById('testing-button').click()");
    const idle = await settle((p) => p.state.project === 'acme' && p.state.loop === 'idle' && p.state.stages.length === 3);
    check(idle && !idle.formHidden && !idle.startDisabled && !idle.stopShown && idle.aboveStrip, `the Loop panel sits above the pipeline, Start ready: ${JSON.stringify(idle && { form: !idle.formHidden, start: !idle.startDisabled, above: idle.aboveStrip })}`);
    check(idle && /session/.test(String(idle.hint)) && /never commits/.test(String(idle.hint)), `the hint says the brief goes to this project's Claude: ${JSON.stringify(idle?.hint)}`);
    await capture('test-loop-start');

    // Start: the brief goes through the reply box's paste path into the fixture's Claude tab.
    const pastesBefore = pasteWrites.length;
    await js(`(() => { const f = document.querySelector('#testing .tst-loop-focus'); f.value = 'checkout flow'; f.dispatchEvent(new Event('input')); const r = document.querySelector('#testing .tst-loop-rounds-input'); r.value = '5'; })()`);
    await js("document.querySelector('#testing .tst-loop-go').click()");
    const pasted = await waitFor(() => pasteWrites.slice(pastesBefore).find((w) => w.data.includes('Run a test loop')) ?? null, 5000);
    const brief = pasted?.data ?? '';
    check(brief.startsWith(PASTE_START) && brief.endsWith(`${PASTE_END}\r`), 'the brief is one bracketed paste, submitted once');
    check(brief.includes('Focus: checkout flow.') && brief.includes('up to 5 rounds') && brief.includes('1. Typecheck: `npm run typecheck`\n2. Unit: `npm test`\n3. Mobile flows: `maestro test .maestro`'),
      `the brief carries the focus, rounds and exact stage commands: ${JSON.stringify(brief.slice(0, 200))}`);
    check(brief.includes('Never commit, push, or change git history.') && brief.includes('Never weaken, skip or delete a test') && brief.includes('plus Maestro flows') && !brief.includes('\u2014'), 'the brief has the no-commit and no-weakening rules, Maestro, and no em dash');
    check(testingFixture.loopStarts.length === 0, 'a live session gets the paste; no new tab is opened');
    const ignore = path.join(project, '.petal', '.gitignore');
    check(fs.existsSync(ignore) && fs.readFileSync(ignore, 'utf8') === '*\n' && fs.existsSync(path.join(project, '.petal', 'test-criteria.md')), 'Start makes .petal/ with a self-ignoring .gitignore and the criteria skeleton');
    const starting = await settle((p) => p.state.loop === 'starting');
    check(starting && starting.formHidden && starting.startDisabled && starting.stopShown, `while starting, Start is off and Stop shows: ${JSON.stringify(starting?.state.loop)}`);
    await js("document.querySelector('#testing .tst-loop-start').requestSubmit()");
    await wait(600);
    check(!pasteWrites.slice(pastesBefore + 1).some((w) => w.data.includes('Run a test loop')), 'a second Start during the loop sends nothing');

    // Loop lines from Claude drive the rounds.
    append('r1s', loopReply(1, 5, 'scenarios', 0, 'Five checkout scenarios written as tests.'));
    check(await settle((p) => /Writing scenarios/.test(String(p.facts))), 'round 1 scenarios shows');
    append('r1t', loopReply(1, 5, 'testing', 0, 'Ran the pipeline: Unit fails in three places.'));
    check(await settle((p) => /Round 1 of 5Testing/.test(String(p.facts))), 'round 1 testing shows');
    append('r2f', loopReply(2, 5, 'fixing', 3, 'Three real bugs, one flaky retry test.'));
    const running = await settle((p) => p.state.loop === 'running' && /Round 2 of 5/.test(String(p.facts)));
    check(running && /Round 2 of 5/.test(String(running.facts)) && /Fixing/.test(String(running.facts)) && /3 open bugs/.test(String(running.facts)), `round 2/5 fixing, 3 open: ${JSON.stringify(running?.facts)}`);
    const bar = running?.bar as { now: string; max: string; segs: number; done: number } | null;
    check(bar && bar.now === '2' && bar.max === '5' && bar.segs === 5 && bar.done === 1 && running?.step === 'Fixing', `five round segments, one done, Fixing current: ${JSON.stringify({ bar, step: running?.step })}`);
    check(running && running.startDisabled && running.formHidden, 'Start stays off while the loop runs');

    // The criteria file, grouped, with the bug that became a regression test marked.
    fs.writeFileSync(path.join(project, '.petal', 'test-criteria.md'), CRITERIA_FIXTURE);
    // Claude's own unit run lands as the live pipeline result.
    if (transcript) {
      const at = new Date().toISOString();
      fs.appendFileSync(transcript, line({ type: 'assistant', uuid: 'loop-a-bash', timestamp: at, cwd: project, message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_loop_1', name: 'Bash', input: { command: 'npm test', description: 'Run the unit tests' } }] } })
        + line({ type: 'user', uuid: 'loop-u-bash', timestamp: at, cwd: project, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_loop_1', is_error: true, content: 'Exit code 1\n Test Files  1 failed | 3 passed (4)\n      Tests  2 failed | 14 passed (16)\n' }] } }));
    }
    const grouped = await settle((p) => (p.columns as unknown[]).length === 2 && (p.live as string[][]).some(([name, status]) => name === 'Unit' && status === 'failed'));
    const columns = (grouped?.columns ?? []) as [string, number, string][];
    check(columns[0]?.[0] === 'Scenarios' && columns[0][1] === 5 && columns[1]?.[0] === 'Bugs' && columns[1][1] === 3, `criteria grouped Scenarios / Bugs: ${JSON.stringify(columns)}`);
    check(JSON.stringify(grouped?.regressions) === JSON.stringify(['tax rounds per order, not per line', 'coupon can take the total below zero']), `bugs with a test are marked regression: ${JSON.stringify(grouped?.regressions)}`);
    check(['pass', 'fail', 'flaky', 'fixed'].every((t) => (grouped?.tags as string[] ?? []).includes(t)) && /1 line not in the item format/.test(String(grouped?.notes)), `every status shows and the stray line is counted: ${JSON.stringify(grouped?.notes)}`);
    check(JSON.stringify(grouped?.live) === JSON.stringify([['Typecheck', 'waiting'], ['Unit', 'failed'], ['Mobile flows', 'waiting']]), `Claude's unit run shows as the live result: ${JSON.stringify(grouped?.live)}`);
    await capture('test-loop-running');

    // The reader's strip shows the same Loop line as one bar; the reply body has no raw Loop text.
    await js('PastelTerm.overlays.hideCurrent()');
    await js("PastelTerm.reader.setView('replies')");
    const strip = await waitFor(async () => js(`(() => {
      const bars = document.querySelectorAll('#reader-head .status-strip [role="progressbar"]');
      const bar = document.querySelector('#reader-head .status-strip .status-loop [role="progressbar"]');
      if (!bar) return null;
      return { count: bars.length, now: bar.getAttribute('aria-valuenow'), max: bar.getAttribute('aria-valuemax'), caption: bar.querySelector('.station-caption')?.textContent,
        inBody: !!document.querySelector('#latest .status-block .status-loop'), raw: /Loop:/.test(document.getElementById('latest').textContent) };
    })()`), 6000);
    check(strip && strip.count === 1 && strip.now === '2' && strip.max === '5' && strip.caption === 'Fixing · round 2/5 · 3 open' && strip.inBody && !strip.raw, `the session strip shows one Loop bar: ${JSON.stringify(strip)}`);
    await js("document.getElementById('testing-button').click()");
    await settle((p) => p.state.loop === 'running');

    // Every theme and reading style; then widths.
    for (const theme of ['paleSky', 'blush', 'nightPastel']) {
      applyTheme(theme, { persist: false });
      for (const [look] of READING_CHOICES) {
        await setReading(look);
        await wait(150);
        const p = await probe();
        check(p && (p.minRatio as number) >= MIN_RATIO && (p.overflowX as number) <= 0, `${theme} ${look}: ${p?.minRatio}:1 ${JSON.stringify(p?.worst)}`);
      }
    }
    applyTheme('paleSky', { persist: false });
    await setReading('newspaper');
    for (const width of WIDTHS) {
      resizeOffscreen(win, width, 900);
      await wait(400);
      const p = await probe();
      check(p && (p.overflowX as number) <= 0 && p.inWindow, `${width}px: overflow ${p?.overflowX}, in window ${p?.inWindow}`);
      if (width === 800) await capture('test-loop-800');
    }
    resizeOffscreen(win, 1280, 900);

    // Stop: one Esc now; the stop message waits until that claude is idle.
    setFixtureStatus(feed, 'busy');
    check(await waitFor(async () => (await js("PastelTerm.tabs.get(PastelTerm.testing.state().loopTab)?.update?.busy")) || null, 6000), 'the fixture tab is busy');
    const escBefore = promptWrites.length;
    const pastesAtStop = pasteWrites.length;
    await js("document.querySelector('#testing .tst-stop').click()");
    const esc = await waitFor(() => promptWrites.slice(escBefore).find((keys) => JSON.stringify(keys) === JSON.stringify(['\x1b'])) ?? null, 3000);
    check(esc && promptWrites.length === escBefore + 1, `Stop sends exactly one Esc through the prompt key path: ${JSON.stringify(promptWrites.slice(escBefore))}`);
    const stopping = await settle((p) => p.pill === 'Stopping', 3000);
    await wait(2500);
    check(stopping && !pasteWrites.slice(pastesAtStop).some((w) => w.data.includes(STOP_MESSAGE)), 'the stop message waits while Claude is busy');
    setFixtureStatus(feed, 'idle');
    const stopPaste = await waitFor(() => pasteWrites.slice(pastesAtStop).find((w) => w.data.includes(STOP_MESSAGE)) ?? null, 8000);
    check(stopPaste && stopPaste.data === `${PASTE_START}${STOP_MESSAGE}${PASTE_END}\r`, `once idle, the stop message is pasted: ${JSON.stringify(stopPaste?.data.slice(0, 80))}`);
    const stopped = await settle((p) => p.state.loop === 'stopped' && !p.startDisabled && !p.formHidden);
    check(stopped, `after Stop the loop reads stopped and Start is back: ${JSON.stringify(stopped?.state.loop)}`);

    // Claude's closing line.
    append('done', `**Loop stopped at round 2.**\n\nFixed 1 bug, 2 still open, no files committed.\n\n**Loop:** round 2/5 · done · 2 open`);
    const done = await settle((p) => p.state.loop === 'done' && p.pill === 'Done');
    check(done && !done.startDisabled && /Round 2 of 5/.test(String(done.facts)), `a done line ends it and Start is back: ${JSON.stringify(done?.facts)}`);
    await capture('test-loop-done');
  } finally {
    testingFixture.project = null;
    testingFixture.claudeDir = null;
    setFixtureStatus(feed, 'idle');
    await js('PastelTerm.overlays.hideCurrent()');
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
