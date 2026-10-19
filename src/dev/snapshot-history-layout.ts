// History layout and Notes reach: the reply box docks below the preview, nothing scrolls sideways, the cat corner
// never covers an overlay or reply text, the list collapses, and every session she looks at has its notes.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { OPEN_SECTIONS } from './snapshot-reader-collapse';
import { load as loadConfig } from '../main/config-store';
import { historyFixture } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { READING_CHOICES } from '../main/menu';
import { assertFixtureOutsideClaude } from './snapshot-views';

const LONG = 'a1a1a1a1-0000-4000-8000-0000000000a1';
const OTHER = 'b2b2b2b2-0000-4000-8000-0000000000b2';
const WIDTHS = [800, 990, 1280, 1600];
const EDGE_PX = 4;

const section = (n: number) => [
  `## ${n}. Re-running the script won't double-write rows`,
  '',
  'The backfill checks each row before it writes, so a second run finds the rows already there and moves on. That is what makes it safe to stop halfway and start again later without cleaning anything up first.',
  '',
  '**Watch out:** the check reads the destination table, so a run against the wrong database skips nothing and writes everything again. Confirm the connection string before every run, especially after switching environments.',
  '',
  '| Step | Source | Destination | Idempotent | Rows | Owner | Notes |',
  '|---|---|---|---|---|---|---|',
  '| Read | widget_order_history_with_a_very_long_name | order_history_destination_table_name_for_archive | yes | 12,480 | widget-data-engineering | reads in pages of 500 rows |',
  '| Write | nosql://acme-store/containers/orders_archive_with_suffix | postgres://db.example.test/orders_archive | yes | 12,480 | widget-data-engineering | skips rows already present |',
  '| Code | `widget_order_history_with_a_very_long_name` | `order_history_destination_table_name` | yes | 1 | you | code spans |',
  '',
  '```',
  'npx tsx scripts/backfill-orders.ts --dry-run --region eu --from 2026-01-01 --to 2026-10-01 --page-size 500',
  '```',
  '',
].join('\n');

const LONG_REPLY = ['**The backfill is safe to re-run.**', '', ...[1, 2, 3, 4].map(section)].join('\n');

function writeLog(file: string, prompt: string, reply: string): void {
  assertFixtureOutsideClaude(file);
  const at = new Date().toISOString();
  const lines = [
    { type: 'user', uuid: `${path.basename(file)}-u`, timestamp: at, isSidechain: false, message: { role: 'user', content: prompt } },
    { type: 'assistant', uuid: `${path.basename(file)}-a`, timestamp: at, isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text: reply }] } },
  ];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
}

function addFixture(outDir: string): () => void {
  const dir = path.join(outDir, 'history-layout-fixture');
  const record = (sessionId: string, title: string, prompt: string, reply: string, ageMs: number) => {
    const file = path.join(dir, `${sessionId}.jsonl`);
    writeLog(file, prompt, reply);
    return { sessionId, file, cwd: path.join(dir, 'repo'), title, firstPrompt: prompt, lastAt: Date.now() + 60_000 - ageMs, messages: 2, messagesExact: true };
  };
  historyFixture.records = [
    record(LONG, 'Backfill re-run safety', 'is it safe to re-run the backfill?', LONG_REPLY, 0),
    record(OTHER, 'Name the cat', 'name the cat', 'Mika suits her.', 1000),
  ];
  historyFixture.live = [];
  return () => { historyFixture.records = []; historyFixture.live = []; };
}

