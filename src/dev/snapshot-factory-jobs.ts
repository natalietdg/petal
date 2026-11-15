// Factory jobs on the Board and in the Waiting lane (PASTEL_SNAPSHOT_MODE=factory-jobs): one fixture session in a
// background tab started four jobs (approve, escalated, building, done). Its Board card rolls them up as
// "3 jobs · 2 waiting", the lane holds one job row per wait, and a job row opens Factory › Jobs on that job. Light and dark.
// seedJobs() is shared with the factory check, which drives the Jobs screen itself.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit, TabsDeps } from './snapshot';
import { assertFixtureOutsideClaude } from './snapshot-views';
import { petalDirOf } from './snapshot-testing';
import { extraTabFixtures, factoryFixture, fakeHomeDir } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { defaultFactory } from '../shared/factory';
import { repoKey } from '../main/petal-repos';
import type { Job, JobState } from '../shared/factory-jobs';

const PARENT_ID = '7a17e0f1-0000-4000-8000-00000000f001';
const THEMES = ['paleSky', 'nightPastel'];
const WIDTH = 990;

export interface SeededJob { id: string; state: JobState; title: string }

// Four jobs for `repo`, filed where Petal keeps them, with the hand-off files each state implies.
export function seedJobs(repo: string, parentSessionId: string | null): SeededJob[] {
  const root = path.join(petalDirOf(repo), 'factory', 'jobs');
  fs.rmSync(root, { recursive: true, force: true });
  const now = Date.now();
  const f = defaultFactory();
  const make = (id: string, title: string, state: JobState, minutesAgo: number, extra: Partial<Job>, files: Record<string, string>): SeededJob => {
    const at = now - minutesAgo * 60_000;
    const job: Job = {
      version: 1, id, repo, ask: title, title, state, createdAt: at - 60_000, updatedAt: at, progressAt: now, rework: 0, reworkCap: 2,
      askedQuestions: false, stations: f.stations, reviewers: f.reviewers, risky: f.risky, riskyHits: [], shipMode: 'local-merge',
      branch: `factory/${id}`, worktree: path.join(fakeHomeDir(), '.petal', 'worktrees', repoKey(repo), id), parentSessionId, childSessionIds: [],
      blocked: null, guidance: null, merge: null, prUrl: null, events: [{ at, from: 'reviewing', to: state }], ...extra,
    };
    const dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'job.json'), `${JSON.stringify(job, null, 2)}\n`);
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    return { id, state, title };
  };
  return [
    make('20261115-login-rate-limit', 'Add a rate limit to login', 'approve', 12, { riskyHits: [{ file: 'src/auth/session.ts', label: 'auth' }] },
      { 'spec.md': 'STATUS: ready\n', 'build.md': 'STATUS: done · limiter added\n', 'review-ux.md': 'VERDICT: PASS\n', 'review-code.md': 'VERDICT: PASS\n', 'review-security.md': 'VERDICT: PASS · limit is per account\n' }),
    make('20261115-export-csv', 'Export the board as CSV', 'escalated', 30, { rework: 2 },
      { 'spec.md': 'STATUS: ready\n', 'build.md': 'STATUS: done\n', 'review-ux.md': 'VERDICT: PASS\n', 'review-code.md': 'VERDICT: FAIL · no test for empty boards\n', 'review-security.md': 'VERDICT: PASS\n' }),
    make('20261115-tidy-readme', 'Tidy the README headings', 'building', 2, {}, { 'spec.md': 'STATUS: ready\n', 'build.md': 'STATUS: working\n' }),
    make('20261114-fix-typo', 'Fix the typo in the footer', 'done', 600, { merge: { base: 'a'.repeat(40), commit: 'b'.repeat(40), at: now - 600 * 60_000 } }, { 'build.md': 'STATUS: done\n' }),
  ];
}

const MEASURE = (parent: string) => `(() => {
  const card = document.querySelector('#board .board-card[data-session-id="${parent}"]');
  const rows = [...document.querySelectorAll('#waiting .waiting-row.waiting-job')].map((r) => ({ text: r.querySelector('.waiting-text')?.textContent ?? '', session: r.querySelector('.waiting-session')?.textContent ?? '' }));
  return { card: Boolean(card), jobs: card?.querySelector('.board-jobs')?.textContent ?? '', rows, badge: document.querySelector('#board-button .dock-badge')?.textContent ?? '', asking: document.getElementById('cat')?.classList.contains('asking') ?? false };
})()`;

