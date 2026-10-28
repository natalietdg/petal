// The reader's Confirmed tab: Verified (Screens, Features, Facts), Decided, Done and In progress from a sample session, light and dark.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { pictureRoot } from './snapshot-reply-images';
import { resizeTo } from './snapshot-tables';
import { resizeOffscreen } from '../main/snapshot-window';

const THEMES = ['paleSky', 'nightPastel']; // one light, one dark
const WIDTH = 990;
const TALL_HEIGHT = 1900;
const SAMPLE_PNG = 'build/icon.iconset/icon_128x128.png'; // the app icon, already in the repo

const NEWEST = [
  '**The export button is half built.**',
  '',
  'The button shows in the toolbar; the save dialog is next.',
  '',
  '**Doing:** wiring the export button to the save dialog',
  '**Next:** pick the file formats',
  '',
  '**Checked:** the toolbar renders in both themes, 4 of 4 layout checks pass.',
  '**Verified:** the export button opens the save dialog.',
  '',
  '**Decide:** CSV only, or CSV and JSON?',
].join('\n');

const middle = (screen: string): string => [
  '**Settings now save when the window closes.**',
  '',
  `![Settings screen](${screen})`,
  '',
  '**Done:** the settings file is written on quit.',
  '',
  '```md',
  '**Done:** a sample inside code, never listed',
  '```',
  '',
  '**Checked:** `npm test` passes, 52 of 52.',
  '',
  '**Decide:** keep the old settings file as a backup?',
].join('\n');

const OLDEST = [
  '**Conclusion:** the toolbar is simpler.',
  '**Result:** the colour picker moved from the toolbar into Settings.',
  '**Impact:** one less button on the main screen.',
].join('\n');

const sampleUpdate = (screen: string) => ({
  state: 'live',
  replies: [
    { id: 'confirmed-3', timestamp: '2026-10-28T10:30:00.000Z', prompt: 'yes, keep one backup', markdown: NEWEST },
    { id: 'confirmed-2', timestamp: '2026-10-28T10:10:00.000Z', prompt: 'make settings save on close', markdown: middle(screen) },
    { id: 'confirmed-1', timestamp: '2026-10-28T09:50:00.000Z', prompt: 'tidy the toolbar', markdown: OLDEST },
  ],
});

const EXPECTED = { screens: 1, features: 1, facts: 2, decided: 1, done: 2, progress: 2 };

// Group titles in order, item counts, and the pills with their painted colours.
const MEASURE = `(() => {
  const view = document.getElementById('confirmed-view');
  const groups = [...view.querySelectorAll('.confirmed-group')];
  const count = (key) => view.querySelectorAll('.confirmed-' + key + ' .confirmed-item').length;
  const part = (key) => { const h = view.querySelector('.confirmed-part-' + key); const list = h && h.nextElementSibling; return list ? list.querySelectorAll('.confirmed-item').length : 0; };
  const thumbs = [...view.querySelectorAll('.confirmed-screens img.confirmed-thumb')];
  const pill = (cls) => { const p = view.querySelector('.' + cls); return p ? { text: p.textContent, bg: getComputedStyle(p).backgroundColor } : null; };
  const answer = view.querySelector('.confirmed-decided .confirmed-answer');
  return {
    titles: groups.map((g) => g.querySelector('.confirmed-title').textContent),
    subtitles: [...view.querySelectorAll('.confirmed-verified .confirmed-subtitle')].map((h) => h.textContent),
    thumbs: thumbs.map((t) => ({ natural: t.naturalWidth, width: Math.round(t.getBoundingClientRect().width), height: Math.round(t.getBoundingClientRect().height) })),
    capitalised: [...view.querySelectorAll('.confirmed-text')].every((t) => t.firstChild?.nodeType !== 3 || !/^[a-z]/.test(t.firstChild.textContent)), // code at the start stays as written
    counts: { screens: part('screens'), features: part('features'), facts: part('facts'), decided: count('decided'), done: count('done'), progress: count('progress') },
    progressPill: pill('confirmed-pill-progress'), waitingPill: pill('confirmed-pill-waiting'),
    answer: answer ? answer.textContent : null,
    codeInText: view.querySelectorAll('.confirmed-verified .confirmed-text code').length,
    fencedDone: view.textContent.includes('never listed'),
    visible: !view.hidden && view.getBoundingClientRect().height > 100,
  };
})()`;

// The last In progress card ends above the reader's bottom edge.
const FITS = "document.querySelector('#confirmed-view .confirmed-progress .confirmed-item:last-child').getBoundingClientRect().bottom <= document.getElementById('reader').getBoundingClientRect().bottom";
const SHOWN = "document.getElementById('confirmed-view').textContent.includes('Wiring the export button')";

// The fake-home script puts HOME and the snapshot folder side by side in one scratch folder; her real HOME never is.
function sideBySideHome(outDir: string): boolean {
  const rel = path.relative(fs.realpathSync(path.dirname(outDir)), fs.realpathSync(os.homedir()));
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.includes(path.sep);
}

