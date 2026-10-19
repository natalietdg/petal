// Pictures in Claude's replies: paths and Markdown images become thumbnails in the reader, History and focus mode,
// open in a lightbox, and a missing one is a quiet chip. Run under a fake HOME: the fixture PNGs are written into it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nativeImage, type BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { writeLog } from './snapshot-history-fixture';
import { historyFixture } from '../main/snapshot-mode';
import { READING_CHOICES } from '../main/menu';

const SESSION = 'c1c1c1c1-0000-4000-8000-0000000000c1';
const THUMB_MAX_HEIGHT_PX = 420;
const EDGE_TOLERANCE_PX = 0.5;

// A pastel gradient with a diagonal band in a given hue, so each thumbnail is plainly a different picture.
function fixturePng(width: number, height: number, hue: [number, number, number]): Buffer {
  const bitmap = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const band = Math.abs(x - y * 1.4 - width * 0.15) < width * 0.06;
      const i = (y * width + x) * 4; // BGRA
      bitmap[i] = band ? hue[2] : 240 - (y / height) * 30;
      bitmap[i + 1] = band ? hue[1] : 225 + (x / width) * 20;
      bitmap[i + 2] = band ? hue[0] : 245;
      bitmap[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width, height }).toPNG();
}

const write = (file: string, bytes: Buffer): string => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
};

const replyText = (outside: string) => [
  '**The two screenshots are on your Desktop.**',
  '',
  'The pipeline view is `~/Desktop/petal-discord/1-testing-pipeline.png`, and the board is the second one.',
  '',
  '![Sessions board](~/Desktop/petal-discord/2-board.png)',
  '',
  'The repo copy lives at docs/reader.png in this session’s folder.',
  '',
  'The first draft at ~/Desktop/petal-discord/0-draft.png was deleted, and the logo stays a link: ![Petal logo](https://example.com/logo.png).',
  '',
  `A system icon is never shown: \`${outside}\``,
].join('\n');

const MEASURE = (scope: string) => `(() => [...document.querySelectorAll(${JSON.stringify(scope)})].map((prose) => {
  const column = prose.getBoundingClientRect();
  return {
    figures: [...prose.querySelectorAll('figure.reply-image')].map((f) => ({ state: f.dataset.state, path: f.dataset.path })),
    thumbs: [...prose.querySelectorAll('img.reply-image-thumb')].map((img) => { const r = img.getBoundingClientRect(); return { natural: img.naturalWidth, complete: img.complete, height: r.height, right: r.right, src: img.getAttribute('src') }; }),
    names: [...prose.querySelectorAll('.reply-image-name')].map((n) => n.textContent),
    buttons: [...prose.querySelectorAll('.reply-image-action')].map((b) => b.textContent),
    chips: [...prose.querySelectorAll('.reply-image-missing')].map((c) => ({ text: c.textContent, title: c.title })),
    remote: [...prose.querySelectorAll('a.reply-image-link')].map((a) => a.getAttribute('href')),
    remoteImgs: [...prose.querySelectorAll('img')].filter((img) => /^https?:/.test(img.getAttribute('src') || '')).length,
    columnRight: column.right,
    scrollWidth: prose.scrollWidth, clientWidth: prose.clientWidth,
    figureRights: [...prose.querySelectorAll('figure.reply-image, figure.reply-image *')].map((e) => e.getBoundingClientRect().right),
  };
}))()`;

interface Prose {
  figures: { state: string; path: string }[];
  thumbs: { natural: number; complete: boolean; height: number; right: number; src: string }[];
  names: string[];
  buttons: string[];
  chips: { text: string; title: string }[];
  remote: string[];
  remoteImgs: number;
  columnRight: number;
  scrollWidth: number;
  clientWidth: number;
  figureRights: number[];
}

