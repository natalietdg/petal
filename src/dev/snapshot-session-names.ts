// Session names (PASTEL_SNAPSHOT_MODE=session-names): one session is called the same thing in the Sessions panel,
// its terminal tab, History and the reader header; a title that lands later renames all of them; never "<folder>-<id>".
import fs from 'node:fs';
import path from 'node:path';
import { nativeImage, type BrowserWindow, type NativeImage } from 'electron';
import type { Kit, TabsDeps } from './snapshot';
import * as closedStore from '../main/closed-store';
import { extraTabFixtures, historyFixture, panelFixture, userDataDir } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { READING_CHOICES } from '../main/menu';
import { sessionLabelText, sessionTitle } from '../shared/session-label';
import { assertFixtureOutsideClaude } from './snapshot-views';
import type { SessionFile } from '../main/claude-session';

interface Fixture {
  id: string;
  folder: string;
  claudeName: string; // what Claude Code writes in ~/.claude/sessions/<pid>.json; must never show
  organizer: string | null;
  aiTitle: string | null;
  prompt: string;
}

// Titled by the organizer, by Claude Code (long, so it is cut), by her first prompt only, and not at all yet.
const ORGANIZED: Fixture = { id: '5e5e5e01-0000-4000-8000-0000000000e1', folder: 'BusinessLogic-Report', claudeName: 'businesslogic-report-59', organizer: 'Send countryCode to VN email template', aiTitle: 'Email template country', prompt: 'the VN email template needs the countryCode' };
const AI_TITLED: Fixture = { id: '5e5e5e02-0000-4000-8000-0000000000e2', folder: 'BusinessLogic-Finance', claudeName: 'businesslogic-finance-02', organizer: null, aiTitle: 'Traced stale fees spec to the settlement job that still reads the old fee table every night', prompt: 'why are the fees stale?' };
const PROMPT_ONLY: Fixture = { id: '5e5e5e03-0000-4000-8000-0000000000e3', folder: 'BusinessLogic-Report', claudeName: 'businesslogic-report-99', organizer: null, aiTitle: null, prompt: 'Bank name Vietnamese update to staging' };
const UNTITLED: Fixture = { id: '5e5e5e04-0000-4000-8000-0000000000e4', folder: 'natalieleong', claudeName: 'natalieleong-a7', organizer: null, aiTitle: null, prompt: '' };
const OPEN = [ORGANIZED, AI_TITLED, PROMPT_ONLY, UNTITLED];
// Closed from the panel under the old rule's folder name; listed again it gets its real title.
const CLOSED: Fixture = { id: '5e5e5e05-0000-4000-8000-0000000000e5', folder: 'Patch-Script', claudeName: 'patch-script-3c', organizer: null, aiTitle: 'Fix settlement invoice dates and currency symbols in the monthly PDF', prompt: 'invoice dates are off' };
const LATE_TITLE = 'Monthly statement job trigger';
const HOST_ID = /^[\w.]+-[0-9a-f]{2,4}$/; // "natalieleong-a7"

const fullTitle = (f: Fixture, organizer = f.organizer): string =>
  sessionTitle({ organizerTitle: organizer, title: f.aiTitle ?? f.prompt, firstPrompt: f.prompt, cwd: f.folder });

// Everything each surface shows for each fixture session: text and hover title.
const SURFACES = `(() => {
  const named = (e) => e ? { text: e.textContent, tip: e.title || e.closest('[title]')?.title || '' } : null;
  const ids = ${JSON.stringify([...OPEN, CLOSED].map((f) => f.id))};
  const out = {};
  for (const id of ids) {
    const tab = PastelTerm.tabs.ids().map((t) => PastelTerm.tabs.get(t)).find((t) => t.update?.sessionId === id);
    out[id] = {
      tab: tab ? named(tab.element.querySelector('.tab-label')) : null,
      panel: named(document.querySelector('#sessions-panel .session-row[data-session-id="' + id + '"] .session-name, #sessions-panel .closed-row[data-session-id="' + id + '"] .session-name')),
      history: named(document.querySelector('#history-list .history-row[data-session-id="' + id + '"] .history-title-text')),
    };
  }
  const every = [...document.querySelectorAll('#tab-strip .tab-label, #sessions-panel .session-name, #history-list .history-title-text, #reader-session')].map((e) => e.textContent);
  return { out, every };
})()`;

