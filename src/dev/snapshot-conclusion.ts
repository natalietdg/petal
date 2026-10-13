// Session conclusion (PASTEL_SNAPSHOT_MODE=conclusion): a "conclude" turn in the fixture log pins a one-line summary
// at the top of the reader and puts the full Conclusion / Result / Impact banner after the newest reply, in every look
// and theme; a re-conclude replaces both, and History's preview does the same plus a mark and the gist on the row.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { concludeCloses, historyFixture } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { READING_CHOICES } from '../main/menu';
import { assertFixtureOutsideClaude } from './snapshot-views';
import { load as loadConfig } from '../main/config-store';

const CONCLUDED = 'c0c0c0c0-0000-4000-8000-0000000000c1';
const PLAIN = 'c0c0c0c0-0000-4000-8000-0000000000c2';

const FIRST = {
  title: 'Session conclusion banner',
  conclusion: 'Concluded sessions get a banner at the top, built from Claude’s answer to “conclude”.',
  result: 'The reader and History both show Conclusion, Result and Impact; History rows carry a Concluded mark.',
  impact: 'She can see where any session landed without scrolling back through it.',
};
const SECOND = {
  title: '',
  conclusion: 'Re-concluding replaces the banner with the newest answer.',
  result: 'One banner per session, always the latest conclude.',
  impact: 'Nothing stale sits at the top of a session that moved on.',
};
const block = (c: typeof FIRST) => [...(c.title ? [`**${c.title}**`, ''] : []), `**Conclusion:** ${c.conclusion}`, '', `**Result:** ${c.result}`, '', `**Impact:** ${c.impact}`].join('\n');

let seq = 0;
// Enough conversation that History's preview scrolls, so the pinned summary has something to stay on top of.
const FILLER = (): string[] => Array.from({ length: 6 }, (_, i) => turn(`step ${i + 1}`, 'Moved the banner, checked the spacing in every look, and reran the reader at both widths. '.repeat(6))).flat();
const entry = (fields: Record<string, unknown>) => JSON.stringify({ isSidechain: false, timestamp: new Date().toISOString(), ...fields });
const turn = (prompt: string, reply: string): string[] => {
  seq += 1;
  return [
    entry({ type: 'user', uuid: `conclude-u${seq}`, message: { role: 'user', content: prompt } }),
    entry({ type: 'assistant', uuid: `conclude-a${seq}`, message: { role: 'assistant', content: [{ type: 'text', text: reply }] } }),
  ];
};

function appendTurns(file: string, lines: string[]): void {
  assertFixtureOutsideClaude(file);
  fs.appendFileSync(file, `${lines.join('\n')}\n`);
}

function addHistory(outDir: string): () => void {
  const dir = path.join(outDir, 'conclusion-fixture');
  fs.mkdirSync(dir, { recursive: true });
  const record = (sessionId: string, title: string, lines: string[], ageMs: number) => {
    const file = path.join(dir, `${sessionId}.jsonl`);
    assertFixtureOutsideClaude(file);
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    return { sessionId, file, cwd: path.join(dir, 'repo'), title, firstPrompt: 'build the banner', lastAt: Date.now() + 60_000 - ageMs, messages: lines.length, messagesExact: true };
  };
  historyFixture.records = [
    record(CONCLUDED, 'Conclusion banner', [...turn('build the banner', 'Built.'), ...FILLER(), ...turn('conclude', block(FIRST)), ...turn('one more fix', 'Fixed.'), ...turn('conclude: again', block(SECOND))], 0),
    record(PLAIN, 'Refactor later', [...turn('conclude the refactor later', `**Conclusion:** ${FIRST.conclusion}`)], 1000),
  ];
  historyFixture.live = [];
  return () => { historyFixture.records = []; };
}

// Contrast of fg on bg, with a translucent bg laid over the page's background first.
const COLOUR_HELPERS = `
  const rgba = (c) => (c.match(/[\\d.]+/g) || []).map(Number);
  const over = (top, under) => { const a = top[3] ?? 1; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)); };
  const lum = (c) => { const s = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return Math.round(((x + 0.05) / (y + 0.05)) * 10) / 10; };
  const shown = (e) => Boolean(e) && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none';
`;

