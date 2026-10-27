// The conclusion's This session line (part of PASTEL_SNAPSHOT_MODE=conclusion): a stand-in project with seeded test runs,
// a Claude test run and a Loop line in the fixture log, and a gated stub Library extractor, so the line is seen
// without a Library part, then "reading…", then filled in place; its links open the note and the run.
import fs from 'node:fs';
import path from 'node:path';
import type { Kit } from './snapshot';
import { libraryFixture, testingFixture } from '../main/snapshot-mode';
import * as configStore from '../main/config-store';
import * as testingStore from '../main/testing-store';
import * as librarySessions from '../main/library-sessions';
import { mergeTopics } from '../main/library-store';
import { assertFixtureOutsideClaude } from './snapshot-views';
import { petalDirOf, petalFileOf } from './snapshot-testing';
import type { PipelineRun, StageResult } from '../shared/testing';

const STAGES = [{ id: 'typecheck', name: 'Typecheck', command: 'npm run typecheck' }, { id: 'unit', name: 'Unit', command: 'npx vitest run' }];
const VITEST_FAIL = 'Exit code 1\n\n FAIL  src/banner.test.ts > pins the line\n\n Test Files  1 failed (1)\n      Tests  2 failed | 11 passed (13)\n   Duration  1.20s';
export const WANT_TESTS = 'Tests: 3 runs · last Unit failed (11 passed, 2 failed)';
export const WANT_LOOP = 'Test loop: done, 3 bugs fixed, 1 open';
export const WANT_LIBRARY = 'Library +2 notes, 1 updated: Conclusion banner, Session line, Reader banners';
const TOPICS = { topics: [
  { topic: 'Conclusion banner', category: 'Product', facts: ['A concluded session pins a one-line summary at the top of the reader.'], evidence: 'fixture' },
  { topic: 'Session line', category: 'Product', facts: ['Petal fills the This session line itself; Claude never lists it.'], evidence: 'fixture' },
  { topic: 'Reader banners', category: 'Product', facts: ['One bar folds the status strip and the pinned conclusion away.'], evidence: 'fixture' },
] };

const stage = (s: (typeof STAGES)[number], status: StageResult['status'], passed: number): StageResult => ({
  stageId: s.id, name: s.name, command: s.command, status, exitCode: 0, durationMs: 900, counts: { passed, failed: 0, skipped: 0 }, tests: [], output: '', runner: 'vitest',
});
const petalRun = (id: string, startedAt: number, stages: StageResult[]): PipelineRun => ({
  id, by: 'you', trigger: 'click', startedAt, finishedAt: startedAt + 2000, state: 'passed', stages,
  totals: { passed: stages.reduce((n, s) => n + s.counts.passed, 0), failed: 0, skipped: 0 },
});

let seq = 0;
const stamp = () => new Date().toISOString();
// A Claude Bash call to vitest and its failing result, as Claude Code logs them.
export function bashTestTurn(): string[] {
  seq += 1;
  const id = `toolu_snapshot_${seq}`;
  return [
    JSON.stringify({ isSidechain: false, type: 'assistant', uuid: `bash-${seq}`, timestamp: stamp(), message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'npx vitest run' } }] } }),
    JSON.stringify({ isSidechain: false, type: 'user', uuid: `bash-r${seq}`, timestamp: stamp(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: VITEST_FAIL }] } }),
  ];
}
export const loopReply = (): string => JSON.stringify({ isSidechain: false, type: 'assistant', uuid: `loop-${++seq}`, timestamp: stamp(), message: { role: 'assistant', content: [{ type: 'text', text: 'Round 3 is green apart from one flaky scenario.\n\n**Loop:** round 3/3 · done · 1 open' }] } });