// Page-level and per-surface sideways overflow, and labels running past their row.
const OVERFLOW = `(() => {
  const over = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > window.innerWidth + 1) over.push({ id: 'page', by: doc.scrollWidth - window.innerWidth });
  for (const s of ['#sessions-panel', '#history', '.history-list-pane', '#history-list', '#history-preview', '#reader-head', '.reader-context']) {
    const e = document.querySelector(s);
    if (e && e.getClientRects().length && e.scrollWidth - e.clientWidth > 1) over.push({ id: s, by: e.scrollWidth - e.clientWidth });
  }
  for (const label of document.querySelectorAll('#sessions-panel .session-name, #history-list .history-title-text, #reader-session, .history-preview-title')) {
    if (!label.getClientRects().length) continue;
    const box = label.getBoundingClientRect();
    const row = (label.closest('.session-row, .closed-row, .history-row, .reader-context, .history-preview-title-row') ?? label.parentElement).getBoundingClientRect();
    if (box.right > row.right + 1) over.push({ id: label.className || label.id, text: label.textContent, by: Math.round(box.right - row.right) });
    if (label.scrollWidth > label.clientWidth + 1 && !label.title) over.push({ id: label.className || label.id, text: label.textContent, cut: 'no tooltip' });
  }
  return over;
})()`;

function writeLog(file: string, prompt: string, aiTitle: string | null): void {
  assertFixtureOutsideClaude(file);
  const at = new Date().toISOString();
  const lines = prompt ? [
    { type: 'user', uuid: `${path.basename(file)}-u`, timestamp: at, isSidechain: false, message: { role: 'user', content: prompt } },
    { type: 'assistant', uuid: `${path.basename(file)}-a`, timestamp: at, isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text: 'On it.' }] } },
    ...(aiTitle ? [{ type: 'ai-title', aiTitle }] : []),
  ] : [];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + (lines.length ? '\n' : ''));
}

// Side by side, top-aligned, on the page background: the panel, the tab strip and History.
function sideBySide(images: NativeImage[], background: [number, number, number]): NativeImage | null {
  const GAP = 16;
  const parts = images.map((img) => { const { width, height } = img.getSize(); return { width, height, bitmap: img.resize({ width, height }).toBitmap() }; });
  if (parts.some((p) => p.bitmap.length !== p.width * p.height * 4)) return null;
  const width = parts.reduce((sum, p) => sum + p.width, 0) + GAP * (parts.length + 1);
  const height = Math.max(...parts.map((p) => p.height)) + GAP * 2;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) out.set([background[2], background[1], background[0], 255], i * 4); // BGRA
  let x = GAP;
  for (const p of parts) {
    for (let row = 0; row < p.height; row++) p.bitmap.copy(out, ((row + GAP) * width + x) * 4, row * p.width * 4, (row + 1) * p.width * 4);
    x += p.width + GAP;
  }
  return nativeImage.createFromBitmap(out, { width, height });
}

