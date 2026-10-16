// Sessions board (PASTEL_SNAPSHOT_MODE=sessions-board): one card per open Claude session, opened from the Sessions
// panel or ⌘⇧O; Waiting first and highlighted, live on the 2s tick, gated while reading is off, no overflow anywhere.
import fs from 'node:fs';
import path from 'node:path';
import { Menu, type BrowserWindow, type MenuItem } from 'electron';
import type { Kit, TabsDeps } from './snapshot';
import { extraTabFixtures, folderFixture, historyFixture, panelFixture } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { harnessLine } from '../main/snapshot-shell';
import { transcriptPath, type SessionFile } from '../main/claude-session';
import { READING_CHOICES } from '../main/menu';
import { assertFixtureOutsideClaude } from './snapshot-views';
import { keepActivity } from './snapshot-activity';
import { PERMISSION_SCREEN } from './snapshot-prompts';
import { WIDTHS } from './snapshot-window-fit';

interface Fixture {
  id: string;
  folder: string;
  branch?: string; // a fake .git so the card shows "<repo> · <branch>"
  tab: boolean; // a tab in this window, or a session elsewhere on the Mac
  status: 'busy' | 'idle';
  minutesAgo: number;
  turns: { prompt: string; reply: string }[];
}

const id = (n: number) => `b0a4d000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LONG_HEADLINE = 'The release notes are drafted and every changed screen has a before and after picture, so the review can start whenever you are ready to read them';
const WAIT: Fixture = { id: id(1), folder: 'schema-work', tab: true, status: 'idle', minutesAgo: 20, turns: [{ prompt: 'plan the migration', reply: '**Need your call on the schema.**\n\n**Doing:** comparing two table layouts\n**Recommend:** keep one table per country\n**Next:** run the migration once you pick' }] };
const WORK: Fixture = { id: id(2), folder: 'petal', branch: 'sessions-board', tab: true, status: 'busy', minutesAgo: 1, turns: [{ prompt: 'build the board', reply: '**Building the Sessions board.**\n\n**Doing:** wiring cards to the 2s tick\n**Next:** snapshot every theme' }] };
const IDLE: Fixture = { id: id(3), folder: 'release-notes', tab: true, status: 'idle', minutesAgo: 30, turns: [{ prompt: 'draft the notes', reply: `**${LONG_HEADLINE}**\n\nDone.` }] };
const DONE: Fixture = { id: id(4), folder: 'invoice-fix', tab: true, status: 'idle', minutesAgo: 10, turns: [{ prompt: 'fix the invoice dates', reply: 'Fixed.' }, { prompt: 'conclude', reply: '**Conclusion:** Invoice dates now use the customer’s timezone.\n**Result:** All March invoices regenerated.\n**Impact:** No more off-by-one dates.' }] };
const ELSEWHERE_BUSY: Fixture = { id: id(5), folder: 'billing-service', branch: 'stale-prices', tab: false, status: 'busy', minutesAgo: 3, turns: [{ prompt: 'why are prices stale?', reply: '**The nightly job still reads the old price table.**\n\n**Doing:** tracing the job’s query\n**Next:** point it at prices_v2' }] };
const ELSEWHERE_IDLE: Fixture = { id: id(6), folder: 'widget-service', tab: false, status: 'idle', minutesAgo: 50, turns: [{ prompt: 'locale for the welcome email', reply: '**The welcome email now sends the locale.**' }] };
const TABS = [WAIT, WORK, IDLE, DONE];
const ELSEWHERE = [ELSEWHERE_BUSY, ELSEWHERE_IDLE];
const ALL = [...TABS, ...ELSEWHERE];

const CARDS = `[...document.querySelectorAll('#board .board-card')].map((c) => ({
  id: c.dataset.sessionId, tab: c.dataset.tabId ?? null, status: c.className.replace('board-card', '').trim(),
  word: c.querySelector('.board-status-word')?.textContent ?? null,
  name: c.querySelector('.board-name')?.textContent ?? null, place: c.querySelector('.board-place')?.textContent ?? null,
  headline: c.querySelector('.board-headline')?.textContent ?? null,
  doing: c.querySelector('.board-doing .board-text')?.textContent ?? null, recommend: c.querySelector('.board-recommend .board-text')?.textContent ?? null,
  next: c.querySelector('.board-next .board-text')?.textContent ?? null, conclusion: c.querySelector('.board-conclusion .board-text')?.textContent ?? null,
  agents: c.querySelector('.board-agents')?.textContent ?? null, star: Boolean(c.querySelector('.board-star')), since: c.querySelector('.board-since')?.textContent ?? null,
}))`;

// Page, board and card overflow sideways; text lines cut without spilling out of their card.
const OVERFLOW = `(() => {
  const over = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > window.innerWidth + 1) over.push({ id: 'page', by: doc.scrollWidth - window.innerWidth });
  for (const id of ['reader-area', 'board', 'sessions-dock']) {
    const r = document.getElementById(id).getBoundingClientRect();
    if (r.right > window.innerWidth + 1) over.push({ id, by: Math.round(r.right - window.innerWidth) });
  }
  const board = document.getElementById('board');
  if (board.scrollWidth - board.clientWidth > 1) over.push({ id: '#board', by: board.scrollWidth - board.clientWidth });
  const gridBox = board.querySelector('.board-grid').getBoundingClientRect();
  for (const card of board.querySelectorAll('.board-card')) {
    const box = card.getBoundingClientRect();
    if (box.right > gridBox.right + 1 || box.left < gridBox.left - 1) over.push({ id: card.dataset.sessionId, side: 'grid' });
    if (card.scrollWidth > card.clientWidth + 1) over.push({ id: card.dataset.sessionId, by: card.scrollWidth - card.clientWidth });
    for (const part of card.querySelectorAll('.board-card-top, .board-name, .board-place, .board-headline, .board-line, .board-conclusion')) {
      const r = part.getBoundingClientRect();
      if (r.right > box.right + 1) over.push({ id: card.dataset.sessionId, part: part.className, by: Math.round(r.right - box.right) });
    }
  }
  return over;
})()`;

// Each card scrolled into view: inside the board's box and hit-tested as itself at its corners and centre.
const REACH = `(async () => {
  const board = document.getElementById('board');
  const view = board.getBoundingClientRect();
  const shown = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const layers = [...document.querySelectorAll('#cat, .scene-tip, .scene-popover')].filter(shown);
  const out = { cards: 0, scrolls: board.scrollHeight > board.clientHeight, clipped: [], covered: [] };
  for (const card of board.querySelectorAll('.board-card')) {
    out.cards++;
    card.scrollIntoView({ block: 'nearest' });
    await new Promise(requestAnimationFrame);
    const r = card.getBoundingClientRect();
    if (r.top < view.top - 1 || r.bottom > view.bottom + 1) out.clipped.push({ id: card.dataset.sessionId, top: Math.round(r.top), bottom: Math.round(r.bottom), view: [Math.round(view.top), Math.round(view.bottom)] });
    // Sample the part inside the board: at 1x, scrollTop snaps to whole pixels and leaves a card up to 1px past the edge, under the divider's 5px reach.
    const top = Math.max(r.top, view.top);
    const bottom = Math.min(r.bottom, view.bottom);
    const points = [[r.left + 6, top + 6], [r.right - 6, top + 6], [r.left + 6, bottom - 6], [r.right - 6, bottom - 6], [(r.left + r.right) / 2, (top + bottom) / 2]];
    const missed = points.filter(([x, y]) => !card.contains(document.elementFromPoint(x, y))).length;
    const over = layers.filter((e) => { const o = e.getBoundingClientRect(); return o.left < r.right && o.right > r.left && o.top < r.bottom && o.bottom > r.top; }).map((e) => e.id || e.className);
    if (missed || over.length) out.covered.push({ id: card.dataset.sessionId, missed, over });
  }
  return out;
})()`;

// The dock's visible buttons: one row, none past the dock or the window.
const DOCK = `(() => {
  const dock = document.getElementById('sessions-dock');
  const box = dock.getBoundingClientRect();
  const buttons = [...dock.children].filter((e) => e.tagName === 'BUTTON' && e.getClientRects().length);
  const mid = (e) => { const r = e.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
  const rows = buttons.every((e) => Math.abs(mid(e) - mid(buttons[0])) < 4) ? 1 : 2;
  const out = buttons.filter((e) => { const r = e.getBoundingClientRect(); return r.left < box.left - 1 || r.right > Math.min(box.right, window.innerWidth) + 1; }).map((e) => e.id);
  const icons = dock.classList.contains('fit-icons');
  const tips = [...dock.querySelectorAll('.dock-button')].map((b) => ({ label: b.textContent, title: b.title }));
  return { rows, out, inner: window.innerWidth, buttons: buttons.map((e) => e.id), icons, tips };
})()`;

const entry = (fields: Record<string, unknown>) => JSON.stringify({ isSidechain: false, ...fields });

function writeTranscript(file: string, f: Fixture, cwd: string): void {
  assertFixtureOutsideClaude(file);
  const at = (step: number) => new Date(Date.now() - f.minutesAgo * 60_000 - (f.turns.length - step) * 1000).toISOString();
  const lines = f.turns.flatMap((turn, i) => [
    entry({ type: 'user', uuid: `${f.id}-u${i}`, timestamp: at(i), cwd, sessionId: f.id, message: { role: 'user', content: turn.prompt } }),
    entry({ type: 'assistant', uuid: `${f.id}-a${i}`, timestamp: at(i + 1), cwd, sessionId: f.id, message: { role: 'assistant', content: [{ type: 'text', text: turn.reply }] } }),
  ]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

function appendReply(file: string, n: number, reply: string): void {
  assertFixtureOutsideClaude(file);
  const at = new Date().toISOString();
  fs.appendFileSync(file, `${entry({ type: 'user', uuid: `live-u${n}`, timestamp: at, message: { role: 'user', content: 'and now?' } })}\n${entry({ type: 'assistant', uuid: `live-a${n}`, timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text: reply }] } })}\n`);
}

// Every menu item with an accelerator, so ⌘⇧O is proven unique.
function accelerators(): { label: string; accelerator: string }[] {
  const out: { label: string; accelerator: string }[] = [];
  const walk = (items: MenuItem[]) => {
    for (const item of items) {
      if (item.accelerator) out.push({ label: item.label, accelerator: String(item.accelerator) });
      if (item.submenu) walk(item.submenu.items);
    }
  };
  walk(Menu.getApplicationMenu()?.items ?? []);
  return out;
}

export async function sessionsBoardCheck(kit: Kit, { win, openTab, sessions }: Pick<TabsDeps, 'openTab' | 'sessions'> & { win: BrowserWindow }): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, themes, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} sessions board: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  const sizeTo = async (width: number) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      resizeOffscreen(win, width, 900);
      if (await waitFor(async () => { win.webContents.invalidate(); return (await js('window.innerWidth')) === width; }, 3000)) return true;
    }
    return false;
  };
  const dir = path.join(outDir, 'sessions-board');
  const saved = { panel: { ...panelFixture }, home: folderFixture.home, live: [...historyFixture.live] };
  const restoreActivity = keepActivity();
  const startTabs: string[] = await js('PastelTerm.tabs.ids()');
  const startActive: string | null = await js('PastelTerm.tabs.active()?.id ?? null');
  const cards = async (): Promise<{ id: string; tab: string | null; status: string; word: string | null; name: string | null; place: string | null; headline: string | null; doing: string | null; recommend: string | null; next: string | null; conclusion: string | null; agents: string | null; star: boolean; since: string | null }[]> => js(CARDS);
  const boardOpen = (): Promise<boolean> => js("PastelTerm.overlays.current() === 'board'");
  const mine = <T extends { id: string }>(list: T[]): T[] => list.filter((c) => ALL.some((f) => f.id === c.id));
  const cardOf = async (f: Fixture) => (await cards()).find((c) => c.id === f.id);
  const tabTranscript = (f: Fixture) => path.join(dir, 'tabs', `${f.id}.jsonl`);
  const cwdOf = (f: Fixture) => path.join(dir, 'repos', f.folder);
  const ptyOf = (tabId: string) => sessions.get(`${win.webContents.id}:${tabId}`)?.pty;

  try {
    applyTheme('paleSky', { persist: false });
    await js("window.pastel.look.setReading('newspaper')");
    check(await sizeTo(1600), '1600px window sized');

    // Fixture: four tabs here (waiting, working, idle, concluded) and two sessions elsewhere, with logs under a stand-in ~/.claude.
    fs.rmSync(dir, { recursive: true, force: true });
    folderFixture.home = path.join(dir, 'claude-home');
    for (const f of ALL) {
      fs.mkdirSync(cwdOf(f), { recursive: true });
      if (f.branch) {
        fs.mkdirSync(path.join(cwdOf(f), '.git'), { recursive: true });
        fs.writeFileSync(path.join(cwdOf(f), '.git', 'HEAD'), `ref: refs/heads/${f.branch}\n`);
      }
      writeTranscript(f.tab ? tabTranscript(f) : transcriptPath({ cwd: cwdOf(f), sessionId: f.id }), f, cwdOf(f));
    }
    const agentFile = path.join(dir, 'agents', ELSEWHERE_IDLE.id, 'agent-a1.jsonl');
    fs.mkdirSync(path.dirname(agentFile), { recursive: true });
    fs.writeFileSync(agentFile, `${entry({ type: 'user', message: { role: 'user', content: 'Check the email copy' } })}\n`);
    const freshAgent = () => fs.utimesSync(agentFile, new Date(), new Date()); // counts as running for 2 min after a write
    panelFixture.subagentsRoot = path.join(dir, 'agents');
    panelFixture.sessions = ALL.map((f): SessionFile => ({ pid: 0, sessionId: f.id, cwd: cwdOf(f), kind: 'interactive', status: f.status, updatedAt: Date.now() - f.minutesAgo * 60_000 }));
    historyFixture.live = [ELSEWHERE_BUSY.id];
    extraTabFixtures.push(...TABS.map((f) => ({ sessionId: f.id, transcript: tabTranscript(f), status: f.status, cwd: cwdOf(f) })));
    for (let i = 0; i < TABS.length; i++) openTab(win.webContents);
    const tabsUp = await waitFor(async () => {
      const up: { id: string | null; replies: number }[] = await js('PastelTerm.tabs.ids().map((t) => ({ id: PastelTerm.tabs.get(t).update?.sessionId ?? null, replies: PastelTerm.tabs.get(t).update?.replies.length ?? 0 }))');
      return TABS.every((f) => up.some((u) => u.id === f.id && u.replies > 0)) ? up : null;
    }, 15000);
    check(tabsUp, `a tab follows each tab fixture: ${JSON.stringify(tabsUp)}`);
    const tabOf = (f: Fixture): Promise<string | null> => js(`PastelTerm.tabs.ids().find((t) => PastelTerm.tabs.get(t).update?.sessionId === ${JSON.stringify(f.id)}) ?? null`);
    await js(`PastelTerm.favorites.isFavorite(${JSON.stringify(ELSEWHERE_IDLE.id)}) || PastelTerm.favorites.toggle(${JSON.stringify(ELSEWHERE_IDLE.id)})`);

    // The waiting tab holds a permission prompt on its screen, as Claude Code draws it.
    const waitTab = await tabOf(WAIT);
    const screen = path.join(dir, 'permission-screen.txt');
    fs.writeFileSync(screen, `${PERMISSION_SCREEN.join('\n')}\n`);
    ptyOf(waitTab ?? '')?.write(harnessLine(`clear; cat '${screen}'; read -r _`));

    // 1 The Sessions chip's panel has Board at the top, beside Add Session; it opens the board and closes the panel.
    await js("document.getElementById('sessions-pill').click()");
    const panel = await waitFor(() => js("(() => { const p = document.getElementById('sessions-panel'); const b = p.querySelector('.sessions-board-open'); return !p.hidden && b ? { first: p.firstElementChild.className, second: p.children[1]?.className, label: b.textContent, sameRow: Math.abs(b.getBoundingClientRect().top - p.firstElementChild.getBoundingClientRect().top) < 2 } : null; })()"), 5000);
    check(panel?.first.includes('sessions-add') && panel.second.includes('sessions-board-open') && panel.label === 'Board' && panel.sameRow, `Board sits at the top of the Sessions panel, beside Add Session: ${JSON.stringify(panel)}`);
    await js("document.querySelector('#sessions-panel .sessions-board-open').click()");
    const opened = await waitFor(async () => ((await boardOpen()) && (await js("document.getElementById('sessions-panel').hidden")) ? true : null), 4000);
    check(opened, 'Board opens the board and closes the panel');
    const readerHidden = await js("({ reader: document.getElementById('reader').hidden, composer: document.getElementById('composer').hidden })");
    check(readerHidden.reader && readerHidden.composer, `it replaces the reader like History: ${JSON.stringify(readerHidden)}`);

    // 2 Esc closes it; ⌘⇧O is the only menu item on that key, and its event toggles the board.
    await js("document.getElementById('board').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    check(await waitFor(async () => !(await boardOpen()) || null, 3000), 'Esc closes the board');
    const keyed = accelerators().filter((a) => a.accelerator === 'CmdOrCtrl+Shift+O');
    check(keyed.length === 1 && keyed[0]?.label === 'Sessions Board', `⌘⇧O belongs to View › Sessions Board alone: ${JSON.stringify(keyed)}`);
    win.webContents.send('board:toggle'); // what the menu item sends to the focused window
    check(await waitFor(() => boardOpen().then((o) => o || null), 3000), '⌘⇧O opens the board');
    win.webContents.send('board:toggle');
    check(await waitFor(async () => !(await boardOpen()) || null, 3000), '⌘⇧O again closes it');
    win.webContents.send('board:toggle');
    await waitFor(() => boardOpen().then((o) => o || null), 3000);

    // 3 One card per open session, Waiting first and highlighted, then Working, then Idle newest first, Concluded last.
    freshAgent();
    const want = [WAIT, WORK, ELSEWHERE_BUSY, IDLE, ELSEWHERE_IDLE, DONE].map((f) => f.id);
    const ordered = await waitFor(async () => {
      const got = await cards();
      return JSON.stringify(mine(got).map((c) => c.id)) === JSON.stringify(want) && got.find((c) => c.id === ELSEWHERE_BUSY.id)?.next && got.find((c) => c.id === ELSEWHERE_IDLE.id)?.agents ? got : null;
    }, 12000);
    const all = ordered ?? await cards();
    const liveTabs: string[] = await js("PastelTerm.tabs.ids().map((t) => PastelTerm.tabs.get(t).update).filter((u) => u?.state === 'live' && u.sessionId).map((u) => u.sessionId)");
    const expectCount = new Set([...liveTabs, ...ALL.map((f) => f.id)]).size;
    check(ordered, `order is Waiting, Working, Idle by recency, Concluded: ${JSON.stringify(mine(all).map((c) => `${ALL.find((f) => f.id === c.id)?.folder}:${c.status}`))}`);
    check(all.length === expectCount, `one card per open session: ${all.length} cards, ${expectCount} open (${liveTabs.length} live tabs + sessions elsewhere)`);
    const ranks = all.map((c) => ['waiting', 'working', 'idle', 'concluded'].indexOf(c.status));
    check(ranks.every((r, i) => i === 0 || r >= (ranks[i - 1] ?? 0)), `statuses never go back up the order: ${JSON.stringify(all.map((c) => c.status))}`);
    const first = all[0];
    check(first?.id === WAIT.id && first.word === 'Waiting on you', `Waiting on you is first: ${JSON.stringify(first)}`);
    const colours = await js(`(() => {
      const css = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
      const root = getComputedStyle(document.documentElement);
      return { waitingBorder: css('#board .board-card.waiting', 'borderTopColor'), waitingBg: css('#board .board-card.waiting', 'backgroundColor'), otherBorder: css('#board .board-card:not(.waiting)', 'borderTopColor'), otherBg: css('#board .board-card:not(.waiting)', 'backgroundColor'), pill: css('#board .board-status.waiting', 'backgroundColor'), decide: root.getPropertyValue('--decide-ink').trim() };
    })()`);
    check(colours.waitingBorder !== colours.otherBorder && colours.waitingBg !== colours.otherBg, `Waiting stands out; the rest stay neutral: ${JSON.stringify(colours)}`);
    const neutral = await js("[...document.querySelectorAll('#board .board-card:not(.waiting)')].every((c) => getComputedStyle(c).backgroundColor === getComputedStyle(document.getElementById('board')).backgroundColor)");
    check(neutral, 'every other card sits on the page colour');

    // 4 Card content: name, repo · branch, headline cut to 2 lines, Doing / Recommend / Next, Conclusion, agents, star, idle time.
    const by = (f: Fixture) => all.find((c) => c.id === f.id);
    check(by(WAIT)?.doing === 'comparing two table layouts' && by(WAIT)?.recommend === 'keep one table per country' && by(WAIT)?.next === 'run the migration once you pick', `Doing / Recommend / Next on the waiting card: ${JSON.stringify(by(WAIT))}`);
    check(by(WORK)?.word === 'Working' && by(WORK)?.headline === 'Building the Sessions board.' && by(WORK)?.place === 'petal · sessions-board · this window', `working tab: headline and repo · branch: ${JSON.stringify(by(WORK))}`);
    check(by(ELSEWHERE_BUSY)?.headline === 'The nightly job still reads the old price table.' && by(ELSEWHERE_BUSY)?.next === 'point it at prices_v2' && by(ELSEWHERE_BUSY)?.place === 'billing-service · stale-prices' && by(ELSEWHERE_BUSY)?.tab === null,
      `a session elsewhere gets its digest from main: ${JSON.stringify(by(ELSEWHERE_BUSY))}`);
    check(by(DONE)?.word === 'Concluded' && by(DONE)?.conclusion === 'Invoice dates now use the customer’s timezone.' && by(DONE)?.headline === null, `Conclusion line, not repeated as a headline, on the concluded card: ${JSON.stringify(by(DONE))}`);
    check(by(ELSEWHERE_IDLE)?.agents === '1 agent' && by(ELSEWHERE_IDLE)?.star && !by(WORK)?.star, `agents count and the favourite star: ${JSON.stringify(by(ELSEWHERE_IDLE))}`);
    check(by(IDLE)?.word === 'Idle' && /^· \d+m ago$/.test(by(IDLE)?.since ?? ''), `Idle shows the time since its last update: ${JSON.stringify(by(IDLE)?.since)}`);
    check(all.every((c) => c.name && c.name.length <= 60), `names use the shared 60-char rule: ${JSON.stringify(all.map((c) => c.name))}`);
    const clamp = await js(`(() => { const h = document.querySelector('#board .board-card[data-session-id="${IDLE.id}"] .board-headline'); const line = parseFloat(getComputedStyle(h).lineHeight); return { height: h.clientHeight, line, cut: h.scrollHeight > h.clientHeight + 1 }; })()`);
    check(clamp.cut && clamp.height <= clamp.line * 2 + 1, `a long headline is cut to 2 lines: ${JSON.stringify(clamp)}`);
    const oneLine = await js("[...document.querySelectorAll('#board .board-line, #board .board-conclusion')].every((l) => l.getBoundingClientRect().height < parseFloat(getComputedStyle(l).fontSize) * 2)");
    check(oneLine, 'Doing / Recommend / Next and Conclusion take one line each');
    await capture('sessions-board-paleSky-1600');

    // 5 The filter row: Waiting, Working, Idle (with Concluded), All.
    const filterTo = async (filter: string) => {
      await js(`document.querySelector('#board .board-filter[data-filter="${filter}"]').click()`);
      await wait(150);
      return { pressed: await js(`document.querySelector('#board .board-filter[aria-pressed="true"]').dataset.filter`), ids: mine(await cards()).map((c) => c.id), total: (await cards()).length };
    };
    const waitingOnly = await filterTo('waiting');
    check(waitingOnly.pressed === 'waiting' && JSON.stringify(waitingOnly.ids) === JSON.stringify([WAIT.id]) && waitingOnly.total === 1, `Waiting filter: ${JSON.stringify(waitingOnly)}`);
    const workingOnly = await filterTo('working');
    check(JSON.stringify(workingOnly.ids) === JSON.stringify([WORK.id, ELSEWHERE_BUSY.id]) && (await cards()).every((c) => c.status === 'working'), `Working filter: ${JSON.stringify(workingOnly)}`);
    const idleOnly = await filterTo('idle');
    check(JSON.stringify(idleOnly.ids) === JSON.stringify([IDLE.id, ELSEWHERE_IDLE.id, DONE.id]) && (await cards()).every((c) => c.status === 'idle' || c.status === 'concluded'), `Idle filter takes Concluded too: ${JSON.stringify(idleOnly)}`);
    const back = await filterTo('all');
    check(back.total === expectCount, `All brings every card back: ${back.total}`);
    const labels: string[] = await js("[...document.querySelectorAll('#board .board-filter')].map((b) => b.textContent)");
    check(labels.length === 4 && labels[0]?.startsWith('All') && labels[1] === 'Waiting 1', `filter row reads All · Waiting · Working · Idle with counts: ${JSON.stringify(labels)}`);

    // 6 Keyboard: arrows move by the grid's columns, Enter opens.
    await js("document.querySelector('#board .board-card').focus()");
    const focused = (): Promise<string | null> => js("document.activeElement?.dataset?.sessionId ?? null");
    const key = async (keyCode: string) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      if (keyCode === 'Return') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); // a button activates on the key's char
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
      await wait(120);
    };
    const columns: number = await js("(() => { const c = [...document.querySelectorAll('#board .board-card')]; return c.filter((x) => x.offsetTop === c[0].offsetTop).length; })()");
    const order = (await cards()).map((c) => c.id);
    await key('Right');
    const right = await focused();
    await key('Left');
    const left = await focused();
    await key('Down');
    const down = await focused();
    check(right === order[1] && left === order[0] && down === order[Math.min(columns, order.length - 1)], `arrows move between cards (${columns} columns): ${JSON.stringify({ right, left, down })}`);

    // 7 The board follows the 2s tick: a reply appended to a tab's log and to a session elsewhere shows without reopening.
    appendReply(tabTranscript(IDLE), 1, '**Notes are published.**\n\n**Next:** tell the team');
    await wait(1100); // a second apart, so the newest-first order between the two is certain
    appendReply(transcriptPath({ cwd: cwdOf(ELSEWHERE_IDLE), sessionId: ELSEWHERE_IDLE.id }), 2, '**Locale fix merged.**\n\n**Doing:** watching the deploy');
    freshAgent();
    const liveCards = await waitFor(async () => {
      const [idleCard, elsewhere] = [await cardOf(IDLE), await cardOf(ELSEWHERE_IDLE)];
      return idleCard?.headline === 'Notes are published.' && idleCard.next === 'tell the team' && elsewhere?.headline === 'Locale fix merged.' && elsewhere.doing === 'watching the deploy' ? { idleCard, elsewhere } : null;
    }, 10000);
    check(liveCards, `appended replies show live: ${JSON.stringify(liveCards ?? { idle: await cardOf(IDLE), elsewhere: await cardOf(ELSEWHERE_IDLE) })}`);
    const reordered = mine(await cards()).map((c) => c.id);
    check(reordered.indexOf(ELSEWHERE_IDLE.id) < reordered.indexOf(IDLE.id), `and re-sorts by the newest update: ${JSON.stringify(reordered)}`);

    // 8 A session elsewhere still running in a terminal asks before opening here; Cancel keeps the board.
    await js(`document.querySelector('#board .board-card[data-session-id="${ELSEWHERE_BUSY.id}"]').click()`);
    const asked = await waitFor(() => js(`document.querySelector('#board .board-card[data-session-id="${ELSEWHERE_BUSY.id}"]')?.closest('.board-item').querySelector('.board-confirm')?.textContent ?? null`), 5000);
    check(asked && asked.includes('still running') && (await boardOpen()), `a session running elsewhere asks first: ${JSON.stringify(asked)}`);
    await js(`[...document.querySelectorAll('#board .board-confirm .session-link')].find((b) => b.textContent === 'Cancel').click()`);
    check(await waitFor(async () => (await js("document.querySelector('#board .board-confirm')")) === null || null, 3000), 'Cancel takes the question away');

    // 9 Every theme and look, 1600 and 800: nothing sideways. PNGs of the board light and dark at both widths.
    for (const width of [1600, 800]) {
      check(await sizeTo(width), `${width}px window sized`);
      for (const [themeId] of Object.entries(themes)) {
        applyTheme(themeId, { persist: false });
        for (const [look] of READING_CHOICES) {
          await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
          await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
          await wait(200);
          const over = await js(OVERFLOW);
          check(over.length === 0, `${width}px ${themeId} ${look}: nothing sideways ${JSON.stringify(over)}`);
        }
        await js("window.pastel.look.setReading('newspaper')");
        await waitFor(async () => (await js('document.documentElement.dataset.reading')) === 'newspaper', 3000);
        if (themeId === 'paleSky' || themeId === 'nightPastel') {
          win.webContents.invalidate(); // an off-screen window can hand back a frame from before the resize
          await wait(400);
          const shot = await js("({ board: Math.round(document.getElementById('board').getBoundingClientRect().width), inner: window.innerWidth, columns: getComputedStyle(document.querySelector('#board .board-grid')).gridTemplateColumns.split(' ').length })");
          const image = await win.webContents.capturePage();
          const scale = image.getSize().width / shot.inner;
          check(Math.abs(image.getSize().width / scale - width) < 2 && shot.inner === width && shot.board === width, `${width}px ${themeId} PNG is the ${width}px layout (${shot.columns} columns): ${JSON.stringify({ ...shot, png: image.getSize() })}`);
          await capture(`sessions-board-${themeId}-${width}`);
        }
      }
    }
    check(await sizeTo(1600), 'back to 1600px');
    applyTheme('paleSky', { persist: false });

    // 10 Clicking a tab's card switches to that tab and closes the board.
    const workTab = await tabOf(WORK);
    await js(`document.querySelector('#board .board-card[data-session-id="${WORK.id}"]').click()`);
    const switched = await waitFor(async () => {
      const state = await js("({ active: PastelTerm.tabs.active()?.id, open: PastelTerm.overlays.current() })");
      return state.active === workTab && state.open === null ? state : null;
    }, 4000);
    check(switched, `card click activates its tab and closes the board: ${JSON.stringify(switched ?? await js("({ active: PastelTerm.tabs.active()?.id, open: PastelTerm.overlays.current() })"))}, want ${workTab}`);
    // Enter on a focused card opens it too.
    win.webContents.send('board:toggle');
    await waitFor(() => boardOpen().then((o) => o || null), 3000);
    const idleTab = await tabOf(IDLE);
    await js(`document.querySelector('#board .board-card[data-session-id="${IDLE.id}"]').focus()`);
    await key('Return');
    const entered = await waitFor(async () => ((await js('PastelTerm.tabs.active()?.id')) === idleTab && !(await boardOpen()) ? true : null), 4000);
    check(entered, 'Enter on a focused card opens its tab');

    // 11 Reading off: the board shows the gated state with Allow, like History; Allow brings the cards back.
    await js('PastelTerm.sessionsBoard.open()');
    await waitFor(() => boardOpen().then((o) => o || null), 3000);
    await js("PastelTerm.consent.setChoice('declined')");
    const gated = await waitFor(() => js("(() => { const n = document.querySelector('#board .board-folder-off'); return n ? { text: n.textContent, allow: Boolean(n.querySelector('.board-allow')), cards: document.querySelectorAll('#board .board-card').length } : null; })()"), 5000);
    check(gated?.allow && gated.cards === 0, `reading off: gated empty state with Allow and no cards: ${JSON.stringify(gated)}`);
    await capture('sessions-board-gated');
    await js("document.querySelector('#board .board-allow')?.click()");
    const allowed = await waitFor(async () => ((await cards()).length >= ALL.length ? (await cards()).length : null), 10000);
    check(allowed, `Allow brings the cards back: ${allowed}`);

    // 12 Many sessions, one resumed by two processes: one card each, and every card scrolls into view uncovered.
    const many = Array.from({ length: 24 }, (_, i): SessionFile => ({ pid: 0, sessionId: `b0a4d000-0000-4000-8000-9${String(i).padStart(11, '0')}`, cwd: path.join(dir, 'repos', `many-${i}`), kind: 'interactive', status: 'idle', updatedAt: Date.now() - (60 + i) * 60_000 }));
    for (const s of many) fs.mkdirSync(s.cwd, { recursive: true });
    panelFixture.sessions = [...(panelFixture.sessions ?? []), ...many, ...many.slice(0, 1).map((s) => ({ ...s, pid: 1 }))];
    await js("PastelTerm.cat.setScene('cherry')");
    // Allow re-follows the tabs a beat after the cards come back ("Allow brings the cards back: 6" of 7), so wait for all of them.
    const LIVE_TABS = "PastelTerm.tabs.ids().map((t) => PastelTerm.tabs.get(t).update).filter((u) => u?.state === 'live' && u.sessionId).map((u) => u.sessionId)";
    const tabsLive: string[] = (await waitFor(async () => { const ids: string[] = await js(LIVE_TABS); return ids.length === liveTabs.length ? ids : null; }, 8000)) ?? await js(LIVE_TABS);
    const manyCount = new Set([...tabsLive, ...ALL.map((f) => f.id), ...many.map((s) => s.sessionId)]).size;
    const grown = await waitFor(async () => ((await cards()).length === manyCount ? true : null), 8000);
    const ids = (await cards()).map((c) => c.id);
    check(grown && new Set(ids).size === ids.length, `one card per session, a doubly resumed one included: ${ids.length} cards, ${new Set(ids).size} distinct, ${manyCount} open (${tabsLive.length} live tabs)`);
    for (const width of [1600, 800]) {
      check(await sizeTo(width), `${width}px window sized`);
      await wait(300);
      const cat = await js("getComputedStyle(document.getElementById('cat')).display");
      const reach = await js(REACH);
      check(cat === 'none' && reach.scrolls && reach.cards === manyCount && reach.clipped.length === 0 && reach.covered.length === 0,
        `${width}px: every one of ${reach.cards} cards scrolls into view, nothing over it (cat ${cat}): ${JSON.stringify({ clipped: reach.clipped, covered: reach.covered })}`);
      await capture(`sessions-board-many-${width}`);
    }
    await js("document.getElementById('board').scrollTop = 0");

    // 13 Board in the dock, right of History: opens the board pressed, closes it again; the dock stays one row at every width.
    await js('PastelTerm.sessionsBoard.close()');
    await js("document.getElementById('board-button').click()");
    const pressed = await waitFor(async () => ((await boardOpen()) ? await js("document.getElementById('board-button').getAttribute('aria-pressed')") : null), 3000);
    const beside = await js("(() => { const b = document.getElementById('board-button').getBoundingClientRect(); const h = document.getElementById('history-button').getBoundingClientRect(); return { board: Math.round((b.top + b.bottom) / 2), history: Math.round((h.top + h.bottom) / 2), after: b.left >= h.right }; })()");
    check(pressed === 'true' && Math.abs(beside.board - beside.history) < 2 && beside.after, `Board opens the board, pressed, on History's row: ${JSON.stringify({ pressed, ...beside })}`);
    // Each dock button: one hidden line icon before its label, and the label alone is its accessible name.
    const icons = await js("[...document.querySelectorAll('#sessions-dock .dock-button')].map((b) => ({ id: b.id, svgs: b.querySelectorAll(':scope > svg[aria-hidden=\"true\"]').length, first: b.firstElementChild?.tagName, named: !b.hasAttribute('aria-label') && !b.hasAttribute('aria-labelledby'), label: b.textContent }))");
    const DOCK_LABELS = ['Customize', 'Workflow', 'History', 'Library', 'Testing', 'Board', 'Add Session'];
    check(icons.length === DOCK_LABELS.length && icons.every((b: { svgs: number; first: string; named: boolean; label: string }, i: number) => b.svgs === 1 && b.first === 'svg' && b.named && b.label === DOCK_LABELS[i]),
      `every dock button has one icon and its label as its name: ${JSON.stringify(icons)}`);
    for (const width of WIDTHS) {
      check(await sizeTo(width), `${width}px window sized`);
      await wait(200);
      const dock = await js(DOCK);
      check(dock.rows === 1 && dock.out.length === 0 && dock.buttons.includes('board-button'), `${width}px: the dock is one row, nothing past its edge ${JSON.stringify(dock)}`);
      if (width === WIDTHS[0]) check(!dock.icons, `${width}px: the dock buttons keep their full labels ${JSON.stringify(dock)}`);
      if (dock.icons) check(dock.tips.every((t: { label: string; title: string }) => t.title.startsWith(t.label)), `${width}px: icon-only buttons show their label as a tooltip ${JSON.stringify(dock.tips)}`);
      await capture(`dock-${width}`);
      // An update ready: the pill takes a shorter form rather than wrap the dock. A long version is the worst case.
      await js("PastelTerm.updatePill.show('10.10.10')");
      await wait(200);
      const withPill = await js(DOCK);
      check(withPill.rows === 1 && withPill.out.length === 0 && withPill.buttons.includes('update-pill'), `${width}px: with the update pill, the dock is one row ${JSON.stringify(withPill)}`);
      await js('PastelTerm.updatePill.reset()');
    }
    // Room to grow: two more dock buttons (8) and the update pill still fit one row at the narrowest width.
    await js(`(() => { const add = document.getElementById('add-session-button'); for (const n of [1, 2]) { const b = document.getElementById('history-button').cloneNode(true); b.id = 'dummy-dock-' + n; add.before(b); } })()`);
    await js("PastelTerm.updatePill.show('10.10.10')");
    await wait(200);
    const eight = await js(DOCK);
    check(eight.rows === 1 && eight.out.length === 0 && eight.buttons.filter((b: string) => b.startsWith('dummy-dock')).length === 2, `${WIDTHS.at(-1)}px with 8 dock buttons and the update pill: one row ${JSON.stringify(eight)}`);
    await capture(`dock-grown-${WIDTHS.at(-1)}`);
    await js("document.querySelectorAll('[id^=dummy-dock]').forEach((b) => b.remove()); PastelTerm.updatePill.reset()");
    check(await sizeTo(1600), 'back to 1600px');
    await js("document.getElementById('board-button').click()");
    const shut = await waitFor(async () => (!(await boardOpen()) && (await js("document.getElementById('board-button').getAttribute('aria-pressed')")) === 'false') || null, 3000);
    check(shut, 'clicking Board again closes it and unpresses it');
  } finally {
    applyTheme('paleSky', { persist: false });
    await js("window.pastel.look.setReading('newspaper')");
    await js("PastelTerm.consent.setChoice('allowed')");
    await js('PastelTerm.sessionsBoard.close()');
    await js(`PastelTerm.favorites.isFavorite(${JSON.stringify(ELSEWHERE_IDLE.id)}) && PastelTerm.favorites.toggle(${JSON.stringify(ELSEWHERE_IDLE.id)})`);
    extraTabFixtures.length = 0;
    const opened: string[] = (await js('PastelTerm.tabs.ids()')).filter((t: string) => !startTabs.includes(t));
    for (const t of opened) { ptyOf(t)?.write('\x03'); await js(`PastelTerm.tabs.requestClose(${JSON.stringify(t)})`); }
    const closedAgain = await waitFor(async () => ((await js('PastelTerm.tabs.ids()')).length === startTabs.length ? true : null), 8000);
    check(closedAgain, `test tabs closed again: ${JSON.stringify(await js('PastelTerm.tabs.ids()'))}`);
    if (startActive) await js(`PastelTerm.tabs.activate(${JSON.stringify(startActive)})`);
    panelFixture.sessions = saved.panel.sessions;
    panelFixture.subagentsRoot = saved.panel.subagentsRoot;
    folderFixture.home = saved.home;
    historyFixture.live = saved.live;
    restoreActivity();
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
