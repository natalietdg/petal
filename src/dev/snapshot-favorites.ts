// Favorites (PASTEL_SNAPSHOT_MODE=favorites): star from a History row, the preview header and the reader header;
// History › Favorites lists only starred sessions, unstarring removes one, config.json keeps them, opening one works.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { load as loadConfig } from '../main/config-store';
import { historyFixture, panelFixture, userDataDir } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { READING_CHOICES } from '../main/menu';
import { addHistoryFixture, FIXTURE_A, FIXTURE_B } from './snapshot-history-fixture';

// Starred, but its log is gone: kept in config, never shown.
const GONE = 'dededede-0000-4000-8000-0000000000de';
const MESSAGE = 'hello from a favorite';
const EMPTY_LINE = 'Star a session to keep it here.';

const ROWS = "[...document.querySelectorAll('#history-list .history-row')].map((r) => r.dataset.sessionId)";
const rowStar = (id: string) => `document.querySelector('#history-list .history-item:has(.history-row[data-session-id="${id}"]) .history-row-star')`;

// Contrast of each visible star against what it sits on, rows' title clearance, and anything scrolling sideways.
const LOOK = `(() => {
  const rgb = (c) => (c.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = (c) => { const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bgOf = (e) => { let c = 'rgba(0, 0, 0, 0)'; while (e && /rgba\\(.*, 0\\)$|transparent/.test(c = getComputedStyle(e).backgroundColor)) e = e.parentElement; return c; };
  const shown = (e) => e && e.getClientRects().length > 0 && getComputedStyle(e).opacity !== '0';
  const stars = [...document.querySelectorAll('#history .fav-star, #reader-star')].filter(shown).map((s) => ({
    where: s.className, pressed: s.getAttribute('aria-pressed'), contrast: Math.round(ratio(getComputedStyle(s).color, bgOf(s.parentElement)) * 100) / 100,
    width: Math.round(s.getBoundingClientRect().width) }));
  const clash = [...document.querySelectorAll('#history-list .history-item')].filter((item) => {
    const star = item.querySelector('.history-row-star').getBoundingClientRect();
    const title = item.querySelector('.history-title').getBoundingClientRect();
    return shown(item.querySelector('.history-row-star')) && title.right > star.left + 1 && title.top < star.bottom;
  }).map((item) => item.querySelector('.history-row').dataset.sessionId);
  const pane = document.querySelector('.history-list-pane').getBoundingClientRect();
  const tabs = document.getElementById('history-tabs').getBoundingClientRect();
  const sideways = ['html', '#reader-area', '#history', '#history-preview', '.history-list-pane', '#history-list', '.history-preview-head']
    .map((s) => document.querySelector(s)).filter((e) => e && e.getClientRects().length)
    .map((e) => ({ id: e.id || e.className || e.tagName, over: e.scrollWidth - e.clientWidth })).filter((x) => x.over > 1);
  return { stars, clash, tabsFit: tabs.right <= pane.right + 1 && tabs.width > 0, sideways };
})()`;

// The reader header star: shown, small, inside the header's end group, clickable, and clear of its neighbours.
const READER_STAR = `(() => {
  const s = document.getElementById('reader-star');
  const b = s.getBoundingClientRect();
  const at = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
  const others = [...document.querySelectorAll('#reader-head .reader-head-end > :not(#reader-star)')].filter((e) => e.getClientRects().length)
    .map((e) => e.getBoundingClientRect()).filter((o) => o.left < b.right && b.left < o.right && o.top < b.bottom && b.top < o.bottom);
  const head = document.getElementById('reader-head');
  return { shown: !s.hidden && b.width > 0, size: [Math.round(b.width), Math.round(b.height)], pressed: s.getAttribute('aria-pressed'),
    session: s.dataset.sessionId, inEnd: Boolean(s.closest('.reader-head-end')), reachable: at === s || s.contains(at), at: at ? at.id || (typeof at.className === 'string' && at.className) || at.tagName : null, overlaps: others.length,
    sideways: head.scrollWidth - head.clientWidth, fit: PastelTerm.headFit.state().step };
})()`;

