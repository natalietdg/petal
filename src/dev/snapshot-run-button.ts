// Testing's Run buttons under real mouse clicks, on a suite with levels and an opt-in stage, every command confirmed:
// Run starts the non-opt-in stages; an opt-in stage's own Run, scrolled down to, shows why it didn't run where she can see it.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { resizeOffscreen } from '../main/snapshot-window';
import { testingFixture } from '../main/snapshot-mode';
import * as store from '../main/testing-store';
import { closeExtraTabs, petalFileOf, seedTestingProject } from './snapshot-testing';

const STAGES = [
  { name: 'Typecheck', command: 'npm run typecheck', level: 'smoke' },
  { name: 'Unit', command: 'npm test', level: 'regression' },
  { name: 'Staging sends', command: 'zsh scripts/staging-sends.sh', level: 'staging', optIn: true, note: 'Sends real email.' },
];

// The head's Run: its label, state, centre and whether a click there lands on it.
const RUN = `(() => {
  const b = document.querySelector('#testing .tst-head .tst-primary');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
  return { text: b.textContent, disabled: b.disabled, x, y, onTop: document.elementFromPoint(x, y) === b };
})()`;

// The opt-in stage's own Run, scrolled to the middle of the view.
const STAGE_RUN = `(() => {
  const b = [...document.querySelectorAll('#testing .tst-stage-run')].find((x) => /Staging sends/.test(x.getAttribute('aria-label')));
  if (!b) return null;
  b.scrollIntoView({ block: 'center' });
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), disabled: b.disabled, scrollTop: document.getElementById('testing').scrollTop };
})()`;

// The note's text and whether any of it is inside the view's visible area.
const NOTE = `(() => {
  const view = document.getElementById('testing'), n = view.querySelector('.tst-note');
  const nr = n.getBoundingClientRect(), vr = view.getBoundingClientRect();
  return { text: n.hidden ? '' : n.textContent, inView: !n.hidden && nr.bottom > vr.top && nr.top < vr.bottom };
})()`;

export async function runButtonCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} run-button: ${what}`);
  const { project, claudeDir } = seedTestingProject(outDir);
  fs.writeFileSync(petalFileOf(project, 'suite.json'), JSON.stringify({ stages: STAGES, keepGoing: false, autoRun: false }, null, 2));
  store.savePipeline(project, { stages: [], keepGoing: false, autoRun: false, confirmed: STAGES.map((s) => s.command) });
  const before = { project: testingFixture.project, claudeDir: testingFixture.claudeDir };
  testingFixture.project = project;
  testingFixture.claudeDir = claudeDir;
  testingFixture.runs.length = 0;
  await js('PastelTerm.getStarted.close()');
  await js('PastelTerm.overlays.hideCurrent()');
  const startTabs = await js('PastelTerm.tabs.ids()') as string[];
  const [startWidth, startHeight] = win.getContentSize();
  const click = (x: number, y: number) => {
    for (const type of ['mouseDown', 'mouseUp'] as const) win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
  };
  const runReady = () => waitFor(async () => { const b = await js(RUN); return b && b.text === 'Run 2 stages' && !b.disabled && b.x > 0 ? b : null; }, 8000);
  // Open on the fixture repo with no level chip or opt-in left on by an earlier step; Run back to its two stages.
  const openOnFixture = async () => {
    await js('PastelTerm.overlays.hideCurrent()');
    await js("document.querySelector('#testing-button').click()");
    await waitFor(async () => (await js('PastelTerm.testing.state().stages.length')) === STAGES.length || null, 8000);
    await js("document.querySelectorAll('#testing .tst-chip.is-on:is(.is-smoke, .is-regression, .is-staging)').forEach((c) => c.click())");
    await js("document.querySelectorAll('#testing .tst-optin input:checked').forEach((c) => c.click())");
    return runReady();
  };
  try {
    resizeOffscreen(win, 1280, 900);
    const shown = await openOnFixture();
    check(shown && shown.text === 'Run 2 stages' && !shown.disabled && shown.onTop, `Run is enabled and takes the click: ${JSON.stringify(shown)}`);
    if (shown) click(shown.x, shown.y);
    const ran = await waitFor(() => testingFixture.runs[0] ?? null, 6000);
    check(ran?.stages.map((s) => s.name).join(',') === 'Typecheck,Unit', `a click on Run starts the non-opt-in stages: ${JSON.stringify(ran?.stages.map((s) => s.name))}`);
    if (ran) {
      for (const s of ran.stages) fs.writeFileSync(s.exit, '0\n');
      fs.writeFileSync(path.join(ran.dir, 'done'), '0\n');
    }
    check(await runReady(), 'the run finishes and Run is back');
    await closeExtraTabs(kit, startTabs);
    testingFixture.runs.length = 0;

    // The opt-in stage's own Run with its toggle off: nothing runs, and the reason shows even with the view scrolled.
    await openOnFixture();
    const stageRun = await js(STAGE_RUN);
    check(stageRun && !stageRun.disabled && stageRun.scrollTop > 0, `the opt-in stage's Run is clickable in a scrolled view: ${JSON.stringify(stageRun)}`);
    if (stageRun) click(stageRun.x, stageRun.y);
    const said = await waitFor(async () => { const n = await js(NOTE); return n.text ? n : null; }, 4000);
    await wait(300); // a smooth scroll settles
    const seen = await js(NOTE);
    check(/Opt-in stages run only when turned on/.test(said?.text ?? '') && seen.inView, `its click says why, in view: ${JSON.stringify(seen)}`);
    check(testingFixture.runs.length === 0, 'and nothing runs');
    await capture('run-button-opt-in');
  } finally {
    testingFixture.project = before.project;
    testingFixture.claudeDir = before.claudeDir;
    testingFixture.runs.length = 0;
    await closeExtraTabs(kit, startTabs);
    await js('PastelTerm.overlays.hideCurrent()');
    await js('PastelTerm.testing.resetLeftovers()');
    resizeOffscreen(win, startWidth, startHeight);
  }
}