export async function factoryJobsCheck(kit: Kit, { win, openTab }: Pick<TabsDeps, 'openTab'> & { win: BrowserWindow }): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} factory jobs: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  const dir = path.join(outDir, 'factory-jobs');
  const repo = path.join(dir, 'shop');
  const startTabs: string[] = await js('PastelTerm.tabs.ids()');
  const saved = { ...factoryFixture };
  await js('PastelTerm.getStarted.close()');
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    const transcript = path.join(dir, `${PARENT_ID}.jsonl`);
    assertFixtureOutsideClaude(transcript);
    const at = new Date().toISOString();
    fs.writeFileSync(transcript, [
      { type: 'user', uuid: 'fj-u', timestamp: at, isSidechain: false, message: { role: 'user', content: '/factory add a rate limit to login' } },
      { type: 'assistant', uuid: 'fj-a', timestamp: at, isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text: '**The job is running on its own branch.**\n\n**Doing:** nothing, the job runs on its own' }] } },
    ].map((l) => JSON.stringify(l)).join('\n') + '\n');
    extraTabFixtures.push({ sessionId: PARENT_ID, transcript, status: 'idle', cwd: repo });
    openTab(win.webContents, { background: true });
    const seeded = seedJobs(repo, PARENT_ID);
    Object.assign(factoryFixture, { repo });

    const tabReady = await waitFor(() => js(`PastelTerm.tabs.ids().some((t) => PastelTerm.tabs.get(t)?.update?.sessionId === ${JSON.stringify(PARENT_ID)})`), 15000);
    check(tabReady, 'the fixture session that started the jobs has a tab');
    resizeOffscreen(win, WIDTH, 900);
    await js('PastelTerm.sessionsBoard.resetFilters()');
    await js('PastelTerm.waiting.open()');
    await win.webContents.capturePage();

    for (const theme of THEMES) {
      applyTheme(theme, { persist: false });
      await wait(300);
      if (!(await js('PastelTerm.waiting.isOpen()'))) await js('PastelTerm.waiting.open()');
      const m = await waitFor(async () => {
        const got = await js(MEASURE(PARENT_ID)) as { card: boolean; jobs: string; rows: { text: string; session: string }[]; badge: string; asking: boolean };
        return got.card && got.rows.length >= 2 && got.jobs ? got : null;
      }, 10000) as { card: boolean; jobs: string; rows: { text: string; session: string }[]; badge: string; asking: boolean } | null;
      log(`factory jobs ${theme}: ${JSON.stringify(m)}`);
      check(m?.jobs === '3 jobs · 2 waiting', `${theme} the parent card rolls up its jobs: ${JSON.stringify(m?.jobs)}`);
      const texts = m?.rows.map((r) => r.text) ?? [];
      check(texts.includes('Approve merge · touches auth (src/auth/session.ts)') && texts.includes('Stuck after 2 tries · code: no test for empty boards'), `${theme} one lane row per waiting job: ${JSON.stringify(texts)}`);
      check(texts.length === 2, `${theme} working and finished jobs make no row`);
      check(m?.rows.every((r) => r.session.startsWith('shop · ')), `${theme} each job row names its repo and job`);
      check(!(await js("[...document.querySelectorAll('#waiting .waiting-row.waiting-job .waiting-where')].length")), `${theme} a job row never says other window`);
      check(Number(m?.badge) >= 2, `${theme} the Board badge counts the job rows: ${JSON.stringify(m?.badge)}`);
      check(m?.asking, `${theme} the cat holds its "!" while a job waits`);
      await capture(`factory-jobs-board-${theme}`);
    }

    // A job row opens Factory › Jobs with that job's buttons focused.
    await js("document.querySelector('#waiting .waiting-row.waiting-job').click()");
    const opened = await waitFor(() => js(`(() => { const a = document.activeElement; return Boolean(document.querySelector('#customize .fj')) && Boolean(a?.closest('.fj-job')) ? a.closest('.fj-job').dataset.job : null; })()`), 8000);
    check(opened && seeded.some((s) => s.id === opened && (s.state === 'approve' || s.state === 'escalated')), `a job row opens Factory › Jobs on that job: ${JSON.stringify(opened)}`);
    await capture('factory-jobs-opened');
  } finally {
    extraTabFixtures.length = 0;
    await js('PastelTerm.customize.close()');
    if (await js('PastelTerm.waiting.isOpen()')) await js('PastelTerm.waiting.close()');
    Object.assign(factoryFixture, saved);
    fs.rmSync(path.join(petalDirOf(repo), 'factory'), { recursive: true, force: true }); // the lane drops the rows on the next tick
    const opened: string[] = (await js('PastelTerm.tabs.ids()')).filter((id: string) => !startTabs.includes(id));
    for (const id of opened) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(id)})`);
    check(await waitFor(async () => ((await js('PastelTerm.tabs.ids()')).length === startTabs.length ? true : null), 8000), 'test tab closed again');
    check(await waitFor(async () => (!(await js("document.getElementById('cat')?.classList.contains('asking')")) ? true : null), 8000), 'the cat lets go of its "!" once no job waits');
    fs.rmSync(dir, { recursive: true, force: true });
    applyTheme('paleSky', { persist: false });
    resizeOffscreen(win, startWidth, startHeight);
  }
}
