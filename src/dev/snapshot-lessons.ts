// Lessons: a stubbed run (never a real claude) returns lessons in the same call as the Library; a repeat of the stand-in
// CLAUDE.md is dropped; cards render readable in every theme; Add to CLAUDE.md shows the diff and writes the fake home's
// CLAUDE.md under the heading only after the confirm; Merge with similar and Dismiss work, and nothing comes back on a rerun;
// Customize › Organizer shows and saves the Model for background work and the daily call line.
import fs from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import * as configStore from '../main/config-store';
import { queueSession } from '../main/library-extract';
import { folderFixture, libraryFixture } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { LESSONS_HEADING } from '../shared/lessons';

const MIN_RATIO = 4.5;
const SESSION = '1e550000-0000-4000-8000-000000000001';
// Fake lessons for a made-up project; no real data. The last repeats the stand-in CLAUDE.md, so it must be dropped.
const LESSONS = [
  { rule: 'Confirm which config file before editing', why: 'The user meant the staging config, and Claude edited production.', evidence: 'User: no, I meant the staging config, not prod', scope: 'project' },
  { rule: 'Run the tests before saying a change works', why: 'A broken build was reported as done.', evidence: 'User: you forgot to run the tests again', scope: 'global' },
  { rule: 'Run the tests before claiming a fix works', why: 'The fix was claimed before any check ran.', evidence: 'Claude: Fixed! (the test run after it failed)', scope: 'global' },
  { rule: 'Answer first: the point goes in sentence one.', why: 'She reads the first line only.', evidence: 'User: lead with the answer', scope: 'global' },
];
const CLAUDE_MD = '# Working preferences\n\n- Answer first: the point goes in sentence one.\n- Keep replies short.\n';

const line = (o: object) => `${JSON.stringify({ isSidechain: false, timestamp: new Date().toISOString(), ...o })}\n`;

const PROBE = `(() => {
  const view = document.getElementById('library');
  const rgb = (s) => (s.match(/[\\d.]+/g) ?? []).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const backOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c; } return [255, 255, 255]; };
  const ratio = (el) => { const a = lum(rgb(getComputedStyle(el).color)), b = lum(backOf(el)); const [hi, lo] = a > b ? [a, b] : [b, a]; return Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100; };
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const texts = [...view.querySelectorAll('.lsn-intro, .lsn-status, .lsn-rule, .lsn-why, .lsn-evidence, .lsn-meta > span, .lsn-meta .lib-chip, .lsn-open, .lsn-actions button, .lsn-targets button:not(:disabled), .lsn-add-file, .lsn-add-file code, .lsn-diff-line, .lsn-error, .lsn-empty .lib-empty-title, .lsn-empty .lib-empty-text, .lib-lessons-button')].filter(visible);
  const worst = texts.map((t) => [ratio(t), t.className || t.tagName, t.textContent.slice(0, 30)]).sort((a, b) => a[0] - b[0])[0] ?? [99];
  return {
    ...PastelTerm.library.state().lessons,
    dialHidden: view.querySelector('.lib-stage').hidden,
    minRatio: worst[0], worst, checked: texts.length,
    overflowX: Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, view.scrollWidth - view.clientWidth),
  };
})()`;

type Probe = { open: boolean; cards: { id: string; rule: string; merge: boolean }[]; diff: string[]; file: string; error: string; status: string; empty: string; dialHidden: boolean; minRatio: number; worst: unknown; checked: number; overflowX: number };