export async function replyImagesCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, themes, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} reply images: ${what}`);

  const home = os.homedir();
  // Never her real Desktop: HOME must sit inside the snapshot folder (HOME=$PASTEL_SNAPSHOT_DIR/home).
  const fakeHome = !path.relative(fs.realpathSync(outDir), fs.realpathSync(home)).startsWith('..');
  check(fakeHome, `running under a fake HOME inside the snapshot folder: ${home}`);
  if (!fakeHome) return;
  const desktop = path.join(home, 'Desktop', 'petal-discord');
  write(path.join(desktop, '1-testing-pipeline.png'), fixturePng(1200, 760, [150, 110, 180]));
  write(path.join(desktop, '2-board.png'), fixturePng(900, 1400, [110, 160, 150])); // tall: held to 420px
  const repo = path.join(home, 'repo-fixture');
  write(path.join(repo, 'docs', 'reader.png'), fixturePng(640, 360, [190, 140, 110]));
  fs.rmSync(path.join(desktop, '0-draft.png'), { force: true });
  const outside = '/System/Library/CoreServices/Finder.app/Contents/Resources/Finder.png';
  const markdown = replyText(outside);

  await js('PastelTerm.getStarted.close()');
  const update = { state: 'live', cwd: repo, replies: [{ id: 'reply-images-new', timestamp: '2026-10-16T09:40:00.000Z', prompt: 'where are the screenshots?', markdown }] };
  const showSample = async () => {
    await js(`PastelTerm.reader.update(${JSON.stringify(update)})`);
    return waitFor(() => js("document.getElementById('latest').dataset.replyId === 'reply-images-new'"), 5000);
  };
  const settled = (scope: string) => waitFor(async () => {
    const all: Prose[] = await js(MEASURE(scope));
    const withFigures = all.filter((p) => p.figures.length);
    return withFigures.length && withFigures.every((p) => p.figures.every((f) => f.state !== 'loading')) ? withFigures : null;
  }, 8000);

  check(await showSample(), 'sample reply shown');
  await js("document.querySelectorAll('#latest figure.reply-image').forEach((f) => f.scrollIntoView())"); // lazy thumbnails load once near view
  const reader = (await settled('#latest .prose'))?.[0];
  check(reader, 'every picture in the reader settled');
  const shown = reader?.figures.filter((f) => f.state === 'shown') ?? [];
  check(shown.length === 3, `three thumbnails shown (inline code, Markdown image, relative path): ${JSON.stringify(reader?.figures)}`);
  check(reader?.thumbs.every((t) => !t.src || t.src.startsWith('petal-img://local/')), 'every thumbnail loads through petal-img:// only');
  check(reader?.thumbs.filter((t) => t.natural > 0).every((t) => t.height <= THUMB_MAX_HEIGHT_PX + EDGE_TOLERANCE_PX && t.right <= (reader?.columnRight ?? 0) + EDGE_TOLERANCE_PX), `thumbnails at most ${THUMB_MAX_HEIGHT_PX}px tall and inside the column: ${JSON.stringify(reader?.thumbs.map((t) => [t.natural, Math.round(t.height)]))}`);
  check(['1-testing-pipeline.png', '2-board.png', 'reader.png'].every((name) => reader?.names.includes(name)), `filename captions: ${JSON.stringify(reader?.names)}`);
  check(reader?.buttons.filter((b) => b === 'Show in Finder').length === 3 && reader.buttons.filter((b) => b === 'Open').length === 3, 'Show in Finder and Open under each');
  check(reader?.chips.some((c) => c.text === 'image not found: 0-draft.png'), `missing file: a muted chip, no broken image: ${JSON.stringify(reader?.chips)}`);
  check(reader?.chips.some((c) => c.text === 'image not shown: Finder.png'), 'a system file is refused with its own chip');
  check(reader?.remote.includes('https://example.com/logo.png') && reader.remoteImgs === 0, `remote image kept as a link, never loaded: ${JSON.stringify(reader?.remote)}`);
  check((await js("document.querySelectorAll('#latest .reply-image-open:focus-visible, #latest button.reply-image-open').length")) === 3, 'each thumbnail is a button (keyboard reachable)');

  // Lightbox: opens on the thumbnail, arrows step through this reply's pictures, Esc closes and focus returns.
  const box = "(() => { const b = document.querySelector('.reply-lightbox'); const img = b?.querySelector('img'); return b ? { caption: b.querySelector('.reply-lightbox-caption').textContent, natural: img.naturalWidth, focused: b.contains(document.activeElement) } : null; })()";
  await js("document.querySelector('#latest .reply-image-open').focus(); document.querySelector('#latest .reply-image-open').click()");
  const opened = await waitFor(async () => { const b = await js(box); return b?.natural ? b : null; }, 3000);
  check(opened?.caption === '1-testing-pipeline.png · 1 of 3' && opened.focused, `lightbox opens on the first picture: ${JSON.stringify(opened)}`);
  await capture('reply-images-lightbox');
  const key = (name: string) => js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(name)}, bubbles: true, cancelable: true }))`);
  await key('ArrowRight');
  const stepped = await waitFor(async () => { const b = await js(box); return b?.caption.startsWith('2-board.png') && b.natural ? b : null; }, 3000);
  check(stepped?.caption === '2-board.png · 2 of 3', `ArrowRight steps to the next picture: ${JSON.stringify(stepped)}`);
  await key('ArrowLeft');
  await key('ArrowLeft');
  check((await js(box))?.caption === 'reader.png · 3 of 3', 'ArrowLeft wraps round to the last');
  await key('Escape');
  const afterEsc = await js("({ open: Boolean(document.querySelector('.reply-lightbox')), focus: document.activeElement?.className })");
  check(!afterEsc.open && afterEsc.focus === 'reply-image-open', `Esc closes it and focus returns to the thumbnail: ${JSON.stringify(afterEsc)}`);
  await js("document.querySelector('#latest .reply-image-open').click()");
  await waitFor(() => js("Boolean(document.querySelector('.reply-lightbox'))"), 3000);
  await js("document.querySelector('.reply-lightbox').click()");
  check(!(await js("Boolean(document.querySelector('.reply-lightbox'))")), 'a click on the veil closes it too');

  // Every look and theme: thumbnails shown, nothing wider than the column.
  // The pictures' own boxes only: a long unbreakable inline-code path can already push the prose wider, before this feature.
  const fits = (p: Prose) => p.figureRights.every((right) => right <= p.columnRight + EDGE_TOLERANCE_PX) && p.thumbs.every((t) => t.right <= p.columnRight + EDGE_TOLERANCE_PX && t.height <= THUMB_MAX_HEIGHT_PX + EDGE_TOLERANCE_PX);
  for (const [look] of READING_CHOICES) {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
    await showSample();
    await js("document.querySelectorAll('#latest figure.reply-image').forEach((f) => f.scrollIntoView())");
    const prose = await settled('#latest .prose');
    check(prose?.every(fits) && prose[0]?.figures.filter((f) => f.state === 'shown').length === 3, `${look}: three thumbnails, no overflow: ${JSON.stringify(prose?.map((p) => ({ scroll: [p.scrollWidth, p.clientWidth], col: Math.round(p.columnRight), thumbs: p.thumbs.map((t) => [Math.round(t.right), Math.round(t.height), t.natural]), figures: Math.round(Math.max(...p.figureRights)), states: p.figures.map((f) => f.state)})))}`);
  }
  await js("window.pastel.look.setReading('newspaper')");
  for (const theme of Object.keys(themes)) {
    applyTheme(theme, { persist: false });
    await showSample();
    await wait(200);
    await js("document.querySelectorAll('#latest figure.reply-image').forEach((f) => f.scrollIntoView())");
    const prose = await settled('#latest .prose');
    check(prose?.every(fits) && prose[0]?.figures.filter((f) => f.state === 'shown').length === 3, `${theme}: three thumbnails, no overflow: ${JSON.stringify(prose?.map((p) => ({ scroll: [p.scrollWidth, p.clientWidth], col: Math.round(p.columnRight), states: p.figures.map((f) => f.state)})))}`);
  }
  applyTheme('paleSky', { persist: false });

  // Focus mode: the same reply, the same thumbnails, the lightbox's Esc does not leave focus.
  await js('PastelTerm.focusMode.set(true)');
  await showSample();
  await js("document.querySelectorAll('#latest figure.reply-image').forEach((f) => f.scrollIntoView())");
  const focused = (await settled('#latest .prose'))?.[0];
  check(await js('PastelTerm.focusMode.isOn()') && focused?.figures.filter((f) => f.state === 'shown').length === 3, 'focus mode: three thumbnails');
  await js("document.querySelector('#latest .reply-image-open').click()");
  await waitFor(() => js("Boolean(document.querySelector('.reply-lightbox'))"), 3000);
  await key('Escape');
  check(!(await js("Boolean(document.querySelector('.reply-lightbox'))")) && await js('PastelTerm.focusMode.isOn()'), 'focus mode: Esc closes the lightbox and stays in focus');
  // A crop of the reply in focus mode for the report: the board thumbnail, the relative one and both chips.
  await js("document.querySelector('#latest .reply-image-missing').scrollIntoView({ block: 'end' })");
  win.webContents.invalidate();
  await wait(700);
  const rect = await js("(() => { const r = document.querySelector('#latest .prose').getBoundingClientRect(); return { x: Math.max(0, Math.floor(r.left) - 16), y: 0, width: Math.ceil(r.width) + 32, height: window.innerHeight }; })()");
  fs.writeFileSync(path.join(outDir, 'snapshot-reply-images-inline.png'), (await win.webContents.capturePage(rect)).toPNG());
  log(`captured reply-images-inline: ${JSON.stringify(rect)}`);

  await capture('reply-images-focus');
  await js('PastelTerm.focusMode.set(false)');

  // History preview: the same reply from a session log, relative path against the session's cwd.
  const previous = { records: historyFixture.records, live: historyFixture.live };
  const file = path.join(outDir, 'reply-images-fixture', `${SESSION}.jsonl`);
  writeLog(file, 'where are the screenshots?', markdown);
  historyFixture.records = [{ sessionId: SESSION, file, cwd: repo, title: 'Screenshots on the Desktop', firstPrompt: 'where are the screenshots?', lastAt: Date.now(), messages: 2, messagesExact: true }];
  historyFixture.live = [];
  try {
    await js('PastelTerm.layout.setTerminalMinimised(true, false)'); // room for the preview in the capture
    await js(`PastelTerm.history.open().then(() => { PastelTerm.history.select(${JSON.stringify(SESSION)}); return PastelTerm.history.setPreviewMode('replies'); })`);
    await waitFor(() => js("document.querySelectorAll('#history figure.reply-image').length > 0"), 5000);
    await js("document.querySelectorAll('#history figure.reply-image').forEach((f) => f.scrollIntoView())");
    const history = (await settled('#history .history-reply .prose'))?.[0];
    check(history?.figures.filter((f) => f.state === 'shown').length === 3 && history.chips.length === 2, `History preview: three thumbnails and two chips: ${JSON.stringify(history?.figures)}`);
    await js("document.querySelector('#history .reply-image-open').click()");
    const historyBox = await waitFor(async () => { const b = await js(box); return b?.natural ? b : null; }, 3000);
    check(historyBox?.caption.endsWith('1 of 3'), `History preview: lightbox opens: ${JSON.stringify(historyBox)}`);
    await key('Escape');
    check(await js('PastelTerm.history.isOpen()'), 'History stays open after Esc closes the lightbox');
    await js("document.querySelector('#history figure.reply-image')?.scrollIntoView({ block: 'center' })");
    win.webContents.invalidate();
    await capture('reply-images-history');
  } finally {
    await js('PastelTerm.history.close()');
    await js('PastelTerm.layout.setTerminalMinimised(false, false)');
    historyFixture.records = previous.records;
    historyFixture.live = previous.live;
  }
}
