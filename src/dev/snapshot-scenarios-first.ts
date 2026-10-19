// Scenarios first (PASTEL_SNAPSHOT_MODE=scenarios-first), against a stand-in ~/.claude, userData and repo: Ask Claude
// sends the task's notes and its PRD as the source of scenarios; once the drafting agent writes [todo] scenarios and goes
// idle, its lane reads Scenarios ready with the list, not "stopped without a suite"; Edit scenarios opens the task's own
// criteria file; Looks right sends the go-ahead into its terminal once and saves the approved names. Then a task that already
// has a suite and no criteria file: Start test loop stops round 1 for the same review, and after approval only a scenario
// added later shows again. Fixture sessions only, never a real claude.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { extraTabFixtures, pasteWrites, testingFixture } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { writeSuite } from '../main/task-suites';
import * as store from '../main/testing-store';
import { assertFixtureOutsideClaude } from './snapshot-views';
import { closeExtraTabs, hostOf } from './snapshot-testing';
import { scenariosApprovedText } from '../shared/suite-draft';
import { emptySuite } from '../shared/task-suite';

const MAIN_SESSION = 'snapshot-fixture'; // the first tab's fixture session holds t-scen
const DRAFTER = '5c3e0000-0000-4000-8000-0000000000d1';
const TESTER = '5c3e0000-0000-4000-8000-0000000000a1'; // t-loop's testing agent
const FIXER = '5c3e0000-0000-4000-8000-0000000000f1';
const NOTES = 'Refunds cap at the amount paid.';
const PRD_NOTES = 'Every refund emails the payer.';

const put = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const criteriaText = (lines: string[]) => ['# Test criteria', '', '## Scenarios', ...lines, '', '## Bugs', ''].join('\n');