// Shared helpers in the page: rects, visible text in a scroller, and overlap.
const HELPERS = `
  const R = (b) => ({ left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width), height: Math.round(b.height) });
  const meets = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const shown = (e) => e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const TEXT = 'p, h1, h2, h3, h4, li, td, th, pre, blockquote, label, input, textarea, button, .callout';
  // Text inside root as drawn: each element clipped to its scroller's visible box.
  const visibleText = (root, clip) => [...root.querySelectorAll(TEXT)].filter(shown).map((e) => {
    const b = e.getBoundingClientRect();
    const c = clip.getBoundingClientRect();
    return { e, box: { left: Math.max(b.left, c.left), right: Math.min(b.right, c.right), top: Math.max(b.top, c.top), bottom: Math.min(b.bottom, c.bottom) } };
  }).filter(({ box }) => box.right > box.left && box.bottom > box.top);
  const label = (e) => e.tagName + ':' + (e.textContent || e.placeholder || '').trim().slice(0, 32);
  // Cat corner: the sprite's drawn box, or null when not drawn.
  const catBox = () => { const c = document.getElementById('cat'); return shown(c) && c.getBoundingClientRect().width > 0 ? c.getBoundingClientRect() : null; };
  const sideways = () => ['html', '#reader-area', '#history', '#history-preview', '.history-list-pane', '#history-notes', '#reader']
    .map((s) => document.querySelector(s)).filter(shown)
    .map((e) => ({ id: e.id || e.className || e.tagName, over: e.scrollWidth - e.clientWidth })).filter((x) => x.over > 1);
`;

const PREVIEW = `(() => { ${HELPERS}
  const pv = document.getElementById('history-preview');
  const box = document.querySelector('#history .history-reply-box');
  const hits = box ? visibleText(pv, pv).filter(({ box: b }) => meets(b, box.getBoundingClientRect())).map(({ e }) => label(e)) : ['no reply box'];
  const cat = catBox();
  const catHits = cat ? visibleText(document.getElementById('history'), document.getElementById('history')).filter(({ box: b }) => meets(b, cat)).map(({ e }) => label(e)) : [];
  let bg = box, colour = 'rgba(0, 0, 0, 0)';
  while (bg && /rgba\\(.*, 0\\)$|transparent/.test(colour = getComputedStyle(bg).backgroundColor)) bg = bg.parentElement;
  return {
    viewport: innerWidth,
    history: R(document.getElementById('history').getBoundingClientRect()),
    preview: R(pv.getBoundingClientRect()),
    box: box && R(box.getBoundingClientRect()),
    boxInScroller: Boolean(box && pv.contains(box)),
    boxBackground: colour,
    hits, catHits, sideways: sideways(),
    scrollTop: Math.round(pv.scrollTop), scrollMax: pv.scrollHeight - pv.clientHeight,
  };
})()`;

const OVERLAY = (id: string) => `(() => { ${HELPERS}
  const view = document.getElementById(${JSON.stringify(id)});
  const cat = catBox();
  const hits = cat && shown(view) ? visibleText(view, view).filter(({ box }) => meets(box, cat)).map(({ e }) => label(e)) : [];
  return { open: shown(view), cat: cat && R(cat), hits, sideways: sideways() };
})()`;

const READER = `(() => { ${HELPERS}
  const reader = document.getElementById('reader');
  const cat = catBox();
  const hits = cat ? visibleText(reader, reader).filter(({ box }) => meets(box, cat)).map(({ e, box }) => label(e) + ' ' + JSON.stringify(R({ ...box, width: 0, height: 0 }))) : [];
  const where = { reader: R(reader.getBoundingClientRect()), strip: getComputedStyle(reader).marginBottom };
  const panel = document.getElementById('notes-panel');
  const head = document.getElementById('reader-head').getBoundingClientRect();
  const composer = document.getElementById('composer').getBoundingClientRect();
  const editor = panel.querySelector('.notes-editor');
  const toggle = document.getElementById('notes-toggle');
  const t = toggle.getBoundingClientRect();
  const atToggle = document.elementFromPoint((t.left + t.right) / 2, (t.top + t.bottom) / 2);
  return {
    viewport: innerWidth, cat: cat && R(cat), hits, where, sideways: sideways(),
    panelOpen: shown(panel), panel: R(panel.getBoundingClientRect()), head: R(head), composer: R(composer),
    editor: editor && shown(editor) ? R(editor.getBoundingClientRect()) : null,
    toggle: { box: R(t), reachable: toggle === atToggle || toggle.contains(atToggle) },
  };
})()`;

