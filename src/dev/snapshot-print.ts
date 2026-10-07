// Magazine · Print look: picked from Customize, ticked in the View menu, then a long reply captured in light and dark.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Menu, type BrowserWindow, type MenuItem } from 'electron';
import type { Kit } from './snapshot';

const LONG_REPLY = [
  '**The reader keeps its place when a long reply lands.**',
  '',
  'A reply that arrives while you are reading no longer throws you back to the top. Petal remembers where you were and only jumps when the reply is new.',
  '',
  'Before this change every update rebuilt the page and scrolled to the kicker, so a slow reply that streamed in over a minute dragged the page up each time a paragraph arrived. Reading anything longer than a screen meant fighting the scroll bar.',
  '',
  '## What changed',
  '',
  'The reader now compares the reply id before it scrolls. Same id, same place on the page; a new id brings the kicker into view once.',
  '',
  '> **At a glance**',
  '> - Same reply: the scroll position stays',
  '> - New reply: one jump to the top',
  '> - Older turns never move',
  '',
  'Streaming updates still redraw the text, so a paragraph that grows keeps growing in place under your eyes.',
  '',
  '**Watch out:** a reply that is replaced by a different one with the same id would not scroll. Claude Code has never done that.',
  '',
  '## Why it matters',
  '',
  '> Losing your place is the fastest way to lose the thread.',
  '',
  'For long reads the page has to hold still. Every unexpected jump costs a re-scan of the screen to find the line you were on, and that is the moment attention slips away.',
  '',
  '| Update | Before | After |',
  '|---|---|---|',
  '| Same reply grows | Jumps to top | Stays put |',
  '| New reply | Jumps to top | Jumps to top |',
  '',
  '*Table 1. Scroll behaviour by update type.*',
  '',
  '```',
  "if (newest.id !== latestId) status.scrollIntoView({ block: 'start' });",
  '```',
  '',
  '**Decide:** keep the single jump for new replies, or stay put for those too?',
  '',
  '**Next:** open a long session and scroll halfway down while Claude is still writing.',
  '',
  '## Sources',
  '',
  '- `src/renderer/reader.ts`',
  '- `src/renderer/markdown.ts`',
].join('\n');

const OLDER_REPLY = '**Found the jump.**\n\nThe reader scrolls to the kicker on every update, not just on new replies.';

const update = {
  state: 'live',
  replies: [
    { id: 'print-new', timestamp: '2026-10-07T09:30:00.000Z', prompt: 'why does the reader jump to the top while a reply is still coming in?', markdown: LONG_REPLY },
    { id: 'print-old', timestamp: '2026-10-07T09:12:00.000Z', prompt: 'the reader keeps jumping, can you look?', markdown: OLDER_REPLY },
  ],
};

const PAPER = 'rgb(255, 247, 244)';

// Top (earlier turn + her message), story head, a middle section with the rail, and the end mark with back matter.
const shots = (id: string): [name: string, target: string | null][] => [
  [`print-${id}`, null],
  [`print-${id}-head`, '#reader-status'],
  ...(id === 'blush' ? [] : [[`print-${id}-mid`, '#latest .story-section:nth-of-type(2)'], [`print-${id}-end`, '#latest .story-section.back']] as [string, string][]),
];

// An unfocused snapshot window can hand back its previous frame: repaint and wait two frames (or 1s) first.
async function freshFrame(js: Kit['js'], win: BrowserWindow): Promise<void> {
  win.webContents.invalidate();
  await js('Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), new Promise((r) => setTimeout(r, 1000))])');
}

// Sets the reader's scrollTop directly (scrollIntoView can be skipped in an unfocused window) and returns it.
const scrollReaderTo = (js: Kit['js'], target: string | null): Promise<number> => js(`(() => {
  const reader = document.getElementById('reader');
  const el = ${JSON.stringify(target)} && document.querySelector(${JSON.stringify(target)});
  reader.scrollTop = el ? el.getBoundingClientRect().top - reader.getBoundingClientRect().top + reader.scrollTop - 24 : 0;
  return Math.round(reader.scrollTop);
})()`);