export async function lessonsCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, waitFor, wait, log, capture, applyTheme, themes, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} lessons: ${what}`);
  const shots = process.env.PETAL_LESSONS_SHOTS || path.join(outDir, 'lessons');
  fs.mkdirSync(shots, { recursive: true });
  const shoot = async (name: string) => { await capture(`lessons-${name}`); fs.copyFileSync(path.join(outDir, `snapshot-lessons-${name}.png`), path.join(shots, `${name}.png`)); };
  const probe = (): Promise<Probe> => js(PROBE);
  const settle = (want: (p: Probe) => boolean) => waitFor(async () => { const p = await probe(); return want(p) ? p : null; }, 6000);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);

  // A fake home and project in the run's scratch folder; what this step changes is put back after.
  const dir = path.join(outDir, 'lessons-fixture');
  fs.rmSync(dir, { recursive: true, force: true });
  const home = path.join(dir, 'home', '.claude');
  const project = path.join(dir, 'acme-api');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  const claudeMd = path.join(home, 'CLAUDE.md');
  fs.writeFileSync(claudeMd, CLAUDE_MD);
  const transcript = path.join(dir, `${SESSION}.jsonl`);
  fs.writeFileSync(transcript, line({ type: 'user', uuid: 'l1', cwd: project, message: { role: 'user', content: 'no, I meant the staging config, not prod' } })
    + line({ type: 'assistant', uuid: 'l2', cwd: project, message: { role: 'assistant', content: [{ type: 'text', text: 'Sorry, editing the staging config now.' }] } })
    + line({ type: 'user', uuid: 'l3', cwd: project, message: { role: 'user', content: 'you forgot to run the tests again' } }));
  const userData = app.getPath('userData');
  const keep = (name: string) => { const file = path.join(userData, name); return { file, text: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null }; };
  const kept = ['lessons.json', 'library-sessions.json', 'library-offsets.json', 'background-calls.json'].map(keep);
  const before = configStore.load();
  const saved = { home: folderFixture.home, extract: libraryFixture.extract };
  const prompts: string[] = [];
  const [startWidth, startHeight] = win.getContentSize();

  try {
    folderFixture.home = home;
    configStore.save({ library: { autoBuild: true }, lessons: { learn: true }, background: { model: 'haiku' } });
    libraryFixture.extract = async (prompt) => { prompts.push(prompt); return JSON.stringify({ result: JSON.stringify({ topics: [], lessons: LESSONS }) }); };
    resizeOffscreen(win, 1280, 900);
    await js('PastelTerm.getStarted.close()');
    await js('PastelTerm.overlays.hideCurrent()');

    // One call returns both shapes; the repeat of CLAUDE.md is dropped.
    const run = await queueSession({ sessionId: SESSION, transcript });
    check(prompts.length === 1 && /"topics": \[/.test(prompts[0] ?? '') && /"lessons": \[/.test(prompts[0] ?? ''), `one call asked for topics and lessons together: ${prompts.length} calls`);
    check(run.lessons === 3, `3 lessons kept, the CLAUDE.md repeat dropped: ${JSON.stringify(run)}`);

    await js('PastelTerm.library.openLessons()');
    const shown = await settle((p) => p.open && p.cards.length === 3);
    check(shown && shown.dialHidden, `Lessons replaces the dial with 3 cards: ${JSON.stringify(shown?.cards.map((c) => c.rule))}`);
    check(shown && !shown.cards.some((c) => c.rule.startsWith('Answer first')), 'the lesson already in CLAUDE.md has no card');
    check(shown && shown.cards.filter((c) => c.merge).length === 2, 'the two test lessons each offer Merge with similar');
    const detail = await js(`(() => { const c = document.querySelector('.lsn-card'); return { why: Boolean(c?.querySelector('.lsn-why')), evidence: c?.querySelector('.lsn-evidence')?.textContent ?? '', link: c?.querySelector('.lsn-open')?.textContent ?? '', scope: c?.querySelector('.lib-chip')?.textContent ?? '' }; })()`);
    check(detail.why && detail.evidence && detail.link === 'Open the session', `a card has why, evidence and a link to the session: ${JSON.stringify(detail)}`);
    check(shown && shown.overflowX <= 0, `no sideways scroll: ${shown?.overflowX}`);
    for (const id of Object.keys(themes)) {
      applyTheme(id, { persist: false });
      await wait(150);
      const p = await probe();
      check(p.minRatio >= MIN_RATIO && p.checked > 5, `${id} cards readable: ${p.minRatio}:1 over ${p.checked} texts ${JSON.stringify(p.worst)}`);
    }
    applyTheme('paleSky', { persist: false });
    await shoot('lessons');

    // Add to CLAUDE.md: the project file first (its scope), then the global one; nothing is written until the confirm.
    const projectCard = `.lsn-card[data-id="${shown?.cards.find((c) => c.rule.startsWith('Confirm'))?.id}"]`;
    await click(`${projectCard} .lsn-add-button`);
    const projectDiff = await settle((p) => p.diff.length > 0);
    check(projectDiff && projectDiff.file === path.join(project, 'CLAUDE.md') && projectDiff.diff.includes(`+ ${LESSONS_HEADING}`),
      `a project lesson previews its project's CLAUDE.md, heading made: ${JSON.stringify(projectDiff?.diff)}`);
    check(!fs.existsSync(path.join(project, 'CLAUDE.md')), 'the preview wrote nothing to the project');
    await click(`${projectCard} .lsn-targets [data-target="global"]`);
    const globalDiff = await settle((p) => p.file === claudeMd && p.diff.length > 0);
    check(globalDiff && globalDiff.diff.some((l) => l === '  - Keep replies short.') && globalDiff.diff.at(-1) === '+ - Confirm which config file before editing. Why: The user meant the staging config, and Claude edited production.',
      `the global preview shows context and the added line: ${JSON.stringify(globalDiff?.diff)}`);
    check(fs.readFileSync(claudeMd, 'utf8') === CLAUDE_MD, 'the fake home’s CLAUDE.md is unchanged before the confirm');
    for (const id of ['paleSky', ...Object.keys(themes).filter((t) => t !== 'paleSky')]) {
      applyTheme(id, { persist: false });
      await wait(150);
      const p = await probe();
      check(p.minRatio >= MIN_RATIO, `${id} diff readable: ${p.minRatio}:1 ${JSON.stringify(p.worst)}`);
    }
    applyTheme('paleSky', { persist: false });
    await js(`document.querySelector(${JSON.stringify(`${projectCard} .lsn-confirm`)})?.scrollIntoView({ block: 'end' })`); // the diff and its confirm in view
    await shoot('add-diff');
    await click(`${projectCard} .lsn-confirm`);
    const added = await settle((p) => p.cards.length === 2 && /^Added to /.test(p.status));
    const written = fs.readFileSync(claudeMd, 'utf8');
    check(added && written === `${CLAUDE_MD}\n${LESSONS_HEADING}\n\n- Confirm which config file before editing. Why: The user meant the staging config, and Claude edited production.\n`,
      `after the confirm, the line sits under the heading and nothing else changed: ${JSON.stringify(written.slice(CLAUDE_MD.length))}`);
    check(!fs.existsSync(path.join(project, 'CLAUDE.md')), 'the project CLAUDE.md was never written');

    // Merge with similar, then Dismiss: the list empties and shows its empty state.
    await click('.lsn-card .lsn-merge-button');
    await waitFor(() => js("Boolean(document.querySelector('.lsn-merge .lib-read'))"), 3000);
    await click('.lsn-merge .lib-read');
    const merged = await settle((p) => p.cards.length === 1);
    check(merged && !merged.cards[0]?.merge, `Merge folds the pair into one card: ${JSON.stringify(merged?.cards.map((c) => c.rule))}`);
    const mergedEvidence = await js("document.querySelector('.lsn-card .lsn-evidence')?.textContent ?? ''");
    check(mergedEvidence.includes(' · '), `the merged card carries both evidence lines: ${JSON.stringify(mergedEvidence)}`);
    await click('.lsn-card .lsn-dismiss');
    const dismissed = await settle((p) => p.cards.length === 0 && Boolean(p.empty));
    check(dismissed && /won’t come back/.test(dismissed.status), `Dismiss empties the list: ${JSON.stringify(dismissed?.empty)}`);

    // A rerun over new lines with the same answer brings none back: added, merged, dismissed and CLAUDE.md lines all count.
    fs.appendFileSync(transcript, line({ type: 'user', uuid: 'l4', cwd: project, message: { role: 'user', content: 'thanks' } }));
    const rerun = await queueSession({ sessionId: SESSION, transcript });
    check(prompts.length === 2 && !rerun.lessons, `a rerun with the same lessons adds none: ${JSON.stringify(rerun)}`);
    await js("document.getElementById('library').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    const back = await settle((p) => !p.open && !p.dialHidden);
    check(back, 'Esc goes back to the dial');
    await js('PastelTerm.library.close()');

    // Customize › Organizer: the switch and the model setting show and save; the call line sits under them.
    await js("PastelTerm.customize.open('organizer')");
    const setting = await waitFor(() => js(`(() => {
      const select = document.getElementById('cz-background-model');
      if (!select) return null;
      const learn = [...document.querySelectorAll('.cz-field')].find((f) => f.textContent.startsWith('Learn lessons from sessions'));
      return { options: [...select.options].map((o) => o.textContent), value: select.value, learn: learn?.querySelector('input')?.checked ?? null, calls: document.querySelector('.cz-background-calls')?.textContent ?? '' };
    })()`), 5000);
    check(setting && JSON.stringify(setting.options) === JSON.stringify(['Haiku', 'Sonnet', `Same as organizer (${configStore.load().organizer.model})`]) && setting.value === 'haiku',
      `the model setting offers Haiku, Sonnet, Same as organizer, on Haiku: ${JSON.stringify(setting)}`);
    check(setting && setting.learn === true && /^Background work used \d+ calls? today$/.test(setting.calls), `the Learn switch shows on and the call line shows: ${JSON.stringify(setting?.calls)}`);
    await js("(() => { const s = document.getElementById('cz-background-model'); s.value = 'sonnet'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
    const savedModel = await waitFor(() => configStore.load().background.model === 'sonnet', 3000);
    check(savedModel, `choosing Sonnet saves it: ${configStore.load().background.model}`);
    await js("document.getElementById('cz-background-model').scrollIntoView({ block: 'center' })");
    await shoot('model-setting');
    await js('PastelTerm.customize.close()');
  } finally {
    folderFixture.home = saved.home;
    libraryFixture.extract = saved.extract;
    configStore.save({ library: before.library, lessons: before.lessons, background: before.background });
    for (const { file, text } of kept) { if (text === null) fs.rmSync(file, { force: true }); else fs.writeFileSync(file, text); }
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