export async function historyLayoutCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} history layout: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  const removeFixture = addFixture(outDir);
  const sizeTo = async (width: number) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      resizeOffscreen(win, width, 900);
      if (await waitFor(async () => { win.webContents.invalidate(); return (await js('window.innerWidth')) === width; }, 3000)) return true;
    }
    return false;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const probe = (code: string): Promise<any> => js(code);
  const openHistory = (id: string) => js(`PastelTerm.history.open().then(() => { PastelTerm.history.select(${JSON.stringify(id)}); return PastelTerm.history.setPreviewMode('replies'); }).then(() => { ${OPEN_SECTIONS}; })`);
  const replyShown = () => waitFor(() => js("document.querySelectorAll('#history-preview .history-reply table').length >= 4"), 8000);

  try {
    applyTheme('paleSky', { persist: false });
    await js("PastelTerm.cat.setCat('mika'); PastelTerm.cat.setScene('planetarium')");
    await js("window.pastel.config.save({ history: { listCollapsed: false } })");

    // 1-3 in History: docked reply box, no sideways scroll, cat off the content; notes closed and open.
    for (const notesOpen of [false, true]) {
      await js(`PastelTerm.notesPanel.setOpen(${notesOpen})`);
      for (const width of WIDTHS) {
        const tag = `${width}px notes ${notesOpen ? 'open' : 'closed'}`;
        check(await sizeTo(width), `${tag} window sized`);
        await openHistory(LONG);
        check(await replyShown(), `${tag} long reply with tables shown`);
        for (const where of ['top', 'middle', 'bottom']) {
          await js(`(() => { const p = document.getElementById('history-preview'); p.scrollTop = ${JSON.stringify(where)} === 'top' ? 0 : ${JSON.stringify(where)} === 'middle' ? (p.scrollHeight - p.clientHeight) / 2 : p.scrollHeight; })()`);
          await wait(200);
          const m = await probe(PREVIEW);
          const at = `${tag} scrolled ${where} (${m.scrollTop}/${m.scrollMax})`;
          check(m.box && !m.boxInScroller && m.box.bottom <= m.history.bottom && m.box.top >= m.preview.bottom - 1,
            `${at} reply box docked below the scroller: box ${JSON.stringify(m.box)}, preview ${JSON.stringify(m.preview)}, in scroller ${m.boxInScroller}`);
          check(m.hits.length === 0, `${at} no preview text under the reply box: ${JSON.stringify(m.hits)}`);
          check(!/rgba\(.*, 0\)$|transparent/.test(m.boxBackground), `${at} reply box opaque: ${m.boxBackground}`);
          check(m.sideways.length === 0, `${at} nothing scrolls sideways: ${JSON.stringify(m.sideways)}`);
          check(m.catHits.length === 0, `${at} cat corner covers no History text: ${JSON.stringify(m.catHits)}`);
        }
        if (width === 1280 || width === 990) await capture(`history-layout-${width}-notes-${notesOpen ? 'open' : 'closed'}`);
      }
    }
    await js('PastelTerm.notesPanel.setOpen(false)');

    // 3 in every other overlay.
    await sizeTo(1280);
    for (const [id, opener] of [['customize', "PastelTerm.customize.open('today')"], ['customize', 'PastelTerm.customize.open()'], ['repos', 'PastelTerm.repos.open()']] as const) {
      await js(`Promise.resolve(${opener}).catch(() => PastelTerm.overlays.show(${JSON.stringify(id)}))`);
      await wait(600);
      const m = await probe(OVERLAY(id));
      check(m.open && m.hits.length === 0, `${id} open, cat corner covers none of it: cat ${JSON.stringify(m.cat)} hits ${JSON.stringify(m.hits)}`);
      await js(`PastelTerm.overlays.hideCurrent()`);
    }

    // Plain list: newest first, A–Z by title, no tag UI, search still filters; Today groups by project.
    await sizeTo(1280);
    await openHistory(LONG);
    const ROWS = "[...document.querySelectorAll('#history-list .history-row')].map((r) => ({ id: r.dataset.sessionId, title: r.querySelector('.history-title-text').textContent }))";
    type Row = { id: string; title: string };
    const listed: { id: string; lastAt: number }[] = await js('window.pastel.history.list().then((r) => r.sessions.map((s) => ({ id: s.sessionId, lastAt: s.lastAt })))');
    const recent: Row[] = await js(ROWS);
    const newestFirst = [...listed].sort((a, b) => b.lastAt - a.lastAt).map((x) => x.id);
    check(recent.length === listed.length && recent.every((r, i) => r.id === newestFirst[i]), `rows newest first: ${recent.length} rows, first ${JSON.stringify(recent.slice(0, 3))}`);
    await js(`document.querySelector('#history-sort [data-sort="title"]').click()`);
    const az: Row[] = await js(ROWS);
    const sorted = [...az].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    check(az.length === recent.length && az.every((r, i) => r.id === sorted[i]?.id), `A–Z sorts by title: ${JSON.stringify(az.slice(0, 3).map((r) => r.title))}`);
    await capture('history-layout-az-1280');
    await js(`document.querySelector('#history-sort [data-sort="recent"]').click()`);
    const tagUi = await js("['.history-tag', '.history-tagbar', '.history-tag-add', '[data-group]', '#history-tidy', '.history-group-heading', '.history-preview-tags'].filter((sel) => document.querySelector('#history ' + sel))");
    check(tagUi.length === 0, `no tag, group or Tidy UI in History: ${JSON.stringify(tagUi)}`);
    const searchFor = (text: string) => js(`(() => { const s = document.getElementById('history-search'); s.value = ${JSON.stringify(text)}; s.dispatchEvent(new Event('input')); })()`);
    await searchFor('backfill re-run');
    const found: Row[] = await js(ROWS);
    check(found.length >= 1 && found.every((r) => /backfill re-run/i.test(r.title)) && found.some((r) => r.id === LONG), `search filters: ${JSON.stringify(found)}`);
    await searchFor('');
    const today = await js('window.pastel.workflow.today([])');
    check(today.groupedBy === 'project', `Workflow Today groups by ${today.groupedBy}`);
    await js('PastelTerm.history.close()');

    // History list collapse: preview takes the freed width, rail keeps the title, Cmd+\\ expands, config remembers.
    for (const width of [1280, 990]) {
      await sizeTo(width);
      await openHistory(LONG);
      await replyShown();
      const before = await js(`(() => ({ list: document.querySelector('.history-list-pane').getBoundingClientRect().width, preview: document.querySelector('.history-preview-pane').getBoundingClientRect().width }))()`);
      await js("document.querySelector('.history-list-toggle').click()");
      await wait(300);
      const shut = await js(`(() => {
        const pane = document.querySelector('.history-list-pane');
        const rail = pane.querySelector('.history-rail');
        return { list: pane.getBoundingClientRect().width, preview: document.querySelector('.history-preview-pane').getBoundingClientRect().width,
          railTitle: rail?.querySelector('.history-rail-title')?.textContent ?? null, searchShown: document.getElementById('history-search').getClientRects().length > 0,
          expand: Boolean(rail?.querySelector('.history-list-toggle')), over: document.getElementById('history').scrollWidth - document.getElementById('history').clientWidth };
      })()`);
      const saved = await waitFor(() => loadConfig().history.listCollapsed || null, 3000);
      check(shut.list <= 56 && shut.preview >= before.preview + before.list - shut.list - 2 && shut.over <= 1,
        `${width}px collapsed: list ${before.list} -> ${shut.list}, preview ${before.preview} -> ${shut.preview}, sideways ${shut.over}`);
      check(shut.expand && shut.railTitle === 'Backfill re-run safety' && !shut.searchShown, `${width}px rail shows expand + title only: ${JSON.stringify(shut)}`);
      check(saved, `${width}px collapsed state saved: ${JSON.stringify(loadConfig().history)}`);
      if (width === 1280) await capture('history-layout-collapsed-1280');
      await js('PastelTerm.history.close()');
      await openHistory(LONG);
      check(await waitFor(async () => (await js("document.querySelector('.history-list-pane').getBoundingClientRect().width <= 56")) || null, 3000), `${width}px still collapsed after reopening History`);
      await js("document.getElementById('history').dispatchEvent(new KeyboardEvent('keydown', { key: '\\\\', code: 'Backslash', metaKey: true, bubbles: true }))");
      await wait(300);
      const back = await js(`(() => ({ list: document.querySelector('.history-list-pane').getBoundingClientRect().width, preview: document.querySelector('.history-preview-pane').getBoundingClientRect().width }))()`);
      const unsaved = await waitFor(() => loadConfig().history.listCollapsed === false || null, 3000);
      check(Math.abs(back.list - before.list) <= 1 && Math.abs(back.preview - before.preview) <= 1 && unsaved,
        `${width}px Cmd+\\ expands: list ${back.list} (was ${before.list}), preview ${back.preview} (was ${before.preview}), saved ${JSON.stringify(loadConfig().history)}`);
    }

    // The "running in another terminal" banner sits in the preview column, and stays visible with the list collapsed.
    historyFixture.live = [OTHER];
    await openHistory(OTHER);
    await js(`document.querySelector('.history-row[data-session-id="${OTHER}"]').click()`);
    await waitFor(() => js("Boolean(document.querySelector('#history-open-note button'))"), 5000);
    await js("document.querySelector('.history-list-toggle').click()");
    await wait(300);
    const banner = await js(`(() => { const n = document.getElementById('history-open-note'); return { inPreview: Boolean(n.closest('.history-preview-pane')), shown: n.getClientRects().length > 0 && n.getBoundingClientRect().width > 0, text: n.textContent }; })()`);
    check(banner.inPreview && banner.shown && banner.text.includes('Open anyway'), `fork banner in the preview column, visible with the list collapsed: ${JSON.stringify(banner)}`);
    await capture('history-layout-banner-collapsed');
    await js("document.querySelector('.history-list-toggle').click()");
    historyFixture.live = [];
    await js('PastelTerm.history.close()');

    // 4 Notes: ended tab keeps its session's notes, a fresh tab says so, History has notes for a past session.
    await js('PastelTerm.notesPanel.setOpen(true)');
    const reply = { id: 'r1', timestamp: new Date().toISOString(), prompt: 'is it safe?', markdown: LONG_REPLY };
    const update = (state: string, sessionId: string | null, tabId: string) => js(`PastelTerm.reader.update(${JSON.stringify({ state, replies: state === 'none' ? [] : [reply], waiting: [], promptCount: 1, busy: false, sessionId, cwd: null, repo: null, tabId })}); ${OPEN_SECTIONS}`);
    await update('live', LONG, 'ended-probe');
    await update('ended', null, 'ended-probe');
    const ended = await waitFor(() => js(`document.querySelector('#notes-panel .notes[data-session-id="${LONG}"] .notes-editor:not([disabled])') ? true : null`), 5000);
    check(ended, `ended-session tab keeps that session's notes editor: ${await js("document.querySelector('#notes-panel .notes-panel-body').textContent.slice(0, 80)")}`);
    await capture('history-layout-notes-ended-1280');
    await update('none', null, 'fresh-probe');
    const fresh = await js("document.querySelector('#notes-panel .notes-empty')?.textContent ?? ''");
    check(fresh === 'No Claude session in this tab yet', `fresh shell tab: "${fresh}"`);
    await update('ended', null, 'ended-probe');
    check(await waitFor(() => js(`Boolean(document.querySelector('#notes-panel .notes[data-session-id="${LONG}"]'))`), 3000), 'back on the ended tab: its notes again');
    await openHistory(OTHER);
    const past = await waitFor(() => js(`document.querySelector('#history-notes .notes[data-session-id="${OTHER}"] .notes-editor:not([disabled])') ? true : null`), 5000);
    check(past, 'History: a past session has its notes editor');
    await js('PastelTerm.history.close()');

    // Notes toggle reachable, panel fills the reader's height, cat clear of the text, in every look at 1280 and 990.
    for (const [look] of READING_CHOICES) {
      await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
      await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
      for (const width of [1280, 990, 800]) {
        await sizeTo(width);
        await update('live', LONG, 'ended-probe');
        await wait(400);
        for (const where of [0, 0.5, 1]) {
          await js(`(() => { const r = document.getElementById('reader'); r.scrollTop = (r.scrollHeight - r.clientHeight) * ${where}; })()`);
          await wait(150);
          const m = await probe(READER);
          const tag = `${look} ${width}px scroll ${where}`;
          check(m.toggle.box.width > 0 && m.toggle.reachable, `${tag} Notes toggle visible and clickable: ${JSON.stringify(m.toggle)}`);
          check(m.hits.length === 0, `${tag} cat ${JSON.stringify(m.cat)} covers no reply text: ${JSON.stringify(m.hits)} ${JSON.stringify(m.where)}`);
          check(m.sideways.length === 0, `${tag} nothing scrolls sideways: ${JSON.stringify(m.sideways)}`);
          if (where !== 0) continue;
          check(m.panelOpen && Math.abs(m.panel.top - m.head.top) <= EDGE_PX && Math.abs(m.panel.bottom - m.composer.bottom) <= EDGE_PX,
            `${tag} panel spans header top ${m.head.top} to composer bottom ${m.composer.bottom}: ${JSON.stringify(m.panel)}`);
          check(m.editor && m.editor.height >= 0.7 * m.panel.height, `${tag} notes editor ${m.editor?.height} of panel ${m.panel.height}`);
        }
        if (width !== 800) await capture(`history-layout-reader-${look}-${width}`);
      }
    }
    await js("window.pastel.look.setReading('newspaper')");

    // History's notes panel fills its height too.
    for (const width of [1280, 990]) {
      await sizeTo(width);
      await openHistory(LONG);
      await wait(400);
      const h = await js(`(() => { const n = document.getElementById('history-notes').getBoundingClientRect(), v = document.getElementById('history').getBoundingClientRect(), e = document.querySelector('#history-notes .notes-editor').getBoundingClientRect(); return { top: n.top, bottom: n.bottom, height: n.height, viewTop: v.top, viewBottom: v.bottom, editor: e.height }; })()`);
      check(Math.abs(h.top - h.viewTop) <= EDGE_PX && Math.abs(h.bottom - h.viewBottom) <= EDGE_PX && h.editor >= 0.7 * h.height, `${width}px History notes fill the view: ${JSON.stringify(h)}`);
      await js('PastelTerm.history.close()');
    }

    // Cat corner returns to the same rect after Notes opens and closes, in the reader and in History.
    for (const width of [1280, 990]) {
      await sizeTo(width);
      for (const where of ['reader', 'history'] as const) {
        if (where === 'history') await openHistory(LONG);
        await js('PastelTerm.notesPanel.setOpen(false)');
        await wait(400);
        const rect = () => js("(() => { const c = document.getElementById('cat'); const b = c.getBoundingClientRect(); return c.getClientRects().length ? [b.left, b.top, b.width, b.height].map(Math.round) : null; })()");
        const before = await rect();
        await js('PastelTerm.notesPanel.setOpen(true)');
        await wait(400);
        const during = await rect();
        await js('PastelTerm.notesPanel.setOpen(false)');
        await wait(400);
        const after = await rect();
        const same = JSON.stringify(before) === JSON.stringify(after) || (before && after && before.every((v: number, i: number) => Math.abs(v - after[i]) <= 1));
        check(same, `${width}px ${where} cat rect before ${JSON.stringify(before)}, notes open ${JSON.stringify(during)}, after close ${JSON.stringify(after)}`);
        if (where === 'history') await js('PastelTerm.history.close()');
      }
    }
  } finally {
    await js('PastelTerm.notesPanel.setOpen(false)');
    await js('PastelTerm.history.close()');
    removeFixture();
    resizeOffscreen(win, startWidth, startHeight);
  }
}