export async function scenariosFirstCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, waitFor, log, capture, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} scenarios first: ${what}`);
  const dir = path.join(outDir, 'scenarios-first');
  const repo = path.join(dir, 'refunds');
  const logOf = (sessionId: string) => path.join(dir, 'tabs', `${sessionId}.jsonl`);
  const criteriaOf = (taskId: string) => path.join(repo, '.petal', 'criteria', `${taskId}.md`);
  const saved = { project: testingFixture.project, claudeDir: testingFixture.claudeDir };
  const [startWidth, startHeight] = win.getContentSize();
  const startTabs: string[] = await js('PastelTerm.tabs.ids()');

  const entry = (sessionId: string, fields: Record<string, unknown>) => `${JSON.stringify({ isSidechain: false, cwd: repo, sessionId, timestamp: new Date().toISOString(), ...fields })}\n`;
  const say = (sessionId: string, uuid: string, prompt: string, text: string) => entry(sessionId, { type: 'user', uuid: `${uuid}-u`, message: { role: 'user', content: prompt } })
    + entry(sessionId, { type: 'assistant', uuid, message: { id: `msg-${uuid}`, role: 'assistant', content: [{ type: 'text', text }] } });
  const tabOf = (sessionId: string) => waitFor(() => hostOf(win.webContents.id, repo, sessionId), 10000); // its agent terminal, as main says
  const reopen = async () => { await js(`PastelTerm.tabs.activate(${JSON.stringify(startTabs[0])})`); await js("PastelTerm.testing.isOpen() || document.getElementById('testing-button').click()"); }; // the button toggles
  const pickTask = (id: string) => js(`(() => { const s = document.querySelector('#testing .tst-pickerbox .tst-task-select'); s.value = 'task:${id}'; s.dispatchEvent(new Event('change')); })()`);
  type Screen = { lane: string | null; scenarios: string[]; sources: string[]; edit: boolean; approve: boolean; drawing: string | null; ended: boolean };
  const screen = (): Promise<Screen> => js(`(() => {
    const v = document.getElementById('testing');
    const lane = v.querySelector('.tst-agent-lane[data-role="tester"]');
    return {
      lane: lane?.querySelector('.tst-agent-status')?.children[1]?.textContent ?? null, // the word after its dot
      scenarios: [...v.querySelectorAll('.tst-scenario .tst-scenario-name')].map((n) => n.textContent),
      sources: [...v.querySelectorAll('.tst-scenario .is-source')].map((n) => n.textContent),
      edit: !!v.querySelector('.tst-edit-scenarios'), approve: !!v.querySelector('.tst-approve-scenarios'),
      drawing: v.querySelector('.tst-drawing')?.textContent ?? null, ended: !!v.querySelector('.tst-draft-ended'),
    };
  })()`);
  const waitScreen = (want: (s: Screen) => boolean, ms = 12000) => waitFor(async () => { const s = await screen(); return want(s) ? s : null; }, ms);
  // Looks right: the go-ahead pasted once into that terminal, and the names saved with the task's loop or draft.
  const approve = async (taskId: string, tabId: string | null, names: string[]) => {
    const before = pasteWrites.length;
    await js("document.querySelector('#testing .tst-approve-scenarios').click()");
    const go = await waitFor(() => pasteWrites.slice(before).find((w) => w.data.includes(scenariosApprovedText(taskId).slice(0, 60))) ?? null, 5000);
    const approved = await waitFor(() => { const a = store.load(repo).loops?.[taskId]?.approvedScenarios; return a && names.every((n) => a.includes(n)) ? a : null; }, 5000);
    const sends = pasteWrites.slice(before).filter((w) => w.data.includes('they look right')).length;
    return { go: go?.tabId === tabId && sends === 1, approved, gone: await waitScreen((s) => !s.approve, 6000) };
  };

  try {
    resizeOffscreen(win, 1280, 900);
    fs.rmSync(dir, { recursive: true, force: true });
    put(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    put(path.join(repo, 'package.json'), JSON.stringify({ name: 'refunds', scripts: { test: 'vitest run' }, devDependencies: { vitest: '^5.0.0' } }, null, 2));
    const owner = { sessionId: MAIN_SESSION, name: 'Refunds', branch: 'main' };
    const task = (id: string, title: string, notes: string, held: boolean) => ({ id, title, notes, status: held ? 'working' : 'open', owner: held ? owner : null, createdAt: Date.now() - 3_600_000, claimedAt: held ? Date.now() - 1_800_000 : null, doneAt: null, doneBy: null, prdId: 'p-pay', parentId: null });
    put(path.join(repo, '.petal', '.gitignore'), '*\n');
    put(path.join(repo, '.petal', 'tasks.json'), JSON.stringify({
      version: 2,
      prds: [{ id: 'p-pay', title: 'Payments', notes: PRD_NOTES, createdAt: Date.now() - 7_200_000 }],
      tasks: [task('t-scen', 'Refunds', NOTES, true), task('t-loop', 'Employer portal', 'Admins approve each refund.', false)],
    }, null, 2));
    for (const id of [DRAFTER, TESTER, FIXER]) assertFixtureOutsideClaude(logOf(id));
    put(logOf(DRAFTER), say(DRAFTER, 's0', 'for task t-scen', 'Reading the refunds code.'));
    put(logOf(TESTER), say(TESTER, 'l0', 'You are Testing agent.', 'Reading the portal code.'));
    put(logOf(FIXER), say(FIXER, 'f0', 'You are Bug fix agent.', 'Ready.'));
    writeSuite(repo, 't-loop', emptySuite([{ id: 'unit', name: 'Unit', command: 'npm test' }])); // her suite, no criteria file yet
    testingFixture.project = repo;
    testingFixture.claudeDir = path.join(dir, 'claude'); // no skill there: the brief carries the bundled instructions
    testingFixture.opened.length = 0;

    // 1 Ask Claude: the brief carries the notes and the PRD as the source of scenarios, and the scenarios step.
    testingFixture.agentIds.splice(0, Infinity, DRAFTER);
    extraTabFixtures.push({ sessionId: DRAFTER, transcript: logOf(DRAFTER), status: 'idle', cwd: repo });
    await js('PastelTerm.getStarted.close()');
    await js('PastelTerm.overlays.hideCurrent()');
    await js("document.getElementById('testing-button').click()");
    await waitFor(async () => ((await js('PastelTerm.testing.isOpen() ? PastelTerm.testing.state().task : null')) === 'Refunds' ? true : null), 8000);
    const startsBefore = testingFixture.loopStarts.length;
    await js("document.querySelector('#testing .tst-ask-suite').click()");
    const started = await waitFor(() => testingFixture.loopStarts[startsBefore] ?? null, 5000);
    const brief = started?.brief ?? '';
    check(brief.includes('Source of scenarios:') && brief.includes(`Task notes:\n${NOTES}`) && brief.includes(`PRD "Payments":\n${PRD_NOTES}`), `the brief labels the notes and PRD as the source: ${JSON.stringify(brief.slice(0, 200))}`);
    check(brief.includes('## 2. Write the scenarios, then stop') && !/[—–]/.test(brief), 'the brief carries the scenarios-first step, no long dashes');

    // 2 It writes [todo] scenarios and stops: Scenarios ready on its lane, with the list, not "stopped without a suite".
    const drafterTab = await tabOf(DRAFTER);
    await reopen();
    put(criteriaOf('t-scen'), criteriaText([
      '- [todo] a refund over the amount paid is refused · from: notes · task: t-scen',
      '- [todo] the payer gets an email for each refund · from: prd · task: t-scen',
      '- [todo] a refund on a cancelled order is refused · task: t-scen',
    ]));
    fs.appendFileSync(logOf(DRAFTER), say(DRAFTER, 's1', 'go on', 'The scenarios are ready for review in Petal’s Testing tab.'));
    const ready = await waitScreen((s) => s.lane === 'Scenarios ready' && s.scenarios.length === 3);
    check(drafterTab && ready && ready.edit && ready.approve && !ready.ended, `the lane reads Scenarios ready with both actions: ${JSON.stringify(ready ?? await screen())}`);
    check(ready?.sources.join('|') === 'from the task notes|from the PRD' && ready.drawing === 'Scenarios ready for your review above', `sources are tagged and the strip points at the review: ${JSON.stringify(ready && { sources: ready.sources, drawing: ready.drawing })}`);
    await capture('scenarios-first-ready');

    // 3 Edit scenarios opens only the task's own criteria file.
    await js("document.querySelector('#testing .tst-edit-scenarios').click()");
    const opened = await waitFor(() => testingFixture.opened[0] ?? null, 4000);
    check(opened === criteriaOf('t-scen') && testingFixture.opened.length === 1, `Edit scenarios opens the task's criteria file: ${JSON.stringify(testingFixture.opened)}`);

    // 4 Looks right: the go-ahead goes into its terminal once, the names are saved, and the review leaves the lane.
    const draftOk = await approve('t-scen', drafterTab, ready?.scenarios ?? []);
    check(draftOk.go && draftOk.approved?.length === 3 && draftOk.gone, `the draft's go-ahead is pasted once and the approval saved: ${JSON.stringify(draftOk)}`);

    // 5 A task with a suite and no criteria file: Start test loop stops round 1 for the same review.
    testingFixture.agentIds.splice(0, Infinity, TESTER, FIXER);
    extraTabFixtures.push({ sessionId: TESTER, transcript: logOf(TESTER), status: 'idle', cwd: repo }, { sessionId: FIXER, transcript: logOf(FIXER), status: 'idle', cwd: repo });
    await pickTask('t-loop');
    await waitFor(async () => ((await js('PastelTerm.testing.state().task')) === 'Employer portal' ? true : null), 8000);
    const loopStarts = testingFixture.loopStarts.length;
    await js("document.querySelector('#testing .tst-loop-go').click()");
    const loopBrief = (await waitFor(() => testingFixture.loopStarts[loopStarts] ?? null, 6000))?.brief ?? '';
    check(loopBrief.includes('Scenarios first: before any test in round 1') && loopBrief.includes('Admins approve each refund.'), `the loop brief stops round 1 for her review: ${JSON.stringify(loopBrief.slice(0, 120))}`);
    const testerTab = await tabOf(TESTER);
    await reopen();
    await pickTask('t-loop');
    put(criteriaOf('t-loop'), criteriaText([
      '- [todo] an admin approves a refund before it is paid · from: notes · task: t-loop',
      '- [todo] a refund without approval is not paid · task: t-loop',
    ]));
    fs.appendFileSync(logOf(TESTER), say(TESTER, 'l1', 'go on', 'Scenarios are ready for review.\n\n**Loop:** round 1/5 · scenarios · 0 open'));
    const loopReady = await waitScreen((s) => s.lane === 'Scenarios ready' && s.scenarios.length === 2);
    check(testerTab && loopReady?.approve, `the loop's tester lane reads Scenarios ready: ${JSON.stringify(loopReady ?? await screen())}`);
    const loopOk = await approve('t-loop', testerTab, loopReady?.scenarios ?? []);
    check(loopOk.go && loopOk.approved?.length === 2 && loopOk.gone, `the loop's go-ahead is pasted once and the approval saved: ${JSON.stringify(loopOk)}`);

    // 6 Approved ones stay quiet, even still [todo]; a scenario added in a later round shows alone.
    put(criteriaOf('t-loop'), criteriaText([
      '- [pass] an admin approves a refund before it is paid · test: src/refund.test.ts::needs approval · from: notes · task: t-loop',
      '- [todo] a refund without approval is not paid · task: t-loop',
      '- [todo] an approval expires after 7 days · task: t-loop',
    ]));
    fs.appendFileSync(logOf(TESTER), say(TESTER, 'l2', 'go on', 'Added one scenario.\n\n**Loop:** round 2/5 · scenarios · 0 open'));
    const later = await waitScreen((s) => s.approve && s.scenarios.length === 1);
    check(later?.scenarios[0] === 'an approval expires after 7 days', `only the new scenario waits for review: ${JSON.stringify(later ?? await screen())}`);
    await js("document.querySelector('#testing .tst-stop')?.click()");
    await waitFor(async () => ((await js('PastelTerm.testing.state().loop')) === 'stopped' ? true : null), 15000);
  } finally {
    await js('PastelTerm.testing.close()');
    extraTabFixtures.length = 0;
    testingFixture.agentIds.length = 0;
    testingFixture.opened.length = 0;
    await closeExtraTabs(kit, startTabs);
    await js(`PastelTerm.tabs.activate(${JSON.stringify(startTabs[0])})`);
    testingFixture.project = saved.project;
    testingFixture.claudeDir = saved.claudeDir;
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
