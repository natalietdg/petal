// Test loop: Start pastes the brief into the fixture's Claude tab (never a real claude) and makes the repo's criteria file in
// Petal, never in the repo;
// fixture Loop lines drive the round progress here and in the reader's strip; a criteria fixture renders grouped;
// Start stays off while the loop runs; with Testing closed main still steps the queue and saves it, and the lanes come
// back from main on the next open; the last round's tokens show next to the estimate; Stop records one Esc, then the stop message once idle;
// the criteria agents write go in that one file; Close agents closes both without a signal.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { setFixtureStatus } from './snapshot';
import { FIXER_SESSION, FIXTURE_TASK, agentTerminals, endLoop, hostOf, petalDirOf, repoUntouched, seedTestingProject, useAgentFixtures } from './snapshot-testing';
import { resizeOffscreen } from '../main/snapshot-window';
import { agentCloses, fixtureFile, pasteWrites, stopWrites, testingFixture } from '../main/snapshot-mode';
import { READING_CHOICES } from '../main/menu';
import { STOP_MESSAGE } from '../shared/test-loop';
import * as store from '../main/testing-store';
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
  const { fixer, fixerLog } = useAgentFixtures(outDir);
  await js('PastelTerm.getStarted.close()');
  await js('PastelTerm.overlays.hideCurrent()');
  const [startWidth, startHeight] = win.getContentSize();
  const startTabs = await js('PastelTerm.tabs.ids()') as string[];
  try {
    resizeOffscreen(win, 1280, 900);
    check(await waitFor(async () => (await js("PastelTerm.tabs.get(PastelTerm.tabs.ids()[0])?.update?.state")) === 'live' || null, 15000), 'the fixture tab follows its Claude session');
    await js("document.getElementById('testing-button').click()");
    const idle = await settle((p) => p.state.project === 'acme' && p.state.loop === 'idle' && p.state.stages.length === 3);
    check(idle && !idle.formHidden && !idle.startDisabled && !idle.stopShown && idle.aboveStrip, `the Loop panel sits above the pipeline, Start ready: ${JSON.stringify(idle && { form: !idle.formHidden, start: !idle.startDisabled, above: idle.aboveStrip })}`);
    check(idle && /two agents/.test(String(idle.hint)) && /Neither commits/.test(String(idle.hint)), `the hint says Start starts the two agents: ${JSON.stringify(idle?.hint)}`);
    await capture('test-loop-start');

    // Start: the testing agent and the bug fix agent each start in their own terminal with their own brief and session id.
    const pastesBefore = pasteWrites.length;
    await js(`(() => { const f = document.querySelector('#testing .tst-loop-focus'); f.value = 'checkout flow'; f.dispatchEvent(new Event('input')); const r = document.querySelector('#testing .tst-loop-rounds-input'); r.value = '5'; })()`);
    await js("document.querySelector('#testing .tst-loop-go').click()");
    const starts = await waitFor(() => (testingFixture.loopStarts.length === 2 ? [...testingFixture.loopStarts] : null), 5000);
    const brief = starts?.[0]?.brief ?? '';
    check(starts && /--session-id snapshot-fixture -- /.test(starts[0]?.command ?? '') && starts[1]?.command.includes(`--session-id ${FIXER_SESSION} -- `), `two agents start, each under its own session id: ${JSON.stringify(starts?.map((l) => l.command.slice(0, 120)))}`);
    check(brief.includes('Focus: checkout flow.') && brief.includes('up to 5 rounds') && brief.includes('1. Typecheck: `npm run typecheck`\n2. Unit: `npm test`\n3. Mobile flows: `maestro test .maestro`'),
      `the testing agent's brief carries the focus, rounds and exact stage commands: ${JSON.stringify(brief.slice(0, 200))}`);
    check(brief.includes('Never commit, push, or change git history.') && brief.includes('Never weaken, skip or delete a test') && brief.includes('plus Maestro flows') && brief.includes('Never edit app code') && !brief.includes('\u2014'), 'the brief has the no-commit, no-weakening and tests-only rules, Maestro, and no em dash');
    check(/You are Bug fix agent, the bug fix agent/.test(starts?.[1]?.brief ?? '') && !/[\u2014\u2013]/.test(starts?.[1]?.brief ?? ''), `the bug fix agent's brief: ${JSON.stringify(starts?.[1]?.brief?.slice(0, 100))}`);
    check(!pasteWrites.slice(pastesBefore).some((w) => w.data.includes('Run a test loop')), 'nothing is pasted into the coding session');
    const criteriaFile = path.join(petalDirOf(project), 'criteria.md');
    check(fs.existsSync(criteriaFile) && repoUntouched(project), `Start makes the repo's criteria file in Petal and nothing in the repo: ${criteriaFile}`);
    check(brief.includes(`Criteria file: ${criteriaFile}`), 'the testing agent’s brief names that file by its absolute path');
    const starting = await settle((p) => p.state.loop === 'starting');
    check(starting && starting.formHidden && starting.startDisabled && starting.stopShown, `while starting, Start is off and Stop shows: ${JSON.stringify(starting?.state.loop)}`);
    await js("document.querySelector('#testing .tst-loop-start').requestSubmit()");
    await wait(600);
    check(testingFixture.loopStarts.length === 2, 'a second Start during the loop starts nothing');

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

    // The criteria, grouped, with the bug that became a regression test marked, as the testing agent writes the repo's file.
    fs.writeFileSync(criteriaFile, CRITERIA_FIXTURE);
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
    const kept = fs.readFileSync(criteriaFile, 'utf8');
    check(kept.includes('coupon can take the total below zero') && kept.includes('a stray note') && repoUntouched(project), `the file keeps every line, and still nothing lands in the repo: ${JSON.stringify(kept.slice(0, 120))}`);
    check(JSON.stringify(grouped?.live) === JSON.stringify([['Typecheck', 'waiting'], ['Unit', 'failed'], ['Mobile flows', 'waiting']]), `Claude's unit run shows as the live result: ${JSON.stringify(grouped?.live)}`);
    // The open bugs join the queue; the idle bug fix agent gets the oldest one.
    const fixerTab = await waitFor(() => hostOf(win.webContents.id, project, FIXER_SESSION), 8000);
    const handed = await waitFor(() => pasteWrites.find((w) => w.tabId === fixerTab && w.data.includes('Bug: coupon can take the total below zero.')) ?? null, 8000);
    check(handed && handed.data.includes('Failing test: src/checkout/coupon.test.ts::caps at the total.') && handed.data.includes('**Fix:** coupon can take the total below zero · done'), `the oldest open bug goes to the bug fix agent: ${JSON.stringify(handed?.data.slice(0, 120))}`);
    await capture('test-loop-running');
    const loopTesterTab: string | null = await js('PastelTerm.testing.state().loopTab');

    // The reader's strip shows the same Loop line as one bar; the reply body has no raw Loop text. (The fixture tab plays the testing agent.)
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

    // Testing stays closed: the bug fix agent's Fix line still moves its bug to verify, the testing agent is asked to
    // verify it, and the next open bug goes to the now idle bug fix agent. The queue is saved next to the agent records.
    check(!(await js('PastelTerm.testing.isOpen()')), 'Testing is closed while the queue steps');
    const pastesClosed = pasteWrites.length;
    fs.appendFileSync(fixerLog, line({ type: 'user', uuid: 'fixer-u1', sessionId: FIXER_SESSION, message: { role: 'user', content: 'Bug: coupon can take the total below zero.' } })
      + line({ type: 'assistant', uuid: 'fixer-a1', sessionId: FIXER_SESSION, message: { role: 'assistant', content: [{ type: 'text', text: 'Capped the discount at the total.\n\n**Fix:** coupon can take the total below zero · done' }] } }));
    const verify = await waitFor(() => pasteWrites.slice(pastesClosed).find((w) => w.tabId === loopTesterTab && w.data.includes('Verify "coupon can take the total below zero"')) ?? null, 10000);
    const next = await waitFor(() => pasteWrites.slice(pastesClosed).find((w) => w.tabId === fixerTab && w.data.includes('Bug: Place order stays enabled with an empty cart.')) ?? null, 10000);
    check(verify && next && !(await js('PastelTerm.testing.isOpen()')), `with Testing closed, the fix goes to verify and the next bug goes out: ${JSON.stringify({ verify: verify?.data.slice(0, 60), next: next?.data.slice(0, 60) })}`);
    const saved = await waitFor(() => { const q = store.load(project).loops?.[FIXTURE_TASK]?.queue ?? []; return q.some((b) => b.name === 'coupon can take the total below zero' && b.state === 'verify') && q.some((b) => b.state === 'fixing') ? q : null; }, 6000);
    check(saved, `the queue is saved with the agent records: ${JSON.stringify(store.load(project).loops?.[FIXTURE_TASK]?.queue.map((b) => [b.name, b.state]))}`);

    // Testing opens on main's loop: the lanes, the queue and Petal's events. (A reload is the journey step's.)
    await js("document.getElementById('testing-button').click()");
    await settle((p) => p.state.loop === 'running');
    type Lanes = { lanes: number; queue: string[][]; fixerEvents: string[]; tokens: number };
    const back = await waitFor<Lanes | null>(async () => {
      const l: Lanes = await js(`(() => { const a = PastelTerm.testing.state().agents; return { lanes: document.querySelectorAll('#testing .tst-agent-lane').length, queue: a.queue.map((b) => [b.name, b.state]), fixerEvents: a.events.fixer.map((e) => e.text), tokens: document.querySelectorAll('#testing .tst-agent-tokens').length }; })()`);
      return l.lanes === 2 && l.tokens === 2 && l.queue.some(([, state]) => state === 'verify') ? l : null;
    }, 8000);
    check(back && back.fixerEvents.includes('Testing agent → Bug fix agent · coupon can take the total below zero') && back.queue.some(([name, state]) => name === 'Place order stays enabled with an empty cart' && state === 'fixing'), `the lanes come back from main: ${JSON.stringify(back)}`);

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

    // Stop halts both: one Esc each now; each stop message waits until that agent is idle.
    setFixtureStatus(feed, 'busy');
    const testerTab: string | null = await js('PastelTerm.testing.state().loopTab');
    check(await waitFor(async () => (await js(`PastelTerm.tabs.get(${JSON.stringify(testerTab)})?.update?.busy`)) || null, 6000), 'the testing agent is busy');
    check(await waitFor(async () => ((await js("document.querySelector('#testing .tst-close-agents-button')")) ? null : true), 3000), 'no Close agents while an agent works');
    const escBefore = stopWrites.length;
    const pastesAtStop = pasteWrites.length;
    await js("document.querySelector('#testing .tst-stop').click()");
    const escs = await waitFor(() => { const e = stopWrites.slice(escBefore); return e.length ? e : null; }, 3000);
    await wait(500);
    check(escs && stopWrites.length === escBefore + 1 && escs[0]?.tabId === testerTab && escs[0].keys.join() === '\x1b', `Stop sends one Esc, to the working testing agent only (Esc would clear an idle one's input): ${JSON.stringify(stopWrites.slice(escBefore))}`);
    const stopping = await settle((p) => p.pill === 'Stopping', 3000);
    const fixerStop = await waitFor(() => pasteWrites.slice(pastesAtStop).find((w) => w.tabId === fixerTab && w.data.includes(STOP_MESSAGE)) ?? null, 4000);
    await wait(2000);
    check(stopping && fixerStop && !pasteWrites.slice(pastesAtStop).some((w) => w.tabId === testerTab && w.data.includes(STOP_MESSAGE)), 'the idle bug fix agent gets its stop message; the busy testing agent waits');
    setFixtureStatus(feed, 'idle');
    const stopPaste = await waitFor(() => pasteWrites.slice(pastesAtStop).find((w) => w.tabId === testerTab && w.data.includes(STOP_MESSAGE)) ?? null, 8000);
    check(stopPaste && stopPaste.data === `${PASTE_START}${STOP_MESSAGE}${PASTE_END}\r`, `once idle, the testing agent's stop message is pasted: ${JSON.stringify(stopPaste?.data.slice(0, 80))}`);
    const stopped = await settle((p) => p.state.loop === 'stopped' && !p.startDisabled && !p.formHidden);
    check(stopped, `after Stop the loop reads stopped and Start is back: ${JSON.stringify(stopped?.state.loop)}`);

    // Claude's closing line.
    append('done', `**Loop stopped at round 2.**\n\nFixed 1 bug, 2 still open, no files committed.\n\n**Loop:** round 2/5 · done · 2 open`);
    const done = await settle((p) => p.state.loop === 'done' && p.pill === 'Done');
    check(done && !done.startDisabled && /Round 2 of 5/.test(String(done.facts)), `a done line ends it and Start is back: ${JSON.stringify(done?.facts)}`);
    await capture('test-loop-done');

    // Tokens: the last finished round's actual, for both agents, next to the per-round estimate (cache reads count in both).
    // Each line carries its cwd, as Claude Code logs it, so a later step reading this log never files these runs under its own project.
    if (transcript) {
      const usage = (input: number, output: number, cacheWrite: number, cacheRead: number) => ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead });
      const tool = (id: string, round: number, at: number, use: object) => line({ type: 'assistant', uuid: `loop-a-${id}`, timestamp: new Date(at).toISOString(), cwd: project, message: { id: `msg-${id}`, role: 'assistant', usage: use, content: [{ type: 'text', text: `**Loop:** round ${round}/5 · testing · 0 open` }, { type: 'tool_use', id: `toolu_${id}`, name: 'Bash', input: { command: 'npm test' } }] } })
        + line({ type: 'user', uuid: `loop-u-${id}`, timestamp: new Date(at).toISOString(), cwd: project, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${id}`, content: 'ok' }] } });
      fs.appendFileSync(transcript, tool('tok3', 3, Date.now() - 2000, usage(500, 100, 400, 1000)) + tool('tok4', 4, Date.now(), usage(1000, 200, 0, 3000)));
    }
    const roundLine = await waitFor<string | null>(async () => { const t: string = await js("document.querySelector('#testing .tst-agent-round')?.textContent ?? ''"); return t.startsWith('Round 3:') ? t : null; }, 10000);
    check(roundLine && /^Round 3: 2\.0k tokens \(1\.0k of them cached reads\) for both agents · about [\d.]+k estimated per round$/.test(roundLine), `the last round's actual, cache reads named apart, sits next to an estimate calibrated from this task's rounds: ${roundLine ?? await js("document.querySelector('#testing .tst-agent-round')?.textContent ?? ''")}`);
    check(/so far for both agents$/.test(await js("document.querySelector('#testing .tst-agent-total')?.textContent ?? ''")), 'and the total so far');

    // Close agents: offered once the loop is over; asks inline like the Board's Close, then closes each agent's claude
    // through the Sessions panel's Close (snapshot runs stop before any signal) and their terminals, and the loop stays stopped.
    const closeButton = await waitFor<string | null>(() => js("document.querySelector('#testing .tst-close-agents-button')?.textContent ?? null"), 6000);
    check(closeButton === 'Close agents', `a Close agents button once the loop is done: ${JSON.stringify(closeButton)}`);
    await js("document.querySelector('#testing .tst-close-agents-button').click()");
    const ask = await waitFor<string | null>(() => js("document.querySelector('#testing .tst-close-agents[role=\"group\"]')?.textContent ?? null"), 3000);
    check(ask === 'Close both agents?Yes·No', `it asks first: ${JSON.stringify(ask)}`);
    const closesBefore = agentCloses.length;
    await js("document.querySelector('#testing .tst-close-yes').click()");
    const closes = await waitFor(() => (agentCloses.length >= closesBefore + 2 ? agentCloses.slice(closesBefore) : null), 8000);
    check(closes && JSON.stringify(closes.map((c) => c.sessionId).sort()) === JSON.stringify(['snapshot-fixture', FIXER_SESSION].sort()) && closes.every((c) => c.outcome !== 'closed'), `each agent goes through the close path, and nothing is signalled: ${JSON.stringify(closes)}`);
    check(await waitFor(async () => (!agentTerminals().length && JSON.stringify(await js('PastelTerm.tabs.ids()')) === JSON.stringify(startTabs) ? true : null), 8000), `the agents' terminals close and the coding session's tab stays: ${JSON.stringify(await js('PastelTerm.tabs.ids()'))}`);
    check(store.load(project).loops?.[FIXTURE_TASK]?.stoppedAt && !(await js("document.querySelector('#testing .tst-close-agents-button')")), 'the loop is saved stopped and Close agents goes away');
  } finally {
    testingFixture.project = null;
    testingFixture.claudeDir = null;
    testingFixture.agentIds.length = 0;
    fixer.status = 'idle';
    setFixtureStatus(feed, 'idle');
    check(await endLoop(kit, startTabs), `the two agent terminals close again: ${JSON.stringify(await js('PastelTerm.tabs.ids()'))}`);
    await js('PastelTerm.overlays.hideCurrent()');
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
