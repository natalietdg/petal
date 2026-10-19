// Drawing up a task's suite (PASTEL_SNAPSHOT_MODE=suite-draft), against a stand-in ~/.claude, userData and repo:
// Ask Claude updates Petal's unedited old testing skill first and says so; an edited copy is left alone and the brief
// carries the bundled instructions instead; a draft that goes idle or loses its terminal says it stopped without a suite
// and offers Ask again (a follow-up to the same agent, resumed if no claude runs it); a suite file Petal can't use goes back to it once;
// a bug it records as a [fail] line reaches the bug fix agent; Start reuses the drafting agent as the loop's testing
// agent, and an older testing agent can no longer write the suite. Fixture sessions only, never a real claude.
import fs from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { extraTabFixtures, pasteWrites, testingFixture, type FixtureSession } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { skillsBundleDir } from '../main/testing-skill';
import { hash } from '../main/petal-styles';
import { rememberAgent, syncSuites } from '../main/task-suites';
import { loadTasks } from '../main/tasks-store';
import * as store from '../main/testing-store';
import { assertFixtureOutsideClaude } from './snapshot-views';
import { closeExtraTabs, hostOf } from './snapshot-testing';
import { OUTSIDE_AGENT } from '../shared/task-suite';
import { TESTING_SKILL } from '../shared/suite-draft';

const MAIN_SESSION = 'snapshot-fixture'; // the first tab's fixture session holds t-draft
const DRAFTER = '5d4a0000-0000-4000-8000-0000000000d1';
const FIXER = '5d4a0000-0000-4000-8000-0000000000f1';
const OLD_TESTER = '5d4a0000-0000-4000-8000-0000000000a0'; // a testing agent from before, still on record
const BUG = 'refund rounds down a cent';

const put = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

function writeTasks(repo: string): void {
  const owner = { sessionId: MAIN_SESSION, name: 'Refunds', branch: 'main' };
  const task = (id: string, title: string, held: boolean) => ({ id, title, notes: '', status: held ? 'working' : 'open', owner: held ? owner : null, createdAt: Date.now() - 3_600_000, claimedAt: held ? Date.now() - 1_800_000 : null, doneAt: null, doneBy: null, prdId: null, parentId: null });
  put(path.join(repo, '.petal', '.gitignore'), '*\n');
  put(path.join(repo, '.petal', 'tasks.json'), JSON.stringify({ version: 2, prds: [], tasks: [task('t-draft', 'Refunds', true), task('t-edit', 'Receipts', false)] }, null, 2));
}

