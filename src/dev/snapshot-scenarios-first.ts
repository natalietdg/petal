// Scenarios first (PASTEL_SNAPSHOT_MODE=scenarios-first), against a stand-in ~/.claude, userData and repo: Ask Claude
// sends the task's notes and its PRD as the source of scenarios; once the drafting agent writes [todo] scenarios and goes
// idle, its lane reads Scenarios ready with the list, not "stopped without a suite"; Edit scenarios opens the task's own
// criteria file; Looks right sends the go-ahead into its tab once and saves the approval with the draft.
// Fixture sessions only, never a real claude.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { extraTabFixtures, pasteWrites, testingFixture, type FixtureSession } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import * as store from '../main/testing-store';
import { assertFixtureOutsideClaude } from './snapshot-views';
import { scenariosApprovedText } from '../shared/suite-draft';

const MAIN_SESSION = 'snapshot-fixture'; // the first tab's fixture session holds t-scen
const DRAFTER = '5c3e0000-0000-4000-8000-0000000000d1';
const NOTES = 'Refunds cap at the amount paid.';
const PRD_NOTES = 'Every refund emails the payer.';

const put = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

export async function scenariosFirstCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, waitFor, log, capture, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} scenarios first: ${what}`);
  const dir = path.join(outDir, 'scenarios-first');
  const repo = path.join(dir, 'refunds');
  const drafterLog = path.join(dir, 'tabs', `${DRAFTER}.jsonl`);
  const criteriaFile = path.join(repo, '.petal', 'criteria', 't-scen.md');
  const saved = { project: testingFixture.project, claudeDir: testingFixture.claudeDir };
  const [startWidth, startHeight] = win.getContentSize();
  const startTabs: string[] = await js('PastelTerm.tabs.ids()');

  const entry = (fields: Record<string, unknown>) => `${JSON.stringify({ isSidechain: false, cwd: repo, sessionId: DRAFTER, timestamp: new Date().toISOString(), ...fields })}\n`;
  const say = (uuid: string, prompt: string, text: string) => entry({ type: 'user', uuid: `${uuid}-u`, message: { role: 'user', content: prompt } })
    + entry({ type: 'assistant', uuid, message: { id: `msg-${uuid}`, role: 'assistant', content: [{ type: 'text', text }] } });
  type Screen = { lane: string | null; scenarios: string[]; sources: string[]; edit: boolean; approve: boolean; drawing: string | null; ended: boolean; note: string | null };
  const screen = (): Promise<Screen> => js(`(() => {
    const v = document.getElementById('testing');
    const lane = v.querySelector('.tst-agent-lane[data-role="tester"]');
    return {
      lane: lane?.querySelector('.tst-agent-status')?.children[1]?.textContent ?? null, // the word after its dot
      scenarios: [...v.querySelectorAll('.tst-scenario .tst-scenario-name')].map((n) => n.textContent),
      sources: [...v.querySelectorAll('.tst-scenario .is-source')].map((n) => n.textContent),
      edit: !!v.querySelector('.tst-edit-scenarios'), approve: !!v.querySelector('.tst-approve-scenarios'),
      drawing: v.querySelector('.tst-drawing')?.textContent ?? null, ended: !!v.querySelector('.tst-draft-ended'),
      note: lane?.querySelector('.tst-agent-note')?.textContent ?? null,
    };
  })()`);

  try {
    resizeOffscreen(win, 1280, 900);
    fs.rmSync(dir, { recursive: true, force: true });
    put(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    put(path.join(repo, 'package.json'), JSON.stringify({ name: 'refunds', scripts: { test: 'vitest run' }, devDependencies: { vitest: '^5.0.0' } }, null, 2));
    const owner = { sessionId: MAIN_SESSION, name: 'Refunds', branch: 'main' };
    put(path.join(repo, '.petal', '.gitignore'), '*\n');
    put(path.join(repo, '.petal', 'tasks.json'), JSON.stringify({
      version: 2,
      prds: [{ id: 'p-pay', title: 'Payments', notes: PRD_NOTES, createdAt: Date.now() - 7_200_000 }],
      tasks: [{ id: 't-scen', title: 'Refunds', notes: NOTES, status: 'working', owner, createdAt: Date.now() - 3_600_000, claimedAt: Date.now() - 1_800_000, doneAt: null, doneBy: null, prdId: 'p-pay', parentId: null }],
    }, null, 2));
    assertFixtureOutsideClaude(drafterLog);
    put(drafterLog, say('s0', 'for task t-scen', 'Reading the refunds code.'));
    testingFixture.project = repo;
    testingFixture.claudeDir = path.join(dir, 'claude'); // no skill there: the brief carries the bundled instructions
    testingFixture.opened.length = 0;

    // 1 Ask Claude: the brief carries the notes and the PRD as the source of scenarios, and the scenarios step.
    testingFixture.agentIds.splice(0, Infinity, DRAFTER);
    extraTabFixtures.push({ sessionId: DRAFTER, transcript: drafterLog, status: 'idle', cwd: repo } satisfies FixtureSession);
    await js('PastelTerm.getStarted.close()');
    await js('PastelTerm.overlays.hideCurrent()');
    await js("document.getElementById('testing-button').click()");
    await waitFor(async () => ((await js('PastelTerm.testing.isOpen() ? PastelTerm.testing.state().task : null')) === 'Refunds' ? true : null), 8000);
    const startsBefore = testingFixture.loopStarts.length;
    await js("document.querySelector('#testing .tst-ask-suite').click()");
    const started = await waitFor(() => testingFixture.loopStarts[startsBefore] ?? null, 5000);
    const brief = started?.brief ?? '';
    check(brief.includes(`Source of scenarios:`) && brief.includes(`Task notes:\n${NOTES}`) && brief.includes(`PRD "Payments":\n${PRD_NOTES}`), `the brief labels the notes and PRD as the source: ${JSON.stringify(brief.slice(0, 200))}`);
    check(brief.includes('## 2. Write the scenarios, then stop') && !/[—–]/.test(brief), 'the brief carries the scenarios-first step, no long dashes');

    // 2 It writes [todo] scenarios and stops: Scenarios ready on its lane, with the list, not "stopped without a suite".
    const drafterTab = await waitFor<string | null>(() => js(`PastelTerm.tabs.ids().find((t) => PastelTerm.tabs.get(t).update?.sessionId === ${JSON.stringify(DRAFTER)}) ?? null`), 10000);
    await js(`PastelTerm.tabs.activate(${JSON.stringify(startTabs[0])})`);
    await js("document.getElementById('testing-button').click()");
    put(criteriaFile, [
      '# Test criteria', '', '## Scenarios',
      '- [todo] a refund over the amount paid is refused · from: notes · task: t-scen',
      '- [todo] the payer gets an email for each refund · from: prd · task: t-scen',
      '- [todo] a refund on a cancelled order is refused · task: t-scen',
      '', '## Bugs', '',
    ].join('\n'));
    fs.appendFileSync(drafterLog, say('s1', 'go on', 'The scenarios are ready for review in Petal’s Testing tab.'));
    const ready = await waitFor(async () => { const s = await screen(); return s.lane === 'Scenarios ready' && s.scenarios.length === 3 ? s : null; }, 12000);
    check(drafterTab && ready && ready.edit && ready.approve && !ready.ended, `the lane reads Scenarios ready with both actions: ${JSON.stringify(ready ?? await screen())}`);
    check(ready?.sources.join('|') === 'from the task notes|from the PRD' && ready.drawing === 'Scenarios ready for your review above', `sources are tagged and the strip points at the review: ${JSON.stringify(ready && { sources: ready.sources, drawing: ready.drawing })}`);
    await capture('scenarios-first-ready');

    // 3 Edit scenarios opens only the task's own criteria file.
    await js("document.querySelector('#testing .tst-edit-scenarios').click()");
    const opened = await waitFor(() => testingFixture.opened[0] ?? null, 4000);
    check(opened === criteriaFile && testingFixture.opened.length === 1, `Edit scenarios opens the task's criteria file: ${JSON.stringify(testingFixture.opened)}`);

    // 4 Looks right: the go-ahead goes into its tab once, the approval is saved, and the review leaves the lane.
    const pastesBefore = pasteWrites.length;
    await js("document.querySelector('#testing .tst-approve-scenarios').click()");
    const go = await waitFor(() => pasteWrites.slice(pastesBefore).find((w) => w.data.includes(scenariosApprovedText('t-scen').slice(0, 60))) ?? null, 5000);
    const approvedAt = await waitFor(() => store.load(repo).loops?.['t-scen']?.scenariosApprovedAt ?? null, 5000);
    const after = await waitFor(async () => { const s = await screen(); return !s.approve ? s : null; }, 6000);
    const sends = pasteWrites.slice(pastesBefore).filter((w) => w.data.includes('they look right')).length;
    check(go?.tabId === drafterTab && sends === 1, `the go-ahead is pasted once into its tab: ${JSON.stringify(go?.data.slice(0, 80))}`);
    check(typeof approvedAt === 'number' && after && after.scenarios.length === 0, `the approval is saved with the draft and the review is gone: ${JSON.stringify({ approvedAt, lane: after?.lane })}`);
  } finally {
    await js('PastelTerm.testing.close()');
    extraTabFixtures.length = 0;
    testingFixture.agentIds.length = 0;
    testingFixture.opened.length = 0;
    for (const t of ((await js('PastelTerm.tabs.ids()')) as string[]).filter((id) => !startTabs.includes(id))) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(t)})`);
    await waitFor(async () => (((await js('PastelTerm.tabs.ids()')) as string[]).length === startTabs.length ? true : null), 8000);
    await js(`PastelTerm.tabs.activate(${JSON.stringify(startTabs[0])})`);
    testingFixture.project = saved.project;
    testingFixture.claudeDir = saved.claudeDir;
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