export async function confirmedCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} confirmed: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  await js('PastelTerm.getStarted.close()'); // a fresh profile opens on Get started, over the reader

  const place = sideBySideHome(kit.outDir) ? { root: os.homedir() } : pictureRoot(kit.outDir);
  const source = path.join(app.getAppPath(), SAMPLE_PNG);
  if ('skip' in place || !fs.existsSync(source)) {
    log(`FAIL confirmed: no place for the sample screen (${'skip' in place ? place.skip : `missing ${source}`})`);
    return;
  }
  // A scratch HOME gets it as ~/; under her real HOME it sits under the snapshot folder, as an absolute path.
  const screenDir = path.join(place.root, 'Desktop', 'petal-confirmed-sample');
  fs.mkdirSync(screenDir, { recursive: true });
  fs.copyFileSync(source, path.join(screenDir, 'settings.png'));
  const screen = place.root === os.homedir() ? '~/Desktop/petal-confirmed-sample/settings.png' : path.join(screenDir, 'settings.png');

  // The fixture feed can redraw its own replies; re-send the sample whenever it is gone.
  const showSample = async () => {
    await js("PastelTerm.reader.setView('confirmed')");
    if (await js(SHOWN)) return true;
    await js(`PastelTerm.reader.update(${JSON.stringify(sampleUpdate(screen))})`);
    return waitFor(() => js(SHOWN), 5000);
  };
  check(await showSample(), 'sample session shown on the Confirmed tab');
  check(await resizeTo(kit, win, WIDTH), `window resized to ${WIDTH}px`);
  check(await js("document.querySelector('#reader-head .view-toggle [data-view=\"confirmed\"]').getAttribute('aria-selected') === 'true'"), 'Confirmed button is the selected tab');

  const wasMinimised = await js('PastelTerm.layout.isTerminalMinimised()');
  await js('PastelTerm.layout.setTerminalMinimised(true, false)'); // the whole height for the reader, so all four groups fit
  await win.webContents.capturePage(); // warm-up: the run's first offscreen frame can be stale
  for (const theme of THEMES) {
    applyTheme(theme, { persist: false });
    await wait(300);
    check(await showSample(), `${theme} sample shown`);
    await waitFor(() => js("[...document.querySelectorAll('#confirmed-view img.confirmed-thumb')].every((t) => t.complete)"), 5000);
    const m = await js(MEASURE) as { titles: string[]; subtitles: string[]; thumbs: { natural: number; width: number; height: number }[]; capitalised: boolean; counts: Record<string, number>; progressPill: { text: string; bg: string } | null; waitingPill: { text: string; bg: string } | null; answer: string | null; codeInText: number; fencedDone: boolean; visible: boolean };
    log(`confirmed ${theme}: ${JSON.stringify(m)}`);
    check(m.visible, `${theme} Confirmed page is visible`);
    check(m.titles.join(',') === 'Verified,Decided,Done,In progress', `${theme} four groups in order`);
    check(m.subtitles.join(',') === 'Screens,Features,Facts', `${theme} Verified has Screens, Features and Facts`);
    check(JSON.stringify(m.counts) === JSON.stringify(EXPECTED), `${theme} item counts ${JSON.stringify(EXPECTED)}`);
    check(m.thumbs.length === 1 && m.thumbs.every((t) => t.natural > 0 && t.width > 0 && t.height > 0), `${theme} one screen thumbnail, loaded with a nonzero size`);
    check(m.capitalised, `${theme} every item starts with a capital letter`);
    check(m.progressPill?.text === 'In progress' && m.progressPill.bg !== 'rgba(0, 0, 0, 0)', `${theme} In progress pill shows with a fill`);
    check(m.waitingPill?.text === 'Waiting on you' && m.waitingPill.bg !== m.progressPill?.bg, `${theme} Waiting on you pill has its own fill`);
    check(m.answer === 'You: yes, keep one backup', `${theme} decision shows her answer`);
    check(m.codeInText === 1, `${theme} inline code renders in an item`);
    check(!m.fencedDone, `${theme} a label inside a code fence is not listed`);
    resizeOffscreen(win, WIDTH, TALL_HEIGHT); // tall enough for all four groups
    await wait(300);
    let pictured = false;
    for (let attempt = 0; attempt < 3 && !pictured; attempt++) {
      await showSample();
      await js("document.getElementById('reader').scrollTop = 0");
      await capture(`confirmed-${theme}`);
      pictured = Boolean(await js(SHOWN));
    }
    check(pictured, `${theme} picture shows the sample session`);
    check(await js(FITS), `${theme} every group fits in the picture`);
  }

  const JUMPED = `(() => ({
    replies: !document.getElementById('replies-view').hidden,
    confirmedHidden: document.getElementById('confirmed-view').hidden,
    selected: document.querySelector('#reader-head .view-toggle [aria-selected="true"]').dataset.view,
    flashed: Boolean(document.querySelector('[data-reply-id="confirmed-2"].flash')),
  }))()`;
  for (const [what, selector] of [['an item', '.confirmed-done .confirmed-item'], ['a screen', '.confirmed-screen']]) {
    await showSample();
    await js(`document.querySelectorAll('.flash').forEach((n) => n.classList.remove('flash')); document.querySelector('#confirmed-view ${selector}').click()`); // a fresh flash, not the last one's
    const jumped = await js(JUMPED) as { replies: boolean; confirmedHidden: boolean; selected: string; flashed: boolean };
    log(`confirmed jump from ${what}: ${JSON.stringify(jumped)}`);
    check(jumped.replies && jumped.confirmedHidden && jumped.selected === 'replies', `clicking ${what} switches to Replies`);
    check(jumped.flashed, `clicking ${what} flashes its reply`);
  }

  await js("PastelTerm.reader.setView('replies')");
  await js(`PastelTerm.layout.setTerminalMinimised(${Boolean(wasMinimised)}, false)`);
  applyTheme('paleSky', { persist: false }); // back to the baseline look for the steps after
  resizeOffscreen(win, startWidth, startHeight);
}