// The line in `root` (the pin or the full banner): its text, links and contrast on its own background.
export const LINE = (root: string) => `(() => {
  const rgba = (c) => (c.match(/[\\d.]+/g) || []).map(Number);
  const over = (top, under) => { const a = top[3] ?? 1; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)); };
  const lum = (c) => { const s = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return Math.round(((x + 0.05) / (y + 0.05)) * 10) / 10; };
  const line = document.querySelector(${JSON.stringify(`${root} .conclusion-session`)});
  if (!line || !line.getClientRects().length) return { shown: false };
  const bgOf = (e) => { const layers = []; for (let n = e; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if ((c[3] ?? 1) > 0) layers.push(c); if ((c[3] ?? 1) === 1) break; } return layers.reverse().reduce((under, top) => over(top, under), [255, 255, 255]); };
  const bg = bgOf(line);
  const of = (e) => (e ? ratio(rgba(getComputedStyle(e).color), bg) : null);
  const parts = [...line.querySelectorAll('.conclusion-session-part')];
  return {
    shown: true, text: line.textContent, parts: parts.map((p) => p.textContent),
    links: [...line.querySelectorAll('.conclusion-session-link')].map((a) => a.textContent),
    contrast: { label: of(line.querySelector('.conclusion-session-label')), text: of(parts[0]), link: of(line.querySelector('.conclusion-session-link')), dot: of(line.querySelector('.conclusion-session-dot')) },
    overflow: Math.round(line.getBoundingClientRect().right - line.parentElement.getBoundingClientRect().right),
    height: Math.round(line.getBoundingClientRect().height),
  };
})()`;
export type LineState = { shown: boolean; text?: string; parts?: string[]; links?: string[]; contrast?: Record<string, number | null>; overflow?: number; height?: number };
export const lineReadable = (l: LineState): boolean => Boolean(l.shown && l.contrast && Object.values(l.contrast).every((r) => r === null || r >= 4.5));

export interface SessionLineFixture {
  release: () => void; // lets the stub extractor answer
  extracted: () => number;
  cleanUp: () => void;
}

// Before the first conclude: the project, its runs and criteria (in Petal's folder for it), a note to update, the switch on,
// and the gated stub.
export function setUpSessionLine({ outDir }: Kit, fixture: string, historySessionId: string): SessionLineFixture {
  const repo = path.join(outDir, 'conclusion-repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.rmSync(petalDirOf(repo), { recursive: true, force: true });
  fs.mkdirSync(petalDirOf(repo), { recursive: true });
  fs.writeFileSync(petalFileOf(repo, 'criteria.md'), '# Test criteria\n\n## Scenarios\n- [pass] pin shows the line\n\n## Bugs\n- [fixed] line overflowed at 800px · round 1\n- [fixed] links lost focus ring · round 2\n- [fixed] stale line after re-conclude · round 2\n- [fail] reading never cleared · round 3\n');
  const previousProject = testingFixture.project;
  testingFixture.project = repo;
  testingStore.savePipeline(repo, { stages: STAGES, keepGoing: false, autoRun: false, confirmed: [] });
  const now = Date.now();
  // Inside the fixture session's span (it started at launch); Claude's failing run lands after both.
  testingStore.putRun(repo, petalRun('run-snapshot-pipeline', now - 2000, [stage(STAGES[0], 'passed', 0), stage(STAGES[1], 'passed', 13)]));
  testingStore.putRun(repo, petalRun('run-snapshot-unit', now - 1000, [stage(STAGES[1], 'passed', 13)]));
  testingStore.putRun(repo, petalRun('run-snapshot-before', now - 365 * 24 * 3600_000, [stage(STAGES[1], 'passed', 13)])); // long before the session: never counted
  mergeTopics([{ topic: 'Reader banners', category: 'Product', facts: ['The reader has a status strip.'], evidence: 'earlier' }], { sessionId: 'earlier-session', date: '2026-10-01' });
  librarySessions.record(historySessionId, { added: [{ slug: 'conclusion-banner', title: 'Conclusion banner' }], updated: [] });

  const previousAutoBuild = configStore.load().library.autoBuild;
  configStore.save({ library: { autoBuild: true } });
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => { open = resolve; });
  let calls = 0;
  libraryFixture.extract = async () => { calls += 1; await gate; return JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify(TOPICS) }); };

  assertFixtureOutsideClaude(fixture);
  fs.appendFileSync(fixture, `${[...bashTestTurn(), loopReply()].join('\n')}\n`);
  return {
    release: () => open(),
    extracted: () => calls,
    cleanUp: () => {
      open();
      libraryFixture.extract = null;
      testingFixture.project = previousProject;
      configStore.save({ library: { autoBuild: previousAutoBuild } });
    },
  };
}