// The full banner in `root`: shown, rows, size, place and contrast.
const BANNER = (root: string, column: string, below: string) => `(() => { ${COLOUR_HELPERS}
  const all = document.querySelectorAll(${JSON.stringify(`${root} .conclusion-banner`)});
  const b = all[0];
  if (!shown(b)) return { shown: false, count: all.length };
  const col = document.querySelector(${JSON.stringify(column)});
  const next = document.querySelector(${JSON.stringify(below)});
  const rect = b.getBoundingClientRect();
  let under = b.parentElement;
  while (under && (rgba(getComputedStyle(under).backgroundColor)[3] ?? 1) === 0) under = under.parentElement;
  const pageBg = rgba(getComputedStyle(under ?? document.body).backgroundColor);
  const bg = over(rgba(getComputedStyle(b).backgroundColor), pageBg);
  const text = b.querySelector('.conclusion-text');
  const label = b.querySelector('.conclusion-label');
  const when = b.querySelector('.conclusion-when');
  return {
    shown: true, count: all.length,
    when: when.textContent, title: b.querySelector('.conclusion-title')?.textContent ?? '',
    labels: [...b.querySelectorAll('.conclusion-label')].filter(shown).map((e) => e.textContent),
    texts: [...b.querySelectorAll('.conclusion-text')].filter(shown).map((e) => e.textContent),
    height: Math.round(rect.height), width: Math.round(rect.width), column: Math.round(col.clientWidth - parseFloat(getComputedStyle(col).paddingLeft) - parseFloat(getComputedStyle(col).paddingRight)),
    below: next ? Math.round(rect.top - next.getBoundingClientRect().bottom) : null,
    overflow: b.scrollWidth - b.clientWidth,
    contrast: {
      text: text && shown(text) ? ratio(rgba(getComputedStyle(text).color), bg) : null,
      label: label && shown(label) ? ratio(rgba(getComputedStyle(label).color), bg) : null,
      when: ratio(rgba(getComputedStyle(when).color), bg),
    },
  };
})()`;

const SIDEWAYS = `(() => ['html', '#reader-area', '#reader', '#history', '#history-preview', '.history-list-pane']
  .map((s) => document.querySelector(s)).filter((e) => e && e.getClientRects().length)
  .map((e) => ({ id: e.id || e.className, over: e.scrollWidth - e.clientWidth })).filter((x) => x.over > 1))()`;

const READER = () => BANNER('#reader-conclusion', '#replies-view', '#latest');
const PREVIEW = () => BANNER('#history-preview .history-conclusion', '#history-preview .history-preview-body', '#history-preview .history-preview-body');

// The pinned summary: one line, where it sits in the scroller, and whether the full banner ends the content.
const PIN = (scroller: string, pin: string, full: string, content: string) => `(() => { ${COLOUR_HELPERS}
  const s = document.querySelector(${JSON.stringify(scroller)});
  const p = document.querySelector(${JSON.stringify(`${pin} .conclusion-summary`)});
  if (!s || !shown(p)) return { shown: false };
  const f = document.querySelector(${JSON.stringify(full)});
  const slot = document.querySelector(${JSON.stringify(pin)}).getBoundingClientRect();
  const parts = [...p.children].filter(shown).map((e) => e.getBoundingClientRect());
  const span = Math.max(...parts.map((r) => r.bottom)) - Math.min(...parts.map((r) => r.top));
  const visibleAfter = (e) => { const out = []; for (let n = e.nextElementSibling; n; n = n.nextElementSibling) if (shown(n)) out.push(n.id || n.className); return out; };
  const sr = s.getBoundingClientRect();
  const pr = p.getBoundingClientRect();
  const fr = f?.getBoundingClientRect();
  const gist = p.querySelector('.conclusion-gist');
  return {
    shown: true, gist: gist.textContent, when: p.querySelector('.conclusion-when').textContent, title: p.querySelector('.conclusion-title')?.textContent ?? '',
    oneLine: span <= parseFloat(getComputedStyle(p).lineHeight) * 1.4, height: Math.round(pr.height), clipped: gist.scrollWidth > gist.clientWidth,
    topGap: Math.round(pr.top - sr.top), pinTop: Math.round(slot.top - sr.top), atBottom: s.scrollHeight - s.scrollTop - s.clientHeight < 2, scrollTop: Math.round(s.scrollTop),
    fullLast: Boolean(f && shown(f)) && f.parentElement === document.querySelector(${JSON.stringify(content)}) && visibleAfter(f).length === 0,
    fullLabels: f ? [...f.querySelectorAll('.conclusion-label')].filter(shown).map((e) => e.textContent) : [],
    fullInView: Boolean(fr) && fr.top >= slot.bottom - 1 && fr.bottom <= sr.bottom + 1, // wholly visible, none of it under the pin
  };
})()`;
const READER_PIN = () => PIN('#reader', '#reader-conclusion-pin', '#reader-conclusion', '#replies-view');
const PREVIEW_PIN = () => PIN('#history-preview', '#history-preview .history-conclusion-pin', '#history-preview .history-conclusion', '#history-preview');
const ROW = (id: string) => `(() => {
  const row = document.querySelector('#history-list .history-row[data-session-id="${id}"]');
  if (!row) return null;
  const snippet = row.querySelector('.history-snippet');
  const wide = [...row.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > row.getBoundingClientRect().right + 1).map((e) => e.className + ':' + Math.round(e.getBoundingClientRect().right - row.getBoundingClientRect().right));
  return { mark: row.querySelector('.history-concluded')?.textContent ?? null, snippet: snippet?.textContent ?? null, clipped: snippet ? snippet.scrollWidth > snippet.clientWidth : null, rowOverflow: row.scrollWidth - row.clientWidth, wide };
})()`;