export async function favoritesCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, themes, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} favorites: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  const sizeTo = async (width: number) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      resizeOffscreen(win, width, 900);
      if (await waitFor(async () => { win.webContents.invalidate(); return (await js('window.innerWidth')) === width; }, 3000)) return true;
    }
    return false;
  };
  const saved = () => loadConfig().history.favorites;
  const savedOnDisk = (): string[] => {
    try { return JSON.parse(fs.readFileSync(path.join(userDataDir(), 'config.json'), 'utf8')).history?.favorites ?? []; } catch { return []; }
  };
  const savedIs = (ids: string[]) => waitFor(() => (JSON.stringify(saved()) === JSON.stringify(ids) ? true : null), 3000);
  const openHistory = (id: string) => js(`PastelTerm.history.open().then(() => { PastelTerm.history.select(${JSON.stringify(id)}); return PastelTerm.history.setPreviewMode('replies'); })`);
  const tab = (kind: 'all' | 'favorites') => js(`document.querySelector('#history-tabs [data-list="${kind}"]').click()`);
  const rows = (): Promise<string[]> => js(ROWS);
  const removeFixture = addHistoryFixture(outDir);
  const startTabs: string[] = await js('PastelTerm.tabs.ids()');
  const startActive: string | null = await js('PastelTerm.tabs.active()?.id ?? null');
  const opened: string[] = [];
  // The shown tab goes back to its own session, so History's reply box never mistakes it for B's tab.
  const restoreTab = () => js(`(() => { const t = PastelTerm.tabs.get(${JSON.stringify(startActive)}); if (t && window.__favUpdate !== undefined) { PastelTerm.tabs.setUpdate(t.id, window.__favUpdate); delete window.__favUpdate; window.dispatchEvent(new CustomEvent('petal:reader-refresh', { detail: t.id })); } })()`);

  try {
    applyTheme('paleSky', { persist: false });
    await js("window.pastel.look.setReading('newspaper')");
    await js('Promise.all(PastelTerm.favorites.ids().map((id) => PastelTerm.favorites.toggle(id)))'); // start with none starred
    check(await savedIs([]), `no favorites to start: ${JSON.stringify(saved())}`);
    check(await sizeTo(1280), '1280px window sized');

    // Empty state, then the All tab is the plain list as before.
    await openHistory(FIXTURE_A);
    await tab('favorites');
    const empty = await js("({ rows: document.querySelectorAll('#history-list .history-row').length, text: document.querySelector('#history-list .history-empty')?.textContent ?? '', selected: document.querySelector('#history-tabs [aria-selected=\"true\"]')?.dataset.list })");
    check(empty.rows === 0 && empty.text === EMPTY_LINE && empty.selected === 'favorites', `Favorites empty state: ${JSON.stringify(empty)}`);
    await capture('favorites-empty-1280');
    await tab('all');
    const all = await rows();
    check(all.includes(FIXTURE_A) && all.includes(FIXTURE_B), `All lists both fixture sessions: ${JSON.stringify(all.slice(0, 4))}`);
    const hidden = await js(`getComputedStyle(${rowStar(FIXTURE_B)}).opacity`);
    check(hidden === '0', `an unstarred row's star waits for hover: opacity ${hidden}`);

    // 1 Star from a row: no tab opens and History stays; it shows in Favorites.
    const tabsBefore = (await js('PastelTerm.tabs.ids()')).length;
    await js(`${rowStar(FIXTURE_A)}.click()`);
    check(await savedIs([FIXTURE_A]), `row star saved: ${JSON.stringify(saved())}`);
    const afterRow = await js(`({ pressed: ${rowStar(FIXTURE_A)}.getAttribute('aria-pressed'), opacity: getComputedStyle(${rowStar(FIXTURE_A)}).opacity, open: !document.getElementById('history').hidden, tabs: PastelTerm.tabs.ids().length })`);
    check(afterRow.pressed === 'true' && afterRow.opacity === '1' && afterRow.open && afterRow.tabs === tabsBefore, `row star pressed, always shown, History open, no tab opened: ${JSON.stringify(afterRow)}`);
    await tab('favorites');
    check(JSON.stringify(await rows()) === JSON.stringify([FIXTURE_A]), `Favorites lists the starred row: ${JSON.stringify(await rows())}`);

    // 2 Star from the preview header.
    await js(`PastelTerm.history.select(${JSON.stringify(FIXTURE_B)})`);
    await waitFor(() => js("Boolean(document.querySelector('#history-preview .history-preview-star'))"), 5000);
    const head = await js("(() => { const s = document.querySelector('#history-preview .history-preview-star'); return { pressed: s.getAttribute('aria-pressed'), inTitleRow: Boolean(s.closest('.history-preview-title-row')), label: s.getAttribute('aria-label') }; })()");
    check(head.pressed === 'false' && head.inTitleRow && head.label === 'Add to Favorites', `preview header star beside the title, off: ${JSON.stringify(head)}`);
    await js("document.querySelector('#history-preview .history-preview-star').click()");
    check(await savedIs([FIXTURE_A, FIXTURE_B]), `preview star saved: ${JSON.stringify(saved())}`);
    const both = await rows();
    check(both.length === 2 && both[0] === FIXTURE_A && both[1] === FIXTURE_B, `Favorites newest first: ${JSON.stringify(both)}`);
    check(await js(`${rowStar(FIXTURE_B)}.getAttribute('aria-pressed') === 'true' && document.querySelector('#history-preview .history-preview-star').getAttribute('aria-pressed') === 'true'`), 'row and preview stars agree');

    // Same sort control in Favorites.
    await js("document.querySelector('#history-sort [data-sort=\"title\"]').click()");
    const az = await js("[...document.querySelectorAll('#history-list .history-row .history-title-text')].map((t) => t.textContent)");
    check(JSON.stringify(az) === JSON.stringify(['Fixture session A', 'Fixture session B']) && (await rows()).length === 2, `A–Z sorts Favorites: ${JSON.stringify(az)}`);
    await capture('favorites-starred-az-1280');
    await js("document.querySelector('#history-sort [data-sort=\"recent\"]').click()");

    // 3 Unstar removes it from Favorites at once.
    await js(`${rowStar(FIXTURE_B)}.click()`);
    check(await savedIs([FIXTURE_A]), `unstar saved: ${JSON.stringify(saved())}`);
    check(JSON.stringify(await rows()) === JSON.stringify([FIXTURE_A]), `unstarred row left Favorites: ${JSON.stringify(await rows())}`);
    await js('PastelTerm.history.close()');

    // 4 Star from the reader header: the shown tab follows session B.
    await js(`(() => { const t = PastelTerm.tabs.active(); window.__favUpdate = t.update; PastelTerm.tabs.setUpdate(t.id, { ...(t.update ?? { state: 'live', replies: [], waiting: [], promptCount: 0, busy: false, cwd: null, repo: null, label: 'fixture' }), sessionId: ${JSON.stringify(FIXTURE_B)} }); window.dispatchEvent(new CustomEvent('petal:reader-refresh', { detail: t.id })); })()`);
    const reader = await waitFor(async () => { const r = await js(READER_STAR); return r.shown && r.session === FIXTURE_B && r.reachable ? r : null; }, 4000); // History may still be closing
    check(reader && reader.pressed === 'false' && reader.inEnd && reader.reachable && reader.overlaps === 0 && reader.size[0] <= 32 && reader.size[1] <= 32,
      `reader header star small, beside Notes, clickable, off: ${JSON.stringify(reader ?? await js(READER_STAR))}`);
    await js("document.getElementById('reader-star').click()");
    check(await savedIs([FIXTURE_A, FIXTURE_B]), `reader star saved: ${JSON.stringify(saved())}`);
    check((await js(READER_STAR)).pressed === 'true', 'reader star now on');
    await capture('favorites-reader-star-1280');
    await restoreTab();

    // A starred session whose log is gone: kept in config, not listed, nothing breaks.
    await js(`PastelTerm.favorites.toggle(${JSON.stringify(GONE)})`);
    check(await savedIs([FIXTURE_A, FIXTURE_B, GONE]), `missing session's id kept: ${JSON.stringify(saved())}`);

    // 5 Saved to config.json and read back when History reopens.
    const disk = savedOnDisk();
    check(JSON.stringify(disk) === JSON.stringify([FIXTURE_A, FIXTURE_B, GONE]), `config.json on disk: ${JSON.stringify(disk)}`);
    const viaIpc = await js('window.pastel.config.get().then((r) => r.config.history.favorites)');
    check(JSON.stringify(viaIpc) === JSON.stringify(disk), `config:get reloads them: ${JSON.stringify(viaIpc)}`);
    await openHistory(FIXTURE_A);
    await tab('favorites');
    const reopened = await rows();
    const errors = await js("document.querySelectorAll('#history .history-error').length");
    check(JSON.stringify(reopened) === JSON.stringify([FIXTURE_A, FIXTURE_B]) && errors === 0, `reopened History › Favorites: ${JSON.stringify(reopened)}, missing one not shown, errors ${errors}`);
    await capture('favorites-list-1280');

    // 6 Opening a favorite: hover previews it, the reply box sends, the row opens the tab answering it.
    // Her limit counts the fixture's sessions only, so her real Claudes can never block this.
    const counted = await js('window.pastel.getSessions({ detailed: false, expandedIds: [] }).then((v) => v.counts?.total ?? v.error)');
    const fixtureCount = panelFixture.sessions?.length ?? 0;
    check(counted === fixtureCount, `session count is the fixture's: ${JSON.stringify(counted)}, want ${fixtureCount}`);
    await js(`document.querySelector('#history-list .history-row[data-session-id="${FIXTURE_B}"]').dispatchEvent(new MouseEvent('mouseenter'))`);
    let last: unknown = null;
    const pv = await waitFor(async () => {
      const p = await js("({ title: document.querySelector('#history-preview .history-preview-title')?.textContent, star: document.querySelector('#history-preview .history-preview-star')?.getAttribute('aria-pressed'), reply: document.querySelector('#history-preview .history-reply')?.textContent ?? '', box: Boolean(document.querySelector('#history-reply-dock .history-reply-input')) })");
      last = p;
      return p.title === 'Fixture session B' && p.box && p.reply.includes('Mika') ? p : null;
    }, 6000);
    check(pv && pv.star === 'true', `favorite's preview and reply box shown: ${JSON.stringify(pv ?? last)}`);
    historyFixture.resumes = [];
    await js(`(() => { const box = document.querySelector('#history-reply-dock .history-reply-input'); box.value = ${JSON.stringify(MESSAGE)}; box.dispatchEvent(new Event('input')); box.closest('form').requestSubmit(); })()`);
    const sent = await waitFor(async () => {
      const s = await js(`({ ids: PastelTerm.tabs.ids(), you: [...document.querySelectorAll('#history-preview .history-you')].map((b) => b.textContent).at(-1) })`);
      return s.ids.length === startTabs.length + 1 && s.you === MESSAGE ? s : null;
    }, 8000);
    const bg = sent?.ids.at(-1);
    if (bg) opened.push(bg);
    check(sent && historyFixture.resumes.includes(FIXTURE_B), `reply from a favorite opened a background tab with its resume: ${JSON.stringify(sent)} ${JSON.stringify(historyFixture.resumes)}`);
    await capture('favorites-reply-1280');
    // Clicking the row goes through the same open path as All: marked running elsewhere, it asks before forking and types nothing.
    historyFixture.live = [FIXTURE_A];
    await js(`document.querySelector('#history-list .history-row[data-session-id="${FIXTURE_A}"]').click()`);
    const asked = await waitFor(() => js("(() => { const t = document.getElementById('history-open-note').textContent; return /Open anyway/.test(t) ? t : null; })()"), 5000);
    const still = await js('PastelTerm.tabs.ids().length');
    check(asked && still === startTabs.length + opened.length && historyFixture.resumes.length === 1, `clicking a favorite opens it like the All list (fork check, nothing typed): ${JSON.stringify(asked ?? await js("document.getElementById('history-open-note').textContent"))}, tabs ${still}, resumes ${JSON.stringify(historyFixture.resumes)}`);
    await capture('favorites-open-1280');
    historyFixture.live = [];
    await js('PastelTerm.history.close()');
    if (startActive) await js(`PastelTerm.tabs.activate(${JSON.stringify(startActive)})`);

    // 7 Every look and theme, 1600 down to 800: stars readable, titles clear of them, tabs fit, nothing sideways.
    for (const width of [1600, 1280, 990, 800]) {
      check(await sizeTo(width), `${width}px window sized`);
      for (const [themeId] of Object.entries(themes)) {
        applyTheme(themeId, { persist: false });
        for (const [look] of READING_CHOICES) {
          await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
          await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
          await openHistory(FIXTURE_A);
          await tab('favorites');
          await wait(200);
          const tag = `${width}px ${themeId} ${look}`;
          const m = await js(LOOK);
          check(m.stars.length >= 3 && m.stars.every((s: { contrast: number }) => s.contrast >= 3), `${tag} stars readable (3:1): ${JSON.stringify(m.stars)}`);
          check(m.clash.length === 0 && m.tabsFit, `${tag} titles clear of stars ${JSON.stringify(m.clash)}, tabs fit ${m.tabsFit}`);
          check(m.sideways.length === 0, `${tag} nothing scrolls sideways: ${JSON.stringify(m.sideways)}`);
          if (look === 'newspaper') await capture(`favorites-${themeId}-${width}`);
          await js('PastelTerm.history.close()');
          await wait(150);
          const r = await js(READER_STAR);
          check(r.shown && r.reachable && r.overlaps === 0 && r.sideways <= 1, `${tag} reader star clickable, clear of the header controls: ${JSON.stringify(r)}`);
          if (look === 'newspaper' && themeId === 'paleSky') await capture(`favorites-reader-head-${width}`);
        }
      }
    }
  } finally {
    applyTheme('paleSky', { persist: false });
    await js("window.pastel.look.setReading('newspaper')");
    await js('PastelTerm.history.close()');
    await js('Promise.all(PastelTerm.favorites.ids().map((id) => PastelTerm.favorites.toggle(id)))');
    await restoreTab();
    for (const id of opened) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(id)})`);
    const closed = await waitFor(async () => ((await js('PastelTerm.tabs.ids()')).length === startTabs.length ? true : null), 8000);
    check(closed, `test tabs closed again: ${JSON.stringify(await js('PastelTerm.tabs.ids()'))}`);
    if (startActive) await js(`PastelTerm.tabs.activate(${JSON.stringify(startActive)})`);
    removeFixture();
    historyFixture.resumes = [];
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
