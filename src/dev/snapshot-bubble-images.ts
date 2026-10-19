// Pictures in her message: a pasted image's path becomes a thumbnail in the reader and History, opens larger, never overflows.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, nativeImage, type BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { resizeTo } from './snapshot-tables';
import { writeLog } from './snapshot-history-fixture';
import { PASTE_DIR_NAME } from '../main/paste-files';
import { historyFixture } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { READING_CHOICES } from '../main/menu';
import { quotePath } from '../shared/quote-path';

const SESSION = 'b1b1b1b1-0000-4000-8000-0000000000b1';
const NARROW = 800;
const EDGE_TOLERANCE_PX = 0.5;
const THUMB_MAX_PX = 240;

// A 480x300 pastel gradient with a darker band, so the thumbnail is plainly a picture.
function fixturePng(): Buffer {
  const [width, height] = [480, 300];
  const bitmap = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const band = Math.abs(x - y * 1.6 - 60) < 28;
      const i = (y * width + x) * 4; // BGRA
      bitmap[i] = band ? 150 : 235 - (y / height) * 40;
      bitmap[i + 1] = band ? 110 : 200 + (x / width) * 30;
      bitmap[i + 2] = band ? 140 : 245;
      bitmap[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width, height }).toPNG();
}

const isInside = (child: string, parent: string): boolean => {
  const relative = path.relative(fs.realpathSync(parent), fs.realpathSync(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

// A real image outside home and temp that every Mac has, for the refusal check.
function outsideImage(): string | null {
  const root = '/System/Library/CoreServices';
  for (const bundle of fs.readdirSync(root).filter((name) => name.endsWith('.app')).sort()) {
    const resources = path.join(root, bundle, 'Contents', 'Resources');
    const png = fs.existsSync(resources) ? fs.readdirSync(resources).find((name) => name.endsWith('.png') && !name.includes(' ')) : undefined;
    if (png) return path.join(resources, png);
  }
  return null;
}

// Each bubble with pictures: what it shows, its sizes, and where its edges are.
const MEASURE = (scope: string) => `(() => [...document.querySelectorAll(${JSON.stringify(scope)})].map((b) => ({
  latest: Boolean(b.closest('#latest')),
  text: b.textContent,
  thumbs: [...b.querySelectorAll('img.prompt-image-thumb')].map((img) => ({ natural: img.naturalWidth, complete: img.complete, width: Math.round(img.getBoundingClientRect().width), right: img.getBoundingClientRect().right })),
  captions: [...b.querySelectorAll('.prompt-image-caption')].map((c) => ({ text: c.textContent, title: c.title, right: c.getBoundingClientRect().right })),
  chips: [...b.querySelectorAll('.prompt-image-missing')].map((c) => ({ text: c.textContent, title: c.title, right: c.getBoundingClientRect().right })),
  images: b.querySelectorAll('img').length,
  loading: b.querySelectorAll('.prompt-image[data-state="loading"]').length,
  scrollWidth: b.scrollWidth, clientWidth: b.clientWidth,
  right: b.getBoundingClientRect().right,
})))()`;

interface Bubble {
  latest: boolean;
  text: string;
  thumbs: { natural: number; complete: boolean; width: number; right: number }[];
  captions: { text: string; title: string; right: number }[];
  chips: { text: string; title: string; right: number }[];
  images: number;
  loading: number;
  scrollWidth: number;
  clientWidth: number;
  right: number;
}

export async function bubbleImagesCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, themes, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} bubble images: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();

  await js('PastelTerm.getStarted.close()'); // a fresh profile opens on Get started, over the reader
  const pasteFolder = path.join(outDir, PASTE_DIR_NAME);
  fs.mkdirSync(pasteFolder, { recursive: true });
  const image = path.join(pasteFolder, 'paste-2026-10-13T05-38-54-028Z-0b0b0b0b.png');
  fs.writeFileSync(image, fixturePng());
  const missing = path.join(pasteFolder, 'paste-2026-10-11T08-00-00-000Z-deadbeef.png');
  fs.rmSync(missing, { force: true });
  const outside = outsideImage();
  const outsideOk = outside !== null && ![os.homedir(), app.getPath('temp')].some((root) => isInside(outside, root));
  check(outsideOk, `a real image outside home and temp to refuse: ${outside}`);
  const name = path.basename(image);

  const latestPrompt = `…my colleague is showing me: ${image}\nand last week's one: ${missing}\nand this system icon ${quotePath(outside ?? '/System/none.png')}`;
  const olderPrompt = `compare [Image #1] with what we had ${image}`;
  const update = {
    state: 'live',
    replies: [
      { id: 'bubble-images-new', timestamp: '2026-10-13T05:40:00.000Z', prompt: latestPrompt, markdown: '**That screen calls the work items API.**\n\nThe grid on the left is the list endpoint.' },
      { id: 'bubble-images-old', timestamp: '2026-10-13T05:30:00.000Z', prompt: olderPrompt, markdown: 'An earlier reply.' },
    ],
  };
  const showSample = async () => {
    if (await js("document.getElementById('latest').dataset.replyId === 'bubble-images-new'")) return true;
    await js(`PastelTerm.reader.update(${JSON.stringify(update)})`);
    return waitFor(() => js("document.getElementById('latest').dataset.replyId === 'bubble-images-new'"), 5000);
  };
  const settled = (scope: string) => waitFor(async () => {
    const bubbles: Bubble[] = await js(MEASURE(scope));
    return bubbles.length && bubbles.every((b) => b.loading === 0 && b.thumbs.every((t) => t.complete && t.natural > 0)) ? bubbles : null;
  }, 5000);

  check(await showSample(), 'sample replies with image paths shown');
  const reader = await settled('#reader .reader-you');
  check(reader, 'every picture in the reader settled');
  const latest = reader?.find((b) => b.latest);
  const older = reader?.find((b) => !b.latest);
  check(latest?.thumbs.length === 1 && latest.thumbs[0].natural > 0, `latest reply: one thumbnail with natural size > 0: ${JSON.stringify(latest?.thumbs)}`);
  check(latest?.captions.some((c) => c.text === name && c.title === image), `latest reply: filename caption with the full path as tooltip: ${JSON.stringify(latest?.captions)}`);
  check(latest && !latest.text.includes(image), 'latest reply: the raw path text is gone');
  check(latest?.chips.length === 1 && latest.chips[0].text.includes('no longer available') && latest.chips[0].text.includes(path.basename(missing)) && latest.chips[0].title === missing, `missing paste: a chip with the filename: ${JSON.stringify(latest?.chips)}`);
  check(latest?.images === 1 && Boolean(outside) && latest.text.includes(` ${quotePath(outside ?? '?')}`), `outside path refused: no image element, its words kept: images=${latest?.images}`);
  check(older?.thumbs.length === 1 && older.thumbs[0].natural > 0 && !older.text.includes('[Image #1]') && !older.text.includes(image), `older reply: "[Image #1]" and its path shown as one picture: ${JSON.stringify(older?.thumbs)} ${JSON.stringify(older?.text)}`);

  // Lightbox: opens on click, closes on Esc and on click, gives focus back.
  const lightbox = "(() => { const img = document.querySelector('.image-lightbox img'); return img ? { natural: img.naturalWidth, focused: document.activeElement === img.parentElement } : null; })()";
  await js("document.querySelector('#latest .prompt-image-open').click()");
  const opened = await waitFor(async () => { const l = await js(lightbox); return l?.natural ? l : null; }, 3000);
  check(opened?.natural && opened.focused, `lightbox opens with the picture: ${JSON.stringify(opened)}`);
  await capture('bubble-images-lightbox');
  await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))");
  const afterEsc = await js("({ open: Boolean(document.querySelector('.image-lightbox')), historyOpen: PastelTerm.history.isOpen(), focus: document.activeElement?.className })");
  check(!afterEsc.open && afterEsc.focus === 'prompt-image-open', `Esc closes it and focus returns to the thumbnail: ${JSON.stringify(afterEsc)}`);
  await js("document.querySelector('#latest .prompt-image-open').click()");
  await waitFor(() => js("Boolean(document.querySelector('.image-lightbox'))"), 3000);
  await js("document.querySelector('.image-lightbox').click()");
  check(!(await js("Boolean(document.querySelector('.image-lightbox'))")), 'a click closes it too');

  // 800px in every look, then every theme: nothing wider than the bubble, thumbnails at most 240px.
  const fits = (b: Bubble) => b.scrollWidth <= b.clientWidth && [...b.thumbs, ...b.captions, ...b.chips].every((x) => x.right <= b.right + EDGE_TOLERANCE_PX) && b.thumbs.every((t) => t.width <= THUMB_MAX_PX);
  check(await resizeTo(kit, win, NARROW), `window at ${NARROW}px`);
  for (const [look] of READING_CHOICES) {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
    await showSample();
    const bubbles = await settled('#reader .reader-you');
    check(bubbles?.every(fits), `${look} ${NARROW}px: no overflow: ${JSON.stringify(bubbles?.map((b) => [b.scrollWidth, b.clientWidth, b.thumbs.map((t) => t.width)]))}`);
  }
  await js("window.pastel.look.setReading('newspaper')");
  for (const theme of Object.keys(themes)) {
    applyTheme(theme, { persist: false });
    await showSample();
    await wait(300);
    const bubbles = await settled('#reader .reader-you');
    check(bubbles?.every(fits) && bubbles.every((b) => b.thumbs.length === 1), `${theme} ${NARROW}px: thumbnails shown, no overflow`);
    await js("document.querySelector('#latest .reader-you').scrollIntoView({ block: 'start' })");
    win.webContents.invalidate();
    await capture(`bubble-images-${theme}`);
  }
  // A close crop of the latest bubble, for the report.
  applyTheme('paleSky', { persist: false });
  await showSample();
  await settled('#reader .reader-you');
  await js("document.querySelector('#latest .reader-you').scrollIntoView({ block: 'center' })");
  win.webContents.invalidate();
  await wait(600);
  const rect = await js("(() => { const r = document.querySelector('#latest .reader-you').getBoundingClientRect(); return { x: Math.max(0, Math.floor(r.left) - 16), y: Math.max(0, Math.floor(r.top) - 16), width: Math.ceil(r.width) + 32, height: Math.ceil(r.height) + 32 }; })()");
  fs.writeFileSync(path.join(outDir, 'snapshot-bubble-images-crop.png'), (await win.webContents.capturePage(rect)).toPNG());
  log(`captured bubble-images-crop: ${JSON.stringify(rect)}`);

  // History preview: the same prompt from a session log.
  const previous = { records: historyFixture.records, live: historyFixture.live };
  const file = path.join(outDir, 'bubble-images-fixture', `${SESSION}.jsonl`);
  writeLog(file, latestPrompt, 'That screen calls the work items API.');
  historyFixture.records = [{ sessionId: SESSION, file, cwd: path.join(outDir, 'bubble-images-fixture', 'repo'), title: 'Colleague screenshot', firstPrompt: latestPrompt, lastAt: Date.now(), messages: 2, messagesExact: true }];
  historyFixture.live = [];
  try {
    await js(`PastelTerm.history.open().then(() => { PastelTerm.history.select(${JSON.stringify(SESSION)}); return PastelTerm.history.setPreviewMode('replies'); })`);
    const history = await settled('#history .history-you');
    const bubble = history?.[0];
    check(bubble?.thumbs.length === 1 && bubble.thumbs[0].natural > 0, `History preview: thumbnail with natural size > 0: ${JSON.stringify(bubble?.thumbs)}`);
    check(bubble?.captions.some((c) => c.text === name && c.title === image) && bubble.chips.length === 1 && bubble.images === 1, 'History preview: caption, tooltip, missing chip, outside refused');
    for (const theme of Object.keys(themes)) {
      applyTheme(theme, { persist: false });
      await wait(200);
      const themed = await settled('#history .history-you');
      check(themed?.every(fits), `History ${theme} ${NARROW}px: no overflow: ${JSON.stringify(themed?.map((b) => ({ scroll: [b.scrollWidth, b.clientWidth], right: b.right, parts: [...b.thumbs, ...b.captions, ...b.chips].map((x) => Math.round(x.right)) })))}`);
    }
    applyTheme('paleSky', { persist: false });
    await js("document.querySelector('#history .history-you')?.scrollIntoView({ block: 'center' })");
    win.webContents.invalidate();
    await capture('bubble-images-history');
  } finally {
    await js('PastelTerm.history.close()');
    historyFixture.records = previous.records;
    historyFixture.live = previous.live;
  }

  resizeOffscreen(win, startWidth, startHeight);
  applyTheme('paleSky', { persist: false });
}