export async function conclusionCheck(kit: Kit, win: BrowserWindow, fixture: string): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, themes, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} conclusion: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  const sizeTo = async (width: number) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      resizeOffscreen(win, width, 900);
      if (await waitFor(async () => { win.webContents.invalidate(); return (await js('window.innerWidth')) === width; }, 3000)) return true;
    }
    return false;
  };
  const setLook = async (look: string) => {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    return waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
  };
  const reader = () => js(READER());
  const pinned = () => js(READER_PIN());
  const toTop = () => js("document.getElementById('reader-conclusion').scrollIntoView({ block: 'start' })");
  const scrollReader = (to: 'top' | 'bottom') => js(`(() => { const r = document.getElementById('reader'); r.scrollTop = ${to === 'top' ? 0 : 'r.scrollHeight'}; })()`);
  const fullRows = (b: { labels?: string[] } | null) => JSON.stringify(b?.labels) === JSON.stringify(['Conclusion', 'Result', 'Impact']);
  const readable = (b: { contrast?: { text: number | null; label: number | null; when: number } } | null) =>
    Boolean(b?.contrast && (b.contrast.text ?? 0) >= 4.5 && (b.contrast.label ?? 0) >= 3 && b.contrast.when >= 3);
  const removeHistory = addHistory(outDir);

  try {
    await js('PastelTerm.welcome.close()');
    await js("PastelTerm.reader.setView('replies')");
    await sizeTo(1280);
    await setLook('newspaper');
    applyTheme('paleSky', { persist: false });

    // The fixture has no conclude yet: no banner.
    const before = await reader();
    check(!before.shown && before.count === 0, `no banner before a conclude: ${JSON.stringify(before)}`);

    // Her "conclude" lands in the log; the feed reads Claude's answer and the banner appears.
    check(concludeCloses.length === 0, `a conclusion already in a log never closes its session: ${JSON.stringify(concludeCloses)}`);
    appendTurns(fixture, turn('conclude', block(FIRST)));
    const first = await waitFor(async () => { const b = await reader(); return b.shown && b.texts?.[0] === FIRST.conclusion ? b : null; }, 10000);
    check(first && fullRows(first) && first.texts.join('|') === [FIRST.conclusion, FIRST.result, FIRST.impact].join('|') && first.title === FIRST.title,
      `banner shows the three rows and the title: ${JSON.stringify(first)}`);
    check(first && /^Concluded · /.test(first.when) && first.count === 1, `head reads "Concluded · <date time>": ${first?.when}`);
    check(first && first.below !== null && first.below >= 0 && Math.abs(first.width - first.column) <= 1, `full column width, below the newest reply: ${JSON.stringify({ width: first?.width, column: first?.column, gapFromLatest: first?.below })}`);
    const opened = await pinned();
    check(opened.shown && opened.oneLine && opened.gist === FIRST.conclusion && opened.title === FIRST.title && /^Concluded · /.test(opened.when) && opened.topGap >= 0 && opened.topGap < 40,
      `the reader opens with the one-line summary at the top: ${JSON.stringify(opened)}`);

    // Every look and theme: shown, three rows, readable, nothing sideways.
    for (const [look] of READING_CHOICES) {
      check(await setLook(look), `${look} look applied`);
      for (const themeId of Object.keys(themes)) {
        applyTheme(themeId, { persist: false });
        await wait(250);
        const b = await reader();
        const sideways = await js(SIDEWAYS);
        check(b.shown && fullRows(b) && readable(b) && b.overflow <= 1 && Math.abs(b.width - b.column) <= 1 && sideways.length === 0,
          `${look} ${themeId}: ${JSON.stringify({ labels: b.labels, contrast: b.contrast, width: b.width, column: b.column, overflow: b.overflow, sideways })}`);
        if ((look === 'newspaper' || look === 'print') && themeId === 'paleSky') {
          await toTop();
          await wait(200);
          await capture(`conclusion-${look}-open`);
        }
        if (look === 'editorial' && themeId === 'nightPastel') {
          await toTop();
          await capture('conclusion-editorial-nightPastel-open');
        }
      }
    }
    applyTheme('paleSky', { persist: false });

    // Pinned summary stays at the top while she scrolls; the full banner ends the reader; clicking the summary goes to it.
    for (const look of ['newspaper', 'print']) {
      await setLook(look);
      await scrollReader('bottom');
      await wait(150);
      const bottom = await pinned();
      check(bottom.shown && bottom.oneLine && bottom.atBottom && bottom.scrollTop > 0 && Math.abs(bottom.pinTop) <= 1 && bottom.fullLast && bottom.fullInView && fullRows({ labels: bottom.fullLabels }),
        `${look}: summary one line and pinned at the top with the reader scrolled to the bottom; full banner is the last thing in the reader, wholly in view: ${JSON.stringify(bottom)}`);
      await scrollReader('top');
      await wait(150);
      check(!(await pinned()).fullInView, `${look}: full banner out of view at the top of the reader`);
      await js("document.querySelector('#reader-conclusion-pin .conclusion-summary').click()");
      await wait(150);
      const jumped = await pinned();
      check(jumped.fullInView && Math.abs(jumped.pinTop) <= 1, `${look}: clicking the summary brings the full banner into view, below the pin: ${JSON.stringify(jumped)}`);
      await capture(`conclusion-${look}-pinned`);
    }
    appendTurns(fixture, turn('one more fix', 'Fixed the spacing.'));
    await waitFor(async () => (await js("document.getElementById('latest').innerText")).includes('Fixed the spacing.'), 8000);
    const kept = await pinned();
    check(kept.shown && kept.gist === FIRST.conclusion && kept.fullLast, `a new reply keeps the summary pinned and the full banner last: ${JSON.stringify({ gist: kept.gist, fullLast: kept.fullLast })}`);

    // A second conclude replaces the banner.
    // Once Claude's answer is in and the session idle, it closes through the Sessions panel's path, once; snapshot runs stop before the signal.
    const closed = await waitFor(async () => (concludeCloses[0] && concludeCloses[0].outcome !== 'started' ? concludeCloses.slice() : null), 10000);
    check(closed && closed.length === 1 && closed[0].sessionId === 'snapshot-fixture' && /not running|no signal sent/.test(closed[0].outcome),
      `conclude closes its session once, through the panel's Close, no signal in a snapshot run: ${JSON.stringify(closed)}`);
    appendTurns(fixture, turn('conclude: again', block(SECOND)));
    const second = await waitFor(async () => { const b = await reader(); return b.shown && b.texts?.[0] === SECOND.conclusion ? b : null; }, 10000);
    check(second && second.count === 1 && second.title === '' && second.texts.join('|') === [SECOND.conclusion, SECOND.result, SECOND.impact].join('|'),
      `re-conclude replaces the banner: ${JSON.stringify(second)}`);
    const secondPin = await pinned();
    check(secondPin.gist === SECOND.conclusion && secondPin.title === '', `re-conclude replaces the pinned summary: ${JSON.stringify(secondPin.gist)}`);

    await wait(3000); // a few idle ticks: the same session never closes twice
    check(concludeCloses.length === 1, `a re-conclude in a session already closed once does not close again: ${JSON.stringify(concludeCloses)}`);

    // 800px: banner and gist fit the column.
    check(await sizeTo(800), 'window at 800px');
    await setLook('newspaper');
    const narrow = await reader();
    const narrowSideways = await js(SIDEWAYS);
    check(narrow.shown && narrow.overflow <= 1 && narrowSideways.length === 0 && Math.abs(narrow.width - narrow.column) <= 1,
      `800px reader: ${JSON.stringify({ width: narrow.width, column: narrow.column, overflow: narrow.overflow, sideways: narrowSideways })}`);
    const narrowPin = await pinned();
    check(narrowPin.shown && narrowPin.oneLine && (await js(SIDEWAYS)).length === 0, `800px summary stays one line: ${JSON.stringify(narrowPin)}`);
    await toTop();
    await capture('conclusion-reader-800');

    // History: the row's mark and gist, the preview's banner; latest conclude wins, a sentence starting with conclude doesn't count.
    await sizeTo(1280);
    await js('PastelTerm.history.open()');
    // Earlier steps of a full run can leave Favorites picked or a search typed; list every session.
    await js(`(() => { document.querySelector('#history-tabs [data-list="all"]').click(); const q = document.getElementById('history-search'); q.value = ''; q.dispatchEvent(new Event('input')); })()`);
    const row = await waitFor(async () => { const r = await js(ROW(CONCLUDED)); return r?.mark ? r : null; }, 15000);
    if (!row) log(`conclusion: rows listed ${JSON.stringify(await js("[...document.querySelectorAll('#history-list .history-row')].map((r) => r.dataset.sessionId).slice(0, 8)"))}`);
    check(row && row.mark === 'Concluded' && row.snippet === SECOND.conclusion && row.rowOverflow <= 1, `History row has the mark and the latest conclusion: ${JSON.stringify(row)}`);
    const plainRow = await js(ROW(PLAIN));
    check(plainRow && plainRow.mark === null && plainRow.snippet === null, `a session without a conclude has no mark: ${JSON.stringify(plainRow)}`);

    await js(`PastelTerm.history.select(${JSON.stringify(CONCLUDED)})`);
    const preview = await waitFor(async () => { const b = await js(PREVIEW()); return b.shown ? b : null; }, 5000);
    check(preview && fullRows(preview) && preview.texts[0] === SECOND.conclusion && preview.count === 1 && preview.below !== null && preview.below >= 0 && readable(preview),
      `History preview full banner sits below the conversation: ${JSON.stringify(preview)}`);
    const previewPin = await waitFor(async () => { const p = await js(PREVIEW_PIN()); return p.shown && p.atBottom ? p : null; }, 5000);
    check(previewPin && previewPin.oneLine && previewPin.gist === SECOND.conclusion && Math.abs(previewPin.pinTop) <= 1 && previewPin.fullLast,
      `History preview: summary pinned at the top when scrolled to the newest turn, full banner last: ${JSON.stringify(previewPin)}`);
    const headAbove = await js("(() => { const p = document.getElementById('history-preview'); p.scrollTop = 0; const h = p.querySelector('.history-preview-head').getBoundingClientRect(); const b = p.querySelector('.history-conclusion-pin').getBoundingClientRect(); return h.bottom <= b.top + 1; })()");
    check(headAbove, 'History preview summary starts under the session header');
    await js("document.querySelector('#history-preview .conclusion-summary').click()");
    check((await js(PREVIEW_PIN())).fullInView, 'History preview: clicking the summary brings the full banner into view');
    await js('document.getElementById("history-preview").scrollTop = 0');
    await capture('conclusion-history-1280');

    await js(`PastelTerm.history.select(${JSON.stringify(PLAIN)})`);
    const none = await js(PREVIEW());
    const nonePin = await js(PREVIEW_PIN());
    check(!none.shown && !nonePin.shown, `no banner or summary in the preview of a session without a conclude: ${JSON.stringify(none)}`);
    await js(`PastelTerm.history.select(${JSON.stringify(CONCLUDED)})`);

    // Favorites lists the same mark and gist.
    await js(`PastelTerm.favorites.isFavorite(${JSON.stringify(CONCLUDED)}) || PastelTerm.favorites.toggle(${JSON.stringify(CONCLUDED)})`);
    await js("document.querySelector('#history-tabs [data-list=\"favorites\"]').click()");
    const fav = await waitFor(async () => { const r = await js(ROW(CONCLUDED)); return r?.mark ? r : null; }, 5000);
    check(fav && fav.snippet === SECOND.conclusion, `Favorites row has the mark and gist: ${JSON.stringify(fav)}`);
    await capture('conclusion-history-favorites');
    await js(`PastelTerm.favorites.toggle(${JSON.stringify(CONCLUDED)})`);
    await js("document.querySelector('#history-tabs [data-list=\"all\"]').click()");

    check(await sizeTo(800), 'History at 800px');
    await wait(300);
    const sideways = await js(SIDEWAYS);
    const narrowRow = await js(ROW(CONCLUDED));
    const plainNarrow = await js(ROW(PLAIN)); // its long fixture folder already overflows a few px; the mark and gist add nothing
    const narrowPreview = await js(PREVIEW());
    check(sideways.length === 0 && narrowRow?.wide.length === 0 && narrowRow?.rowOverflow <= plainNarrow?.rowOverflow && narrowPreview.overflow <= 1,
      `History at 800px, nothing sideways: ${JSON.stringify({ sideways, row: narrowRow, plainRow: plainNarrow?.rowOverflow, overflow: narrowPreview.overflow })}`);
    await capture('conclusion-history-800');
    await js('PastelTerm.history.close()');
    await sizeTo(1280);
    await bannersAndFocusCheck(kit, win, fixture);
  } finally {
    await js('PastelTerm.history.close()');
    removeHistory();
    applyTheme('paleSky', { persist: false });
    await setLook('newspaper');
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}