export async function sessionNamesCheck(kit: Kit, { win, openTab }: Pick<TabsDeps, 'openTab'> & { win: BrowserWindow }): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, themes, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} session names: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  const sizeTo = async (width: number) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      resizeOffscreen(win, width, 900);
      if (await waitFor(async () => { win.webContents.invalidate(); return (await js('window.innerWidth')) === width; }, 3000)) return true;
    }
    return false;
  };
  const dir = path.join(outDir, 'session-names');
  const organizerFile = path.join(userDataDir(), 'organizer.json');
  const closedFile = path.join(userDataDir(), 'closed.json');
  const savedOrganizer = fs.existsSync(organizerFile) ? fs.readFileSync(organizerFile, 'utf8') : null;
  const savedClosed = fs.existsSync(closedFile) ? fs.readFileSync(closedFile, 'utf8') : null;
  const savedPanel = { ...panelFixture };
  const startTabs: string[] = await js('PastelTerm.tabs.ids()');
  const startActive: string | null = await js('PastelTerm.tabs.active()?.id ?? null');

  const writeOrganizer = (extra: Record<string, string>) => {
    const base = savedOrganizer ? JSON.parse(savedOrganizer) : {};
    const at = new Date().toISOString();
    for (const [id, title] of Object.entries(extra)) base[id] = { title, project: null, status: 'in progress', mtimeMs: Date.now(), at };
    fs.mkdirSync(path.dirname(organizerFile), { recursive: true });
    fs.writeFileSync(organizerFile, JSON.stringify(base, null, 1));
  };

  try {
    applyTheme('paleSky', { persist: false });
    await js("window.pastel.look.setReading('newspaper')");
    check(await sizeTo(1280), '1280px window sized');

    // Fixture: History records, live sessions for the panel, a closed one, organizer titles, and a tab per open session.
    const now = Date.now();
    historyFixture.records = [...OPEN, CLOSED].map((f, i) => {
      const file = path.join(dir, `${f.id}.jsonl`);
      writeLog(file, f.prompt, f.aiTitle);
      return { sessionId: f.id, file, cwd: path.join(dir, f.folder), title: f.aiTitle ?? f.prompt, firstPrompt: f.prompt, lastAt: now + 60_000 - i * 1000, messages: f.prompt ? 2 : 0, messagesExact: true };
    });
    historyFixture.live = [];
    panelFixture.subagentsRoot = path.join(dir, 'agents');
    panelFixture.sessions = OPEN.map((f, i): SessionFile => ({ pid: 0, sessionId: f.id, cwd: path.join(dir, f.folder), kind: 'interactive', status: i === 1 ? 'busy' : 'idle', name: f.claudeName, updatedAt: now - i * 60_000 }));
    closedStore.add({ sessionId: CLOSED.id, title: CLOSED.folder, cwd: path.join(dir, CLOSED.folder), closedAt: now - 120_000 });
    writeOrganizer({ [ORGANIZED.id]: ORGANIZED.organizer ?? '' });
    extraTabFixtures.push(...OPEN.map((f) => ({ sessionId: f.id, transcript: path.join(dir, `${f.id}.jsonl`), status: 'idle', cwd: path.join(dir, f.folder) })));
    for (let i = 0; i < OPEN.length; i++) openTab(win.webContents); // each takes the next queued fixture
    const tabsUp = await waitFor(async () => {
      const ids: (string | null)[] = await js('PastelTerm.tabs.ids().map((t) => PastelTerm.tabs.get(t).update?.sessionId ?? null)');
      return OPEN.every((f) => ids.includes(f.id)) ? ids : null;
    }, 15000);
    check(tabsUp, `a tab follows each fixture session: ${JSON.stringify(tabsUp ?? await js('PastelTerm.tabs.ids()'))}`);
    await js('PastelTerm.sessionsPanel.setOpen(true)');
    await js(`PastelTerm.history.open().then(() => PastelTerm.history.select(${JSON.stringify(ORGANIZED.id)}))`);
    // Earlier steps can leave History on Favorites or with a search typed: back to the full list.
    await js("(() => { const s = document.getElementById('history-search'); s.value = ''; s.dispatchEvent(new Event('input')); document.querySelector('#history-tabs [data-list=\"all\"]').click(); })()");

    // 1 Every surface shows the same label, cut the same way, with the full title on hover.
    const expected = (f: Fixture, organizer = f.organizer) => ({ text: sessionLabelText(fullTitle(f, organizer)), tip: fullTitle(f, organizer) });
    const surfacesAgree = async (f: Fixture, organizer = f.organizer, where: string[] = ['tab', 'panel', 'history']) => {
      const want = expected(f, organizer);
      const all = await js(SURFACES);
      const got = all.out[f.id];
      return where.every((w) => got[w]?.text === want.text && got[w]?.tip === want.tip) ? got : null;
    };
    for (const f of OPEN) {
      const got = await waitFor(() => surfacesAgree(f), 8000);
      check(got, `${f.claudeName} is "${expected(f).text}" in the tab, the panel and History: ${JSON.stringify(got ?? (await js(SURFACES)).out[f.id])}`);
    }
    const closed = await waitFor(() => surfacesAgree(CLOSED, null, ['panel', 'history']), 6000);
    check(closed, `Recently closed renames "${CLOSED.folder}" to its title, as History does: ${JSON.stringify(closed ?? (await js(SURFACES)).out[CLOSED.id])}`);
    check(expected(ORGANIZED).text === ORGANIZED.organizer, `organizer title wins: ${expected(ORGANIZED).text}`);
    check(expected(AI_TITLED).text.length <= 60 && expected(AI_TITLED).text.endsWith('…'), `a long title is cut at 60 with an ellipsis: ${expected(AI_TITLED).text}`);
    check(expected(PROMPT_ONLY).text === PROMPT_ONLY.prompt, `no title yet: the first prompt: ${expected(PROMPT_ONLY).text}`);
    check(expected(UNTITLED).text === 'natalieleong · new session', `no title or prompt: folder + new session: ${expected(UNTITLED).text}`);

    // History's preview header and the reader header say the same.
    const preview = await waitFor(() => js("(() => { const h = document.querySelector('#history-preview .history-preview-title'); return h ? { text: h.textContent, tip: h.title } : null; })()"), 5000);
    check(preview && preview.text === expected(ORGANIZED).text && preview.tip === expected(ORGANIZED).tip, `History preview header: ${JSON.stringify(preview)}`);
    await js('PastelTerm.history.close()');
    await js('PastelTerm.sessionsPanel.setOpen(false)');
    const tabOf = (id: string): Promise<string | null> => js(`PastelTerm.tabs.ids().find((t) => PastelTerm.tabs.get(t).update?.sessionId === ${JSON.stringify(id)}) ?? null`);
    const readerHead = () => js("(() => { const e = document.getElementById('reader-session'); return { text: e.textContent, tip: e.title, shown: !e.hidden && e.getBoundingClientRect().width > 0 }; })()");
    for (const f of OPEN) {
      await js(`PastelTerm.tabs.activate(${JSON.stringify(await tabOf(f.id))})`);
      const want = expected(f);
      const head = await waitFor(async () => { const h = await readerHead(); return h.shown && h.text === want.text && h.tip === want.tip ? h : null; }, 4000);
      check(head, `reader header for ${f.claudeName}: ${JSON.stringify(head ?? await readerHead())}`);
    }

    // 2 No "<folder>-<id>" name anywhere, and none of Claude Code's session-file names.
    await js('PastelTerm.sessionsPanel.setOpen(true)');
    await js('PastelTerm.history.open()');
    await wait(600);
    const every: string[] = (await js(SURFACES)).every;
    const hostIds = every.filter((t) => HOST_ID.test(t) || [...OPEN, CLOSED].some((f) => t === f.claudeName));
    check(every.length >= 10 && hostIds.length === 0, `no host-id labels in ${every.length} labels: ${JSON.stringify(hostIds)}`);
    await capture('session-names-1280');

    // 3 A title that lands later renames the tab, the panel row, the History row and the reader header together.
    await js('PastelTerm.history.close()');
    await js(`PastelTerm.tabs.activate(${JSON.stringify(await tabOf(UNTITLED.id))})`);
    await js('PastelTerm.sessionsPanel.setOpen(true)');
    const before = await surfacesAgree(UNTITLED, null, ['tab', 'panel']);
    check(before, `before: still "${expected(UNTITLED).text}"`);
    writeOrganizer({ [ORGANIZED.id]: ORGANIZED.organizer ?? '', [UNTITLED.id]: LATE_TITLE });
    const lateWant = expected(UNTITLED, LATE_TITLE);
    const renamed = await waitFor(async () => {
      const got = await surfacesAgree(UNTITLED, LATE_TITLE, ['tab', 'panel']);
      const head = await readerHead();
      return got && head.text === lateWant.text ? { ...got, reader: head } : null;
    }, 8000);
    check(renamed, `late title reaches the tab, panel and reader header: ${JSON.stringify(renamed ?? { ...(await js(SURFACES)).out[UNTITLED.id], reader: await readerHead() })}`);
    await js('PastelTerm.history.open()');
    const inHistory = await waitFor(() => surfacesAgree(UNTITLED, LATE_TITLE, ['history']), 5000);
    check(inHistory, `and History: ${JSON.stringify(inHistory ?? (await js(SURFACES)).out[UNTITLED.id])}`);
    // History already open when it lands: it re-lists on its own.
    writeOrganizer({ [ORGANIZED.id]: ORGANIZED.organizer ?? '', [UNTITLED.id]: LATE_TITLE, [PROMPT_ONLY.id]: 'Vietnamese bank names on staging' });
    const live = await waitFor(() => surfacesAgree(PROMPT_ONLY, 'Vietnamese bank names on staging'), 8000);
    check(live, `a title landing while History is open renames its row, tab and panel row: ${JSON.stringify(live ?? (await js(SURFACES)).out[PROMPT_ONLY.id])}`);
    await js('PastelTerm.history.close()');

    // 4 Every theme and look, 1280 and 800: nothing sideways, long names cut with a tooltip. PNGs side by side.
    for (const width of [1280, 800]) {
      check(await sizeTo(width), `${width}px window sized`);
      for (const [themeId, theme] of Object.entries(themes)) {
        applyTheme(themeId, { persist: false });
        for (const [look] of READING_CHOICES) {
          await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
          await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
          const tag = `${width}px ${themeId} ${look}`;
          await js('PastelTerm.history.close()');
          await js('PastelTerm.sessionsPanel.setOpen(true)');
          await wait(250);
          const panelOver = await js(OVERFLOW);
          check(panelOver.length === 0, `${tag} panel and reader header: nothing sideways ${JSON.stringify(panelOver)}`);
          const shots: NativeImage[] = [];
          const rect = (selector: string) => js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
          if (look === 'newspaper') {
            shots.push(await win.webContents.capturePage(await rect('#sessions-panel')));
            shots.push(await win.webContents.capturePage(await rect('#tab-strip')));
          }
          await js('PastelTerm.sessionsPanel.setOpen(false)');
          await js('PastelTerm.history.open()');
          await wait(250);
          const historyOver = await js(OVERFLOW);
          check(historyOver.length === 0, `${tag} History: nothing sideways ${JSON.stringify(historyOver)}`);
          if (look === 'newspaper') {
            shots.push(await win.webContents.capturePage(await rect('.history-list-pane')));
            const bg = theme.reader.background;
            const joined = sideBySide(shots, [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16)) as [number, number, number]);
            const file = path.join(outDir, `snapshot-session-names-side-by-side-${themeId}-${width}.png`);
            if (joined) fs.writeFileSync(file, joined.toPNG());
            check(joined, `side-by-side PNG ${file}`);
            await capture(`session-names-history-${themeId}-${width}`);
          }
        }
      }
    }
  } finally {
    applyTheme('paleSky', { persist: false });
    await js("window.pastel.look.setReading('newspaper')");
    await js('PastelTerm.history.close()');
    await js('PastelTerm.sessionsPanel.setOpen(false)');
    extraTabFixtures.length = 0;
    const opened: string[] = (await js('PastelTerm.tabs.ids()')).filter((id: string) => !startTabs.includes(id));
    for (const id of opened) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(id)})`);
    const closedAgain = await waitFor(async () => ((await js('PastelTerm.tabs.ids()')).length === startTabs.length ? true : null), 8000);
    check(closedAgain, `test tabs closed again: ${JSON.stringify(await js('PastelTerm.tabs.ids()'))}`);
    if (startActive) await js(`PastelTerm.tabs.activate(${JSON.stringify(startActive)})`);
    if (savedOrganizer === null) fs.rmSync(organizerFile, { force: true }); else fs.writeFileSync(organizerFile, savedOrganizer);
    if (savedClosed === null) fs.rmSync(closedFile, { force: true }); else fs.writeFileSync(closedFile, savedClosed);
    panelFixture.sessions = savedPanel.sessions;
    panelFixture.subagentsRoot = savedPanel.subagentsRoot;
    historyFixture.records = [];
    historyFixture.live = [];
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
