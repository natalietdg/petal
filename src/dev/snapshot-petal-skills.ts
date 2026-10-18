// Petal skills (PASTEL_SNAPSHOT_MODE=petal-skills), against a stand-in ~/.claude and a stand-in project:
// Customize › Formatting lists both skills as not installed; Install copies them into skills/<name>/SKILL.md with the
// Library path filled in, leaves her own skills alone, and an edit shows as Edited. Testing offers the old
// .petal/pipeline.json as a seed for a task with no suite, the seed writes the task's suite file, new commands still
// ask first, and a suite change from outside the testing agent is refused with its reason. Text contrast in every theme.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { stylesFixture, testingFixture } from '../main/snapshot-mode';
import { skillsBundleDir } from '../main/customize-ipc';
import { libraryDir } from '../main/library-store';
import { LIBRARY_DIR_TOKEN } from '../main/petal-skills';
import * as store from '../main/testing-store';
import { resizeOffscreen } from '../main/snapshot-window';

const MIN_RATIO = 4.5;
const put = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const CLAUDE_STAGES = [
  { name: 'Typecheck', command: 'npm run typecheck' },
  { name: 'Lint', command: 'npm run lint' },
  { name: 'Unit', command: 'npm test' },
  { name: 'E2E', command: 'npx playwright test' },
  { name: 'Mobile flows', command: 'maestro test .maestro' },
];

// any: the page scripts below build their own shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;

const RATIO_FN = `
  const rgb = (s) => (s.match(/[\\d.]+/g) ?? []).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const backOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c; } return [255, 255, 255]; };
  const ratio = (el) => { const a = lum(rgb(getComputedStyle(el).color)), b = lum(backOf(el)); const [hi, lo] = a > b ? [a, b] : [b, a]; return Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100; };
  const worstOf = (els) => els.filter((e) => e.getClientRects().length).map((e) => [ratio(e), e.className, e.textContent.slice(0, 30)]).sort((a, b) => a[0] - b[0])[0] ?? [99];`;

const SKILLS_CARD = `(() => {${RATIO_FN}
  const list = document.querySelector('#customize .cz-skills');
  const card = (list ?? document.querySelector('#customize .cz-skills-install'))?.closest('.cz-card');
  if (!card) return null;
  return {
    title: card.querySelector('h3, h2, .cz-card-title')?.textContent ?? '',
    rows: [...card.querySelectorAll('.cz-skill')].map((r) => [r.dataset.skill, r.querySelector('.cz-skill-state')?.textContent, r.querySelector('.cz-style-desc')?.textContent]),
    button: card.querySelector('.cz-skills-install')?.textContent ?? null,
    notes: [...card.querySelectorAll('.cz-skill-note, .cz-skills-installed')].map((n) => n.textContent),
    worst: worstOf([...card.querySelectorAll('.cz-note, .cz-style-name, .cz-style-desc, .cz-badge, .cz-status, .flow-button')]),
    overflow: card.scrollWidth - card.clientWidth,
  };
})()`;

const TESTING = `(() => {${RATIO_FN}
  const view = document.getElementById('testing');
  if (!view || view.hidden) return null;
  const note = view.querySelector('.tst-note');
  return {
    state: PastelTerm.testing.state(),
    note: note.hidden ? '' : note.textContent,
    change: view.querySelector('.tst-changebox')?.hidden ? '' : view.querySelector('.tst-changebox')?.textContent ?? '',
    noSuite: view.querySelector('.tst-no-suite-title')?.textContent ?? null,
    seed: Boolean(view.querySelector('.tst-seed-suite')),
    ask: Boolean(view.querySelector('.tst-ask-suite')),
    chips: [...view.querySelectorAll('.tst-stage-name')].map((n) => n.textContent),
    confirm: view.querySelector('.tst-confirm')?.hidden ? null : [...view.querySelectorAll('.tst-confirm-list li')].map((li) => [li.querySelector('code')?.textContent, Boolean(li.querySelector('.tst-new'))]),
    worst: worstOf([...view.querySelectorAll('.tst-note span, .tst-link, .tst-stage-name, .tst-summary, .tst-title, .tst-no-suite-title, .tst-button:not(:disabled), .tst-picker-label, .tst-task-select')]),
  };
})()`;