// The strip and the pinned summary fold to one bar, remembered; Focus shows only the reply and Esc puts everything back.
const BANNERS = `(() => {
  const shown = (e) => Boolean(e) && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none';
  const bar = document.getElementById('reader-banners-bar');
  const style = getComputedStyle(bar);
  return {
    bar: shown(bar), text: bar.textContent, expanded: bar.getAttribute('aria-expanded'), controls: bar.getAttribute('aria-controls'),
    oneLine: bar.getBoundingClientRect().height - parseFloat(style.paddingTop) <= parseFloat(style.lineHeight) * 1.4,
    stripRows: [...document.querySelectorAll('#reader-status-strip .status-text')].filter(shown).length, // rows are display: contents, so count their text
    pin: shown(document.querySelector('#reader-conclusion-pin .conclusion-summary')),
    focused: document.activeElement === bar,
  };
})()`;
const FOCUS = `(() => {
  const shown = (e) => Boolean(e) && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none';
  const box = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) }; };
  const area = document.getElementById('reader-area');
  const divider = document.getElementById('divider');
  return {
    on: document.getElementById('app').classList.contains('focus-mode'), pressed: document.getElementById('focus-toggle').getAttribute('aria-pressed'),
    hidden: Object.fromEntries(['sessions-dock', 'reader-head', 'composer', 'prompt-dock', 'cat', 'reader-status-strip', 'reader-banners-bar', 'reader-conclusion-pin', 'notes-panel'].map((id) => [id, !shown(document.getElementById(id))])),
    exit: shown(document.getElementById('focus-exit')), terminal: box('terminal-pane').height, reader: box('reader'), win: { width: innerWidth, height: innerHeight },
    layout: { rows: document.getElementById('app').style.gridTemplateRows, divider: box('divider').top, split: divider.getAttribute('aria-valuenow'), terminal: box('terminal-pane'), reader: box('reader'),
      cat: ['cat-docked', 'cat-in-reply', 'notes-open', 'banners-collapsed'].filter((c) => area.classList.contains(c)) },
  };
})()`;