// After the first conclude is in: no Library part until the harvest starts, then reading…, then the notes, all in place.
export async function sessionLineCheck(kit: Kit, line: SessionLineFixture): Promise<void> {
  const { js, waitFor, log, wait } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} conclusion line: ${what}`);
  const full = () => js(LINE('#reader-conclusion')) as Promise<LineState>;
  const pin = () => js(LINE('#reader-conclusion-pin')) as Promise<LineState>;

  const first = await waitFor(async () => { const l = await full(); return l.shown && l.text?.includes('Tests:') ? l : null; }, 8000);
  check(first && first.parts?.includes(WANT_TESTS) && first.parts?.includes(WANT_LOOP),
    `full banner names this session's test runs (2 of Petal's in its span, Claude's own from the log; the year-old one left out) and the loop: ${JSON.stringify(first)}`);
  const reading = await waitFor(async () => { const l = await full(); return l.parts?.[0] === 'Library: reading…' ? l : null; }, 15000);
  const readingPin = await pin();
  check(reading && readingPin.parts?.[0] === 'Library: reading…' && line.extracted() === 1, `while the Library reads the session, both lines say "Library: reading…": ${JSON.stringify({ full: reading?.parts, pin: readingPin.parts, runs: line.extracted() })}`);
  const scrollBefore = await js("document.getElementById('reader').scrollTop");
  const banners = await js("document.querySelectorAll('#reader-conclusion .conclusion-banner').length");
  line.release();
  const done = await waitFor(async () => { const l = await full(); return l.parts?.[0]?.startsWith('Library +') ? l : null; }, 10000);
  check(done && done.parts?.[0] === WANT_LIBRARY && JSON.stringify(done.links?.slice(0, 3)) === JSON.stringify(['Conclusion banner', 'Session line', 'Reader banners']),
    `then it fills in place with counts and note links: ${JSON.stringify(done)}`);
  const donePin = await pin();
  check(donePin.shown && donePin.parts?.[0] === 'Library +2 notes, 1 updated' && donePin.links?.length === 1 && (donePin.height ?? 99) <= 26,
    `the pinned line updates too: counts only (titles are in the full banner), one short line: ${JSON.stringify(donePin)}`);
  check(banners === 1 && (await js("document.querySelectorAll('#reader-conclusion .conclusion-banner').length")) === 1 && Math.abs((await js("document.getElementById('reader').scrollTop")) - scrollBefore) <= 1,
    'one banner throughout, and the reader did not move');
  check(lineReadable(done ?? { shown: false }) && lineReadable(donePin), `contrast >= 4.5: ${JSON.stringify({ full: done?.contrast, pin: donePin.contrast })}`);

  // The links: a note opens in the Library, the tests open Testing on that run.
  await js("[...document.querySelectorAll('#reader-conclusion .conclusion-session-link')].find((a) => a.textContent === 'Session line').click()");
  const note = await waitFor(async () => { const n = await js("(() => { const r = document.querySelector('#library .lib-reading'); return r && !r.hidden ? { slug: r.dataset.slug, title: r.querySelector('.lib-reading-title')?.textContent } : null; })()"); return n?.title ? n : null; }, 5000);
  check(note && note.slug === 'session-line' && note.title === 'Session line' && await js("PastelTerm.library.isOpen()"), `a note title opens that note in the Library: ${JSON.stringify(note)}`);
  await js('PastelTerm.library.close()');
  await js("document.querySelector('#reader-conclusion .conclusion-session-link[title=\"Open this run in Testing\"]').click()");
  const opened = await waitFor(async () => { const s = await js('PastelTerm.testing.state()'); return s.selectedRun ? s : null; }, 8000);
  check(opened && /^claude-toolu_snapshot_/.test(opened.selectedRun) && await js('PastelTerm.testing.isOpen()'), `the Tests link opens Testing on that run: ${JSON.stringify(opened && { selectedRun: opened.selectedRun, project: opened.project })}`);
  await js('PastelTerm.testing.close()');
  await wait(200);
}

// History's preview of a concluded session from an earlier day: its stored Library record and Claude's test run.
export async function historyLineCheck(kit: Kit): Promise<void> {
  const { js, waitFor, log } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} conclusion line: ${what}`);
  const full = await waitFor(async () => { const l = await js(LINE('#history-preview .history-conclusion')) as LineState; return l.shown && l.text?.includes('Tests:') ? l : null; }, 8000);
  const pinned = await js(LINE('#history-preview .history-conclusion-pin')) as LineState;
  check(full && full.parts?.[0] === 'Library +1 note: Conclusion banner' && full.parts?.includes('Tests: Unit failed (11 passed, 2 failed)') && pinned.shown && lineReadable(full) && lineReadable(pinned),
    `History preview shows the stored Library record and the log's test run, readable: ${JSON.stringify({ full, pinned })}`);
}