export async function suiteDraftCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} suite draft: ${what}`);
  const dir = path.join(outDir, 'suite-draft');
  const repo = path.join(dir, 'refunds');
  const claudeDir = path.join(dir, 'claude');
  const skillFile = path.join(claudeDir, 'skills', TESTING_SKILL, 'SKILL.md');
  const recordFile = path.join(app.getPath('userData'), 'petal-skills.json');
  const recordBefore = fs.existsSync(recordFile) ? fs.readFileSync(recordFile, 'utf8') : null;
  const bundled = fs.readFileSync(path.join(skillsBundleDir(), TESTING_SKILL, 'SKILL.md'), 'utf8');
  const oldSkill = bundled.replace('Write `.petal/suites/<task id>.json`', 'Write `.petal/pipeline.json`');
  const drafterLog = path.join(dir, 'tabs', `${DRAFTER}.jsonl`);
  const fixerLog = path.join(dir, 'tabs', `${FIXER}.jsonl`);
  const suiteFile = path.join(repo, '.petal', 'suites', 't-draft.json');
  const criteriaFile = path.join(repo, '.petal', 'criteria', 't-draft.md');
  const saved = { project: testingFixture.project, claudeDir: testingFixture.claudeDir };
  const [startWidth, startHeight] = win.getContentSize();
  const startTabs: string[] = await js('PastelTerm.tabs.ids()');

  const stamp = () => new Date().toISOString();
  const entry = (sessionId: string, fields: Record<string, unknown>) => `${JSON.stringify({ isSidechain: false, cwd: repo, sessionId, timestamp: stamp(), ...fields })}\n`;
  const say = (sessionId: string, uuid: string, prompt: string, text: string) => entry(sessionId, { type: 'user', uuid: `${uuid}-u`, message: { role: 'user', content: prompt } })
    + entry(sessionId, { type: 'assistant', uuid, message: { id: `msg-${uuid}`, role: 'assistant', content: [{ type: 'text', text }] } });
  const writes = (sessionId: string, uuid: string, target: string) => entry(sessionId, { type: 'assistant', uuid, message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${uuid}`, name: 'Write', input: { file_path: target, content: '{}' } }] } });
  type View = { task: string | null; stages: string[]; suiteProblem: string | null; agents: { kind: string | null; draft: { ended: boolean } | null; queue: { name: string; state: string }[] } };
  const view = (): Promise<View | null> => js('PastelTerm.testing.isOpen() ? PastelTerm.testing.state() : null');
  const waitView = (want: (v: View) => boolean, ms = 8000) => waitFor(async () => { const v = await view(); return v && want(v) ? v : null; }, ms);
  const screen = (): Promise<{ ended: string | null; askAgain: boolean; show: boolean; drawing: boolean; ask: boolean; note: string }> => js(`(() => {
    const v = document.getElementById('testing');
    const note = v.querySelector('.tst-note');
    return { ended: v.querySelector('.tst-draft-ended')?.textContent ?? null, askAgain: !!v.querySelector('.tst-ask-again'), show: !!v.querySelector('.tst-show-draft'), drawing: !!v.querySelector('.tst-drawing'), ask: !!v.querySelector('.tst-ask-suite'), note: note && !note.hidden ? note.textContent : '' };
  })()`);
  const pickTask = (id: string) => js(`(() => { const s = document.querySelector('#testing .tst-pickerbox .tst-task-select'); s.value = 'task:${id}'; s.dispatchEvent(new Event('change')); })()`);

  try {
    resizeOffscreen(win, 1280, 900);
    fs.rmSync(dir, { recursive: true, force: true });
    put(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    put(path.join(repo, 'package.json'), JSON.stringify({ name: 'refunds', scripts: { test: 'vitest run' }, devDependencies: { vitest: '^5.0.0' } }, null, 2));
    writeTasks(repo);
    put(skillFile, oldSkill); // Petal's own copy from an older version, unedited
    put(recordFile, JSON.stringify({ ...(recordBefore ? JSON.parse(recordBefore) as object : {}), [`${TESTING_SKILL}/SKILL.md`]: hash(oldSkill) }, null, 2));
    for (const file of [drafterLog, fixerLog]) assertFixtureOutsideClaude(file);
    put(drafterLog, say(DRAFTER, 'd0', 'for task t-draft', 'Reading the refunds code.'));
    put(fixerLog, say(FIXER, 'f0', 'You are Bug fix agent.', 'Ready.'));
    testingFixture.project = repo;
    testingFixture.claudeDir = claudeDir;

    // 1 Outdated, unedited skill: updated first, said so, and the brief runs the slash command.
    const drafter: FixtureSession = { sessionId: DRAFTER, transcript: drafterLog, status: 'idle', cwd: repo };
    testingFixture.agentIds.splice(0, Infinity, DRAFTER);
    extraTabFixtures.push(drafter);
    await js('PastelTerm.getStarted.close()');
    await js('PastelTerm.overlays.hideCurrent()');
    await js("document.getElementById('testing-button').click()");
    check(await waitView((v) => v.task === 'Refunds' && v.stages.length === 0), 'opens on the session’s task with no suite');
    const startsBefore = testingFixture.loopStarts.length;
    await js("document.querySelector('#testing .tst-ask-suite').click()");
    const started = await waitFor(() => testingFixture.loopStarts[startsBefore] ?? null, 5000);
    const note = (await waitFor(async () => { const s = await screen(); return /Started this task’s testing agent/.test(s.note) ? s.note : null; }, 4000)) ?? '';
    check(started?.brief?.startsWith('/petal-testing-suite for task t-draft: "Refunds".') && started.command.includes(`--session-id ${DRAFTER} --`), `the brief runs the skill: ${JSON.stringify(started?.brief?.slice(0, 80))}`);
    check(note.startsWith('Updated Petal’s testing skill. Started this task’s testing agent'), `the note says the skill was updated: ${note}`);
    check(fs.readFileSync(skillFile, 'utf8') === bundled, 'the stand-in skill now matches the bundled one');
    check(fs.existsSync(criteriaFile), 'the task’s own criteria file exists for the bugs it records');
    check(Boolean(started?.brief?.includes('Write its scenarios and record its bugs in .petal/criteria/t-draft.md.')), 'the brief names the task’s own criteria file');

    // 2 It works, then sits idle with no suite: "stopped without a suite", Ask again and Show terminal.
    const drafterTab = await waitFor(() => hostOf(win.webContents.id, repo, DRAFTER), 10000);
    await js("PastelTerm.testing.isOpen() || document.getElementById('testing-button').click()"); // the button toggles; Testing may still be open from step 1
    fs.appendFileSync(drafterLog, say(DRAFTER, 'd1', 'go on', 'I looked at the refunds code and need to think about the stages.'));
    const ended = await waitFor(async () => { const s = await screen(); return s.ended ? s : null; }, 10000);
    check(drafterTab && ended?.ended === 'The testing agent stopped without a suite.' && ended.askAgain && ended.show && !ended.drawing && !ended.ask, `the draft ends with Ask again and Show terminal: ${JSON.stringify(ended)}`);
    await capture('suite-draft-ended');
    const pastesBefore = pasteWrites.length;
    await js("document.querySelector('#testing .tst-ask-again').click()");
    const again = await waitFor(() => pasteWrites.slice(pastesBefore).find((w) => w.data.includes('You stopped without writing .petal/suites/t-draft.json')) ?? null, 5000);
    check(again && again.tabId === drafterTab && testingFixture.loopStarts.length === startsBefore + 1, `Ask again pastes a follow-up into its terminal, no new agent: ${JSON.stringify(again?.data.slice(0, 80))}`);
    check(await waitFor(async () => { const s = await screen(); return s.drawing && !s.ended ? true : null; }, 5000), 'it reads as drawing again after the follow-up');

    // 3 A suite file Petal can't use goes back to it once, with a fix request.
    fs.appendFileSync(drafterLog, writes(DRAFTER, 'd2', suiteFile));
    put(suiteFile, JSON.stringify({ stages: [{ name: 'Unit', command: 'npm test\nrm -rf build' }] }));
    const bad = await waitView((v) => Boolean(v.suiteProblem?.startsWith('The testing agent’s change was not used')), 10000);
    const fix = await waitFor(() => pasteWrites.find((w) => w.data.includes('Petal couldn\'t use .petal/suites/t-draft.json')) ?? null, 8000);
    await wait(3000);
    const fixes = pasteWrites.filter((w) => w.data.includes('Petal couldn\'t use .petal/suites/t-draft.json')).length;
    check(bad && fix?.tabId === drafterTab && fixes === 1, `the problem is pasted back once: ${JSON.stringify({ problem: bad?.suiteProblem, fixes })}`);

    // 4 It records a code bug as a [fail] line, then writes a good suite.
    fs.appendFileSync(criteriaFile, `- [fail] ${BUG} · test: src/refund.test.ts::rounds to the cent · task: t-draft\n`);
    fs.appendFileSync(drafterLog, writes(DRAFTER, 'd3', suiteFile));
    put(suiteFile, JSON.stringify({ stages: [{ name: 'Unit', command: 'npm test' }] }));
    check(await waitView((v) => v.stages.length === 1 && v.suiteProblem === null, 10000), 'its fixed suite is taken');

    // 5 Start reuses the drafting agent as the loop's testing agent; only the bug fix agent starts new.
    const fixer: FixtureSession = { sessionId: FIXER, transcript: fixerLog, status: 'idle', cwd: repo };
    testingFixture.agentIds.splice(0, Infinity, FIXER);
    extraTabFixtures.push(fixer);
    const loopPastes = pasteWrites.length;
    await js("document.querySelector('#testing .tst-loop-go').click()");
    const fixerStart = await waitFor(() => testingFixture.loopStarts[startsBefore + 1] ?? null, 6000);
    await wait(1000);
    check(fixerStart?.command.includes(`--session-id ${FIXER} --`) && testingFixture.loopStarts.length === startsBefore + 2, `only the bug fix agent starts: ${JSON.stringify(testingFixture.loopStarts.slice(startsBefore + 1).map((l) => l.command.slice(-80)))}`);
    const brief = await waitFor(() => pasteWrites.slice(loopPastes).find((w) => w.tabId === drafterTab && w.data.includes('this task\'s testing agent. Run a test loop')) ?? null, 5000);
    const loop = store.load(repo).loops?.['t-draft'];
    check(brief && loop?.kind === 'loop' && loop.testerSessionId === DRAFTER && loop.fixerSessionId === FIXER, `the loop brief goes to the drafting agent's terminal, which is the loop's tester: ${JSON.stringify(loop && { kind: loop.kind, tester: loop.testerSessionId })}`);

    // 6 The bug it recorded while drafting reaches the bug fix agent.
    const fixerTab = await waitFor(() => hostOf(win.webContents.id, repo, FIXER), 10000);
    const handed = await waitFor(() => pasteWrites.find((w) => w.tabId === fixerTab && w.data.includes(`Bug: ${BUG}.`)) ?? null, 12000);
    check(handed, `the drafting agent's [fail] line reaches the bug fix agent: ${JSON.stringify((await view())?.agents.queue)}`);

    // 7 Write rights: the older testing agent's write is refused; the loop's tester's is taken.
    // Recorded only now: at the start, a lone tester record would rebuild as an ended draft and hide Ask Claude.
    rememberAgent(repo, 't-draft', OLD_TESTER, 'tester');
    const good = fs.readFileSync(suiteFile, 'utf8');
    put(suiteFile, JSON.stringify({ stages: [{ name: 'Unit', command: 'npm test' }, { name: 'Lint', command: 'npm run lint' }] }));
    const { tasks } = loadTasks(repo);
    const refused = syncSuites(repo, tasks, [{ taskId: 't-draft', at: Date.now(), sessionId: OLD_TESTER }])['t-draft'];
    const taken = syncSuites(repo, tasks, [{ taskId: 't-draft', at: Date.now(), sessionId: DRAFTER }])['t-draft'];
    check(refused?.problem === OUTSIDE_AGENT && taken?.problem === null && taken.suite?.stages.length === 2, `an older tester loses write rights, the current one keeps them: ${JSON.stringify({ refused: refused?.problem, taken: taken?.suite?.stages.length })}`);
    put(suiteFile, good);
    await js("document.querySelector('#testing .tst-stop')?.click()");
    await waitFor(async () => ((await js('PastelTerm.testing.state().loop')) === 'stopped' ? true : null), 15000);

    // 8 An edited skill is left alone; the brief carries the bundled instructions, the [fail] line format included.
    fs.appendFileSync(skillFile, '\nMy own line.\n');
    const edited = fs.readFileSync(skillFile, 'utf8');
    await pickTask('t-edit');
    await waitView((v) => v.task === 'Receipts' && v.stages.length === 0);
    await js("document.querySelector('#testing .tst-ask-suite').click()");
    const inline = await waitFor(() => testingFixture.loopStarts[startsBefore + 2] ?? null, 5000);
    const inlineNote = (await waitFor(async () => { const s = await screen(); return /Started this task’s testing agent/.test(s.note) ? s.note : null; }, 4000)) ?? '';
    check(inline?.brief?.startsWith('for task t-edit: "Receipts".') && inline.brief.includes('Write `.petal/suites/<task id>.json`') && /^- \[fail\] .* · test: .*::.* · task: /m.test(inline.brief) && !/[—–]/.test(inline.brief), `the brief carries the bundled instructions: ${JSON.stringify(inline?.brief?.slice(0, 80))}`);
    check(fs.readFileSync(skillFile, 'utf8') === edited && !inlineNote.startsWith('Updated'), `her edited copy is untouched: ${inlineNote}`);

    // 9 Its terminal closes with no suite: stopped, and Ask again resumes the same agent; no second agent starts.
    const editSession = store.load(repo).loops?.['t-edit']?.testerSessionId ?? null;
    const editTab = await waitFor(() => hostOf(win.webContents.id, repo, editSession), 10000);
    if (editTab) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(editTab)})`);
    await js("PastelTerm.testing.isOpen() || document.getElementById('testing-button').click()");
    await pickTask('t-edit');
    const gone = await waitFor(async () => { const s = await screen(); return s.ended ? s : null; }, 10000);
    check(editTab && gone?.ended === 'The testing agent stopped without a suite.' && gone.askAgain && gone.show, `a closed terminal ends the draft, with Ask again and Show terminal: ${JSON.stringify(gone)}`);
    const resumesBefore = testingFixture.resumes.length;
    await js("document.querySelector('#testing .tst-ask-again').click()");
    const resumed = await waitFor(() => testingFixture.resumes.slice(resumesBefore).find((r) => r.sessionId === editSession) ?? null, 5000);
    await wait(1000);
    check(resumed?.command.includes(`--resume '${editSession}'`) && testingFixture.loopStarts.length === startsBefore + 3, `Ask again resumes the same testing agent, no new one: ${JSON.stringify(resumed?.command.slice(-80))}`);
  } finally {
    await js('PastelTerm.testing.close()');
    extraTabFixtures.length = 0;
    testingFixture.agentIds.length = 0;
    testingFixture.resumes.length = 0;
    await closeExtraTabs(kit, startTabs);
    await js(`PastelTerm.tabs.activate(${JSON.stringify(startTabs[0])})`);
    if (recordBefore === null) fs.rmSync(recordFile, { force: true }); else fs.writeFileSync(recordFile, recordBefore);
    testingFixture.project = saved.project;
    testingFixture.claudeDir = saved.claudeDir;
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