async function bannersAndFocusCheck(kit: Kit, win: BrowserWindow, fixture: string): Promise<void> {
  const { js, wait, waitFor, log, capture } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} banners and focus: ${what}`);
  const key = (keyCode: string) => { for (const type of ['keyDown', 'keyUp'] as const) win.webContents.sendInputEvent({ type, keyCode }); };
  const banners = () => js(BANNERS);
  const focus = () => js(FOCUS);

  await js("PastelTerm.readerBanners.setCollapsed(false)");
  appendTurns(fixture, turn('status please', 'Banner work.\n\n**Doing:** folding the banners.\n**Recommend:** keep one bar.\n**Next:** check focus.'));
  const open = await waitFor(async () => { const b = await banners(); return b.bar && b.stripRows === 3 && b.pin ? b : null; }, 8000);
  check(open && open.text === 'Doing · Recommend · Next · Conclusion▾' && open.expanded === 'true' && open.controls === 'reader-status-strip reader-conclusion-pin',
    `expanded: bar names what it folds, strip and pin shown: ${JSON.stringify(open)}`);

  // Click folds both to the one-line bar, and the choice is saved.
  await js("document.getElementById('reader-banners-bar').click()");
  const shut = await banners();
  check(shut.bar && shut.oneLine && shut.stripRows === 0 && !shut.pin && shut.expanded === 'false' && shut.text.endsWith('▸'),
    `collapsed: one-line bar, strip lines and pin body hidden: ${JSON.stringify(shut)}`);
  check(await waitFor(() => loadConfig().reader.bannersCollapsed || null, 3000), `collapsed saved to config: ${JSON.stringify(loadConfig().reader)}`);
  await capture('banners-collapsed');
  // A fresh page reads it back: drop the class without saving, then restore from config.
  await js("PastelTerm.readerBanners.setCollapsed(false, false)");
  await js('PastelTerm.readerBanners.restore()');
  const restored = await banners();
  check(restored.stripRows === 0 && !restored.pin && restored.expanded === 'false', `still collapsed after re-reading config: ${JSON.stringify(restored)}`);

  // Keyboard: Space and Enter on the focused bar.
  await js("document.getElementById('reader-banners-bar').focus()");
  key('Space');
  const spaced = await waitFor(async () => { const b = await banners(); return b.expanded === 'true' ? b : null; }, 2000);
  check(spaced && spaced.stripRows === 3 && spaced.pin && spaced.focused, `Space expands: ${JSON.stringify(spaced)}`);
  // Enter activates a button on its keypress, which needs the char event too.
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  const entered = await waitFor(async () => { const b = await banners(); return b.expanded === 'false' ? b : null; }, 2000);
  check(entered && entered.stripRows === 0, `Enter collapses: ${JSON.stringify(entered)}`);
  await js("PastelTerm.readerBanners.setCollapsed(false)");
  check(await waitFor(() => loadConfig().reader.bannersCollapsed === false || null, 3000), 'expanded saved to config');

  // Focus: move the divider off its default first, so restoring it is a real check.
  await js("PastelTerm.tabs.active().refit()");
  await js("document.getElementById('divider').focus()");
  for (let i = 0; i < 3; i++) await js("document.getElementById('divider').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))");
  await wait(300);
  const before = (await focus()).layout;
  await js("document.getElementById('focus-toggle').click()");
  await wait(300);
  const on = await focus();
  const fills = Math.abs(on.reader.width - on.win.width) <= 3 && Math.abs(on.reader.height - on.win.height) <= 3 && on.reader.top <= 1 && on.reader.left <= 1;
  check(on.on && on.pressed === 'true' && Object.values(on.hidden).every(Boolean) && on.terminal <= 1 && on.exit && fills,
    `Focus hides dock, header, strip, pin, composer, terminal and cat; reader fills the window: ${JSON.stringify({ hidden: on.hidden, terminal: on.terminal, reader: on.reader, win: on.win, exit: on.exit })}`);
  await capture('focus-mode');

  // Esc, with the terminal holding the keyboard as it usually does.
  await js('PastelTerm.tabs.active().term.focus()');
  key('Escape');
  await waitFor(async () => !(await focus()).on || null, 2000);
  await wait(300); // the cat and the terminal settle back first
  const off = await focus();
  check(!off.on && JSON.stringify(off.layout) === JSON.stringify(before) && off.pressed === 'false' && !off.exit,
    `Esc leaves Focus and restores the layout, divider included: ${JSON.stringify({ before, after: off?.layout })}`);

  // The menu's ⌘⇧F sends focus:toggle; Exit focus and a second toggle both leave.
  win.webContents.send('focus:toggle');
  check(await waitFor(async () => (await focus()).on || null, 2000), 'View > Focus on Reply (⌘⇧F) enters Focus');
  win.webContents.send('focus:toggle');
  check(await waitFor(async () => !(await focus()).on || null, 2000), 'the same shortcut leaves it');
  await js("document.getElementById('focus-toggle').click()");
  await js("document.getElementById('focus-exit').click()");
  await wait(300);
  const exited = await focus();
  check(!exited.on && JSON.stringify(exited.layout) === JSON.stringify(before), `Exit focus restores the layout: ${JSON.stringify(exited.layout)}`);

  for (let i = 0; i < 3; i++) await js("document.getElementById('divider').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))");
}