export async function petalSkillsCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, themes, applyTheme, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} petal skills: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();

  // Stand-ins under the snapshot folder; nothing of hers is read or written.
  const root = path.join(outDir, 'petal-skills-fixture');
  const claudeDir = path.join(root, 'claude');
  const project = path.join(root, 'shop');
  fs.rmSync(root, { recursive: true, force: true });
  put(path.join(claudeDir, 'skills', 'prove-it', 'SKILL.md'), '---\nname: prove-it\ndescription: Hers.\n---\n');
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  put(path.join(project, 'package.json'), JSON.stringify({ name: 'shop', scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' }, devDependencies: { vitest: '^5.0.0', typescript: '^5.9.0' } }, null, 2));
  put(path.join(project, '.petal', '.gitignore'), '*\n');
  const pipelineFile = path.join(project, '.petal', 'pipeline.json');
  put(pipelineFile, `${JSON.stringify(CLAUDE_STAGES, null, 2)}\n`);
  put(path.join(project, '.petal', 'tasks.json'), JSON.stringify({ version: 2, prds: [], tasks: [{ id: 't-shop', title: 'Checkout', notes: '', status: 'open', owner: null, createdAt: Date.now(), claimedAt: null, doneAt: null, doneBy: null, prdId: null, parentId: null }] }));
  const suiteFile = path.join(project, '.petal', 'suites', 't-shop.json');
  stylesFixture.claudeDir = claudeDir;
  testingFixture.project = project;
  testingFixture.claudeDir = claudeDir;

  const showFormatting = async () => {
    await js("PastelTerm.customize.open('formatting')");
    return waitFor(() => js(SKILLS_CARD), 5000);
  };
  const scrollToSkills = () => js("document.querySelector('#customize .cz-skills').closest('.cz-card').scrollIntoView({ block: 'start' })");
  const openTesting = async (want: (p: Page) => boolean) => {
    await js('PastelTerm.overlays.hideCurrent()');
    await js("document.getElementById('testing-button').click()");
    return waitFor(async () => { const p: Page = await js(TESTING); return p && want(p) ? p : null; }, 6000);
  };

  try {
    await js('PastelTerm.welcome?.close?.()');
    await js('PastelTerm.overlays.hideCurrent()');
    resizeOffscreen(win, 1100, 900);

    // ---- Customize › Formatting › Petal skills.
    const bundle = skillsBundleDir();
    check(fs.readdirSync(bundle).sort().join() === 'petal-conclude,petal-library,petal-testing-suite', `the app carries all three skills: ${bundle}`);
    const before: Page = await showFormatting();
    check(before && JSON.stringify(before.rows.map((r: string[]) => [r[0], r[1]])) === JSON.stringify([['petal-conclude', 'Not installed'], ['petal-library', 'Not installed'], ['petal-testing-suite', 'Not installed']]), `all listed as not installed: ${JSON.stringify(before?.rows)}`);
    check(before?.button === 'Install' && /“library”/.test(await js("document.querySelector('#customize .cz-skill[data-skill=\"petal-library\"] .cz-style-name').textContent")), `Install offered, rows named by phrase: ${before?.button}`);
    await scrollToSkills();
    await capture('customize-skills');

    await js("document.querySelector('#customize .cz-skills-install').click()");
    const after: Page = await waitFor(async () => { const p: Page = await js(SKILLS_CARD); return p && p.rows.every((r: string[]) => r[1] === 'Installed') ? p : null; }, 5000);
    check(after && after.button === null && after.notes.join() === 'Installed. New Claude sessions pick them up.', `installed, button gone: ${JSON.stringify(after)}`);
    const libraryText = fs.readFileSync(path.join(claudeDir, 'skills', 'petal-library', 'SKILL.md'), 'utf8');
    const suiteText = fs.readFileSync(path.join(claudeDir, 'skills', 'petal-testing-suite', 'SKILL.md'), 'utf8');
    check(libraryText.includes(`\`${libraryDir()}\``) && !libraryText.includes(LIBRARY_DIR_TOKEN), `the Library path is filled in: ${libraryDir()}`);
    check(suiteText === fs.readFileSync(path.join(bundle, 'petal-testing-suite', 'SKILL.md'), 'utf8'), 'the testing suite skill is copied byte for byte');
    check(fs.readFileSync(path.join(claudeDir, 'skills', 'prove-it', 'SKILL.md'), 'utf8') === '---\nname: prove-it\ndescription: Hers.\n---\n' && fs.readdirSync(path.join(claudeDir, 'skills')).sort().join() === 'petal-conclude,petal-library,petal-testing-suite,prove-it', 'her own skill untouched, nothing else added');
    await scrollToSkills();
    await capture('customize-skills-installed');

    fs.appendFileSync(path.join(claudeDir, 'skills', 'petal-library', 'SKILL.md'), '\nMy own line.\n');
    await js('PastelTerm.customize.close()');
    const edited: Page = await showFormatting();
    check(edited && edited.rows.find((row: string[]) => row[0] === 'petal-library')?.[1] === 'Edited' && edited.button === null && /edited since Petal wrote it/.test(edited.notes.join()), `an edit shows as Edited and is never offered for update: ${JSON.stringify(edited?.rows)} ${JSON.stringify(edited?.notes)}`);

    for (const theme of Object.keys(themes)) {
      applyTheme(theme, { persist: false });
      await wait(150);
      const p: Page = await js(SKILLS_CARD);
      check(p && p.worst[0] >= MIN_RATIO && p.overflow <= 0, `${theme}: skills card ${p?.worst[0]}:1 ${JSON.stringify(p?.worst)}`);
    }
    applyTheme('paleSky', { persist: false });
    await js('PastelTerm.customize.close()');

    // ---- Testing: the project's old .petal/pipeline.json is only a seed for a task with no suite.
    store.savePipeline(project, { stages: [{ id: 'unit', name: 'Unit', command: 'npm test' }], keepGoing: true, autoRun: false, confirmed: ['npm test'], savedAt: Date.now() - 60_000 });
    const names = CLAUDE_STAGES.map((s) => s.name);
    const empty: Page = await openTesting((p) => p.state.task === 'Checkout' && p.seed);
    check(empty && empty.noSuite === 'No suite for this task yet' && empty.state.stages.length === 0 && empty.ask, `a task with no suite says so and offers the seed and Ask Claude: ${JSON.stringify(empty && { noSuite: empty.noSuite, seed: empty.seed, stages: empty.state.stages })}`);
    check(empty && !/project/i.test(empty.state.head), `the header names the task: ${empty?.state.head}`);
    check(empty && empty.worst[0] >= MIN_RATIO, `no-suite text contrast ${empty?.worst[0]}:1 ${JSON.stringify(empty?.worst)}`);
    await capture('testing-claude-pipeline');

    await js("document.querySelector('#testing .tst-seed-suite').click()");
    const seeded: Page = await waitFor(async () => { const p: Page = await js(TESTING); return p && p.state.stages.length === names.length ? p : null; }, 5000);
    const written = JSON.parse(fs.readFileSync(suiteFile, 'utf8')) as { stages: { name: string; command: string }[] };
    check(seeded && JSON.stringify(seeded.state.stages) === JSON.stringify(names) && JSON.stringify(written.stages) === JSON.stringify(CLAUDE_STAGES), `Start from the project's commands writes the task's suite file: ${JSON.stringify(seeded?.state.stages)}`);
    check(fs.readFileSync(pipelineFile, 'utf8') === `${JSON.stringify(CLAUDE_STAGES, null, 2)}\n`, 'the old pipeline file is left as it was');

    // New commands still ask before their first run; the one she confirmed before is not new. Nothing runs here.
    const runsBefore = testingFixture.runs.length;
    await js("document.querySelector('#testing .tst-head .tst-primary').click()");
    const asked: Page = await waitFor(async () => { const p: Page = await js(TESTING); return p?.confirm ? p : null; }, 5000);
    const expected = CLAUDE_STAGES.map((s) => [s.command, s.command !== 'npm test']);
    check(asked && JSON.stringify(asked.confirm) === JSON.stringify(expected) && testingFixture.runs.length === runsBefore, `the confirm names every command, new ones marked: ${JSON.stringify(asked?.confirm)}`);
    await js("[...document.querySelectorAll('#testing .tst-confirm .tst-button')].find((b) => b.textContent === 'Cancel').click()");

    // A change to the suite file from outside the task's testing agent is not applied: the stages stay and the reason shows.
    put(suiteFile, JSON.stringify({ stages: [{ name: 'Unit', command: 'npm test\nrm -rf ~' }] }));
    const refused: Page = await openTesting((p) => /not applied/.test(p.change));
    check(refused && refused.change === 'Changed outside the testing agent, not applied.' && refused.state.stages.length === names.length, `an outside change is refused and the suite stays: ${refused?.change}`);
  } finally {
    stylesFixture.claudeDir = null;
    testingFixture.project = null;
    testingFixture.claudeDir = null;
    await js('PastelTerm.customize.close()');
    await js('PastelTerm.overlays.hideCurrent()');
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