export async function printLookCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, themes, applyTheme, capture } = kit;
  const menuChecked = (label: string) => Menu.getApplicationMenu()?.items.flatMap((m): MenuItem[] => m.submenu?.items ?? []).find((i) => i.label === label)?.checked;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} print look: ${what}`);
  const capturedHashes = new Set<string>();

  // Customize chip -> applyReading: page attribute and View menu tick agree.
  await js("PastelTerm.customize.open('look')");
  await js("[...document.querySelectorAll('.cz-chip')].find((c) => c.textContent === 'Magazine · Print').click()");
  const synced = await waitFor(async () => (await js('document.documentElement.dataset.reading')) === 'print' && menuChecked('Magazine · Print'), 5000);
  check(synced, `chip sets data-reading=print and ticks View › Magazine · Print: ${JSON.stringify({ reading: await js('document.documentElement.dataset.reading'), menu: menuChecked('Magazine · Print'), editorialTicked: menuChecked('Magazine · Editorial') })}`);
  await js('PastelTerm.customize.close()');

  // The long reply: headline, dek, sections, rail, callouts, table, code, back matter, one earlier turn.
  await js(`PastelTerm.reader.update(${JSON.stringify(update)})`);
  const shaped = await waitFor(() => js(`(() => {
    const latest = document.getElementById('latest');
    const ok = latest.dataset.replyId === 'print-new' && latest.querySelector('.rail');
    return ok && {
      sections: latest.querySelectorAll('.story-section').length,
      rails: latest.querySelectorAll('.rail').length,
      older: document.querySelectorAll('#older .older-turn').length,
      bubbles: document.querySelectorAll('#reader .reader-you').length,
    };
  })()`), 5000);
  check(shaped && shaped.sections === 3 && shaped.rails === 2 && shaped.older === 1 && shaped.bubbles === 2, `long reply rendered: ${JSON.stringify(shaped)}`);

  const fonts = await js(`(async () => {
    const want = ['700 40px "Source Serif 4 Variable"', '400 19px "Source Serif 4 Variable"', '300 14px "IBM Plex Mono"', '400 13px "IBM Plex Mono"'];
    await Promise.all(want.map((f) => document.fonts.load(f)));
    return { loaded: want.every((f) => document.fonts.check(f)), headline: getComputedStyle(document.querySelector('#latest .headline')).fontFamily, kicker: getComputedStyle(document.getElementById('reader-status')).fontFamily };
  })()`);
  check(fonts.loaded && /Source Serif 4/.test(fonts.headline) && /IBM Plex Mono/.test(fonts.kicker), `bundled serif and mono fonts load: ${JSON.stringify(fonts)}`);

  for (const id of ['paleSky', 'blush', 'nightPastel']) {
    applyTheme(id, { persist: false });
    const want = themes[id].dark ? hexToRgb(themes[id].reader.background) : PAPER;
    const colours = await waitFor(async () => {
      await wait(300);
      const now = await js("(() => { const r = getComputedStyle(document.getElementById('reader')); const h = getComputedStyle(document.querySelector('#latest .headline')); return { bg: r.backgroundColor, ink: h.color }; })()");
      return now.bg === want ? now : null;
    }, 5000);
    check(colours, `${id} paper ${want}: ${JSON.stringify(colours ?? await js("getComputedStyle(document.getElementById('reader')).backgroundColor"))}`);
    const tops: number[] = [];
    for (const [name, target] of shots(id)) {
      tops.push(await scrollReaderTo(js, target));
      // A busy machine can still return the last frame: repaint and recapture, at most 3 tries.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await freshFrame(js, win);
        await capture(name);
        if (!capturedHashes.has(hashOf(kit.outDir, name))) break;
      }
      capturedHashes.add(hashOf(kit.outDir, name));
    }
    check(new Set(tops).size === tops.length, `${id} captures at distinct scroll positions: ${JSON.stringify(tops)}`);
  }

  // Each capture must be its own frame, not a stale repaint of the one before.
  const files = fs.readdirSync(kit.outDir).filter((f) => f.startsWith('snapshot-print-'));
  const hashes = new Set(files.map((f) => sha1(path.join(kit.outDir, f))));
  check(files.length === 10 && hashes.size === files.length, `${files.length} captures, ${hashes.size} distinct images`);

  // Back to the defaults for anything after this step.
  applyTheme('paleSky', { persist: false });
  await js("window.pastel.look.setReading('newspaper')");
  const reset = await waitFor(async () => (await js('document.documentElement.dataset.reading')) === 'newspaper' && menuChecked('Newspaper'), 5000);
  check(reset, 'back to Newspaper');
}

const sha1 = (file: string): string => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
const hashOf = (outDir: string, name: string): string => sha1(path.join(outDir, `snapshot-${name}.png`));

const hexToRgb =(hex: string): string => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
