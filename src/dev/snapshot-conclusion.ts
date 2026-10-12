// Session conclusion (PASTEL_SNAPSHOT_MODE=conclusion): a "conclude" turn in the fixture log puts a Conclusion /
// Result / Impact banner above the newest reply in every look and theme; it folds to one line, a re-conclude
// replaces it, and History shows the same banner in its preview plus a mark and the gist on the row.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { historyFixture } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { READING_CHOICES } from '../main/menu';
import { assertFixtureOutsideClaude } from './snapshot-views';

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
    record(CONCLUDED, 'Conclusion banner', [...turn('build the banner', 'Built.'), ...turn('conclude', block(FIRST)), ...turn('one more fix', 'Fixed.'), ...turn('conclude: again', block(SECOND))], 0),
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

// The banner in `root`: shown, folded, rows, gist, size, place and contrast.
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
  const gist = b.querySelector('.conclusion-gist');
  return {
    shown: true, count: all.length, folded: b.classList.contains('folded'),
    expanded: b.querySelector('.conclusion-head').getAttribute('aria-expanded'),
    when: when.textContent, title: b.querySelector('.conclusion-title')?.textContent ?? '',
    labels: [...b.querySelectorAll('.conclusion-label')].filter(shown).map((e) => e.textContent),
    texts: [...b.querySelectorAll('.conclusion-text')].filter(shown).map((e) => e.textContent),
    gist: shown(gist) ? { text: gist.textContent, lines: gist.getClientRects().length, clipped: gist.scrollWidth > gist.clientWidth } : null,
    height: Math.round(rect.height), width: Math.round(rect.width), column: Math.round(col.clientWidth - parseFloat(getComputedStyle(col).paddingLeft) - parseFloat(getComputedStyle(col).paddingRight)),
    above: next ? Math.round(next.getBoundingClientRect().top - rect.bottom) : null,
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

const READER = () => BANNER('#reader-conclusion', '#replies-view', '#reader-status');
const PREVIEW = () => BANNER('#history-preview .history-conclusion', '#history-preview .history-preview-body', '#history-preview .history-preview-body');
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
  const toTop = () => js("document.getElementById('reader-conclusion').scrollIntoView({ block: 'start' })");
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
    appendTurns(fixture, turn('conclude', block(FIRST)));
    const first = await waitFor(async () => { const b = await reader(); return b.shown && b.texts?.[0] === FIRST.conclusion ? b : null; }, 10000);
    check(first && fullRows(first) && first.texts.join('|') === [FIRST.conclusion, FIRST.result, FIRST.impact].join('|') && first.title === FIRST.title,
      `banner shows the three rows and the title: ${JSON.stringify(first)}`);
    check(first && /^Concluded · /.test(first.when) && first.count === 1, `head reads "Concluded · <date time>": ${first?.when}`);
    check(first && first.above !== null && first.above >= 0 && Math.abs(first.width - first.column) <= 1, `full column width, above the newest reply: ${JSON.stringify({ width: first?.width, column: first?.column, gapToStatus: first?.above })}`);
    const inView = await js("(() => { const b = document.getElementById('reader-conclusion').getBoundingClientRect(); const r = document.getElementById('reader').getBoundingClientRect(); return b.top >= r.top - 1 && b.top < r.bottom; })()");
    check(inView, 'the reader opens on the banner');

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

    // Folds to one line and stays folded through a reader redraw; unfolds again.
    for (const look of ['newspaper', 'print']) {
      await setLook(look);
      const open = await reader();
      await js("document.querySelector('#reader-conclusion .conclusion-head').click()");
      const folded = await reader();
      check(folded.folded && folded.expanded === 'false' && folded.labels.length === 0 && folded.gist?.lines === 1 && folded.height < open.height / 2,
        `${look} folds to one line: ${JSON.stringify({ open: open.height, folded: folded.height, gist: folded.gist, labels: folded.labels })}`);
      await toTop();
      await wait(200);
      await capture(`conclusion-${look}-folded`);
      if (look === 'print') break;
      await js("document.querySelector('#reader-conclusion .conclusion-head').click()");
      const reopened = await reader();
      check(!reopened.folded && fullRows(reopened), `${look} unfolds on a second click`);
    }
    appendTurns(fixture, turn('one more fix', 'Fixed the spacing.'));
    await waitFor(async () => (await js("document.getElementById('latest').innerText")).includes('Fixed the spacing.'), 8000);
    const kept = await reader();
    check(kept.folded && kept.texts.length === 0 && kept.gist?.text === FIRST.conclusion, `fold survives a new reply, banner still the last conclusion: ${JSON.stringify({ folded: kept.folded, gist: kept.gist?.text })}`);
    await js("document.querySelector('#reader-conclusion .conclusion-head').click()");

    // A second conclude replaces the banner.
    appendTurns(fixture, turn('conclude: again', block(SECOND)));
    const second = await waitFor(async () => { const b = await reader(); return b.shown && b.texts?.[0] === SECOND.conclusion ? b : null; }, 10000);
    check(second && second.count === 1 && second.title === '' && second.texts.join('|') === [SECOND.conclusion, SECOND.result, SECOND.impact].join('|'),
      `re-conclude replaces the banner: ${JSON.stringify(second)}`);

    // 800px: banner and gist fit the column.
    check(await sizeTo(800), 'window at 800px');
    await setLook('newspaper');
    const narrow = await reader();
    const narrowSideways = await js(SIDEWAYS);
    check(narrow.shown && narrow.overflow <= 1 && narrowSideways.length === 0 && Math.abs(narrow.width - narrow.column) <= 1,
      `800px reader: ${JSON.stringify({ width: narrow.width, column: narrow.column, overflow: narrow.overflow, sideways: narrowSideways })}`);
    await js("document.querySelector('#reader-conclusion .conclusion-head').click()");
    const narrowFolded = await reader();
    check(narrowFolded.folded && narrowFolded.gist?.lines === 1 && narrowFolded.overflow <= 1 && (await js(SIDEWAYS)).length === 0, `800px folded stays one line: ${JSON.stringify(narrowFolded.gist)}`);
    await js("document.querySelector('#reader-conclusion .conclusion-head').click()");
    await toTop();
    await capture('conclusion-reader-800');

    // History: the row's mark and gist, the preview's banner; latest conclude wins, a sentence starting with conclude doesn't count.
    await sizeTo(1280);
    await js('PastelTerm.history.open()');
    const row = await waitFor(async () => { const r = await js(ROW(CONCLUDED)); return r?.mark ? r : null; }, 15000);
    check(row && row.mark === 'Concluded' && row.snippet === SECOND.conclusion && row.rowOverflow <= 1, `History row has the mark and the latest conclusion: ${JSON.stringify(row)}`);
    const plainRow = await js(ROW(PLAIN));
    check(plainRow && plainRow.mark === null && plainRow.snippet === null, `a session without a conclude has no mark: ${JSON.stringify(plainRow)}`);

    await js(`PastelTerm.history.select(${JSON.stringify(CONCLUDED)})`);
    const preview = await waitFor(async () => { const b = await js(PREVIEW()); return b.shown ? b : null; }, 5000);
    check(preview && fullRows(preview) && preview.texts[0] === SECOND.conclusion && preview.count === 1 && preview.above !== null && preview.above >= 0 && readable(preview),
      `History preview banner sits above the conversation: ${JSON.stringify(preview)}`);
    const headAbove = await js("(() => { const h = document.querySelector('#history-preview .history-preview-head').getBoundingClientRect(); const b = document.querySelector('#history-preview .conclusion-banner').getBoundingClientRect(); return h.bottom <= b.top + 1; })()");
    check(headAbove, 'History preview banner sits under the session header');
    await js('document.getElementById("history-preview").scrollTop = 0');
    await capture('conclusion-history-1280');

    await js("document.querySelector('#history-preview .conclusion-head').click()");
    await js(`PastelTerm.history.select(${JSON.stringify(PLAIN)})`);
    const none = await js(PREVIEW());
    check(!none.shown, `no banner in the preview of a session without a conclude: ${JSON.stringify(none)}`);
    await js(`PastelTerm.history.select(${JSON.stringify(CONCLUDED)})`);
    const previewFolded = await js(PREVIEW());
    check(previewFolded.shown && previewFolded.folded && previewFolded.gist?.lines === 1, `History preview fold is kept per session: ${JSON.stringify(previewFolded.gist)}`);
    await js("document.querySelector('#history-preview .conclusion-head').click()");

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
  } finally {
    await js('PastelTerm.history.close()');
    removeHistory();
    applyTheme('paleSky', { persist: false });
    await setLook('newspaper');
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
