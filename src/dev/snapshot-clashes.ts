// File clashes and Activity (PASTEL_SNAPSHOT_MODE=clashes): clash chips for two sessions editing one file, the reader's
// clash line and heads-up, a task held by a fixture session (given through the store, as Testing does) shown on its card
// as Task lines move it, and the Activity feed in order with its filters. Contrast and overflow everywhere.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit, TabsDeps } from './snapshot';
import { extraTabFixtures, folderFixture, panelFixture, pasteWrites } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { READING_CHOICES } from '../main/menu';
import { recordActivity, flush as flushActivity } from '../main/activity-feed';
import { assertFixtureOutsideClaude } from './snapshot-views';
import { keepActivity } from './snapshot-activity';

interface Fixture {
  id: string;
  folder: string; // repos/<folder>: two fixtures share one repo
  branch: string;
  prompt: string;
  reply: string;
  edits: { file: string; minutesAgo: number }[];
}

const id = (n: number) => `7a5c0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LOGIN: Fixture = { id: id(1), folder: 'shop', branch: 'main', prompt: 'fix the cart total rounding', reply: '**Looking at the cart.**\n\n**Doing:** reading the totals', edits: [{ file: 'src/cart.ts', minutesAgo: 3 }] };
const DOCS: Fixture = { id: id(2), folder: 'shop', branch: 'main', prompt: 'document the cart api', reply: '**Writing the docs.**', edits: [{ file: 'src/cart.ts', minutesAgo: 2 }, { file: 'README.md', minutesAgo: 2 }] };
const API: Fixture = { id: id(3), folder: 'api', branch: 'feature-x', prompt: 'add the coupons endpoint', reply: '**Adding coupons.**', edits: [{ file: 'src/cart.ts', minutesAgo: 1 }] };
const ALL = [LOGIN, DOCS, API];
const WIDTHS = [800, 1200, 1600];

const entry = (fields: Record<string, unknown>) => JSON.stringify({ isSidechain: false, ...fields });
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

// Card lines the page shows, read through the DOM only.
const CARD_EXTRAS = `[...document.querySelectorAll('#board .board-card')].map((c) => ({
  id: c.dataset.sessionId, task: c.querySelector('.board-task .board-text')?.textContent ?? null, taskClass: c.querySelector('.board-task')?.className ?? null,
  clash: c.querySelector('.board-clash')?.textContent ?? null,
}))`;
const ACTIVITY = `[...document.querySelectorAll('#board .activity-item')].map((b) => ({ id: b.dataset.id, kind: b.dataset.kind, text: b.querySelector('.activity-text')?.textContent ?? '', who: b.querySelector('.activity-who')?.textContent ?? '', at: Date.parse(b.querySelector('time')?.dateTime ?? '') }))`;

// Page, board and every card and activity item: nothing sideways at this width.
const OVERFLOW = `(() => {
  const over = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > window.innerWidth + 1) over.push({ id: 'page', by: doc.scrollWidth - window.innerWidth });
  const board = document.getElementById('board');
  if (board.scrollWidth - board.clientWidth > 1) over.push({ id: '#board', by: board.scrollWidth - board.clientWidth });
  const box = board.getBoundingClientRect();
  for (const e of board.querySelectorAll('.board-head, .board-card, .activity-filters, .activity-item, .board-clash, .board-task')) {
    if (!e.getClientRects().length) continue;
    const r = e.getBoundingClientRect();
    if (r.right > box.right + 1 || r.left < box.left - 1) over.push({ id: e.className, right: Math.round(r.right), box: Math.round(box.right) });
    if (e.scrollWidth > e.clientWidth + 1 && !e.classList.contains('board-clash')) over.push({ id: e.className, scroll: e.scrollWidth - e.clientWidth });
  }
  const clash = document.getElementById('reader-clash');
  if (clash && clash.getClientRects().length && clash.getBoundingClientRect().right > window.innerWidth + 1) over.push({ id: 'reader-clash' });
  return over;
})()`;

// WCAG ratio of each coloured part's text on the colour behind it.
const CONTRAST = `(() => {
  const rgb = (c) => (c.match(/[\\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const bgOf = (e) => { for (let n = e; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.5) return c; } return [255, 255, 255]; };
  const out = [];
  for (const sel of ['.board-task .board-label', '.board-task .board-text', '.board-clash', '.board-view', '.activity-badge', '.activity-text', '.activity-who', '.activity-detail', '.clash-chip', '.clash-text', '.clash-headsup']) {
    for (const e of document.querySelectorAll(sel)) {
      if (!e.getClientRects().length) continue;
      const fg = rgb(getComputedStyle(e).color);
      const a = lum(fg), b = lum(bgOf(e));
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      out.push({ sel, cls: e.className, ratio: Math.round(ratio * 100) / 100 });
    }
  }
  return out;
})()`;

function writeTranscript(file: string, f: Fixture, cwd: string): void {
  assertFixtureOutsideClaude(file);
  const lines = [
    entry({ type: 'user', uuid: `${f.id}-u0`, timestamp: iso(10), cwd, sessionId: f.id, message: { role: 'user', content: f.prompt } }),
    entry({ type: 'assistant', uuid: `${f.id}-a0`, timestamp: iso(9), cwd, sessionId: f.id, message: { role: 'assistant', content: [{ type: 'text', text: f.reply }] } }),
    ...f.edits.map((e, i) => entry({ type: 'assistant', uuid: `${f.id}-e${i}`, timestamp: iso(e.minutesAgo), cwd, sessionId: f.id, message: { role: 'assistant', content: [{ type: 'tool_use', id: `tu-${f.id}-${i}`, name: i % 2 ? 'Write' : 'Edit', input: { file_path: path.join(cwd, e.file) } }] } })),
  ];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

// A new turn: her prompt, then Claude's reply, now.
function appendTurn(file: string, f: Fixture, n: number, prompt: string, reply: string): void {
  assertFixtureOutsideClaude(file);
  const at = new Date().toISOString();
  fs.appendFileSync(file, `${entry({ type: 'user', uuid: `${f.id}-lu${n}`, timestamp: at, sessionId: f.id, message: { role: 'user', content: prompt } })}\n${entry({ type: 'assistant', uuid: `${f.id}-la${n}`, timestamp: at, sessionId: f.id, message: { role: 'assistant', content: [{ type: 'text', text: reply }] } })}\n`);
}

export async function clashesCheck(kit: Kit, { win, openTab }: Pick<TabsDeps, 'openTab'> & { win: BrowserWindow }): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, themes, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} clashes: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  const sizeTo = async (width: number) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      resizeOffscreen(win, width, 900);
      if (await waitFor(async () => { win.webContents.invalidate(); return (await js('window.innerWidth')) === width; }, 3000)) return true;
    }
    return false;
  };
  const dir = path.join(outDir, 'clashes');
  const saved = { panel: panelFixture.sessions, home: folderFixture.home };
  const restoreActivity = keepActivity();
  const startTabs: string[] = await js('PastelTerm.tabs.ids()');
  const transcript = (f: Fixture) => path.join(dir, 'tabs', `${f.id}.jsonl`);
  const repoOf = (f: Fixture) => path.join(dir, 'repos', f.folder);
  const tabOf = (f: Fixture): Promise<string | null> => js(`PastelTerm.tabs.ids().find((t) => PastelTerm.tabs.get(t).update?.sessionId === ${JSON.stringify(f.id)}) ?? null`);
  const extras = async (f: Fixture) => ((await js(CARD_EXTRAS)) as { id: string; task: string | null; taskClass: string | null; clash: string | null }[]).find((c) => c.id === f.id);
  const settle = () => wait(250);
  const openBoard = async () => { await js('PastelTerm.sessionsBoard.open()'); await waitFor(() => js("PastelTerm.overlays.current() === 'board' || null"), 3000); };
  const taskOp = (tabId: string | null, op: object) => js(`window.pastel.tasks.change(${JSON.stringify(tabId)}, ${JSON.stringify(op)})`);

  try {
    applyTheme('paleSky', { persist: false });
    await js("window.pastel.look.setReading('newspaper')");
    check(await sizeTo(1280), '1280px window sized');

    // Fixture: two sessions in repo "shop" (both edit src/cart.ts) and one in repo "api" (its own src/cart.ts), all tabs here.
    fs.rmSync(dir, { recursive: true, force: true });
    folderFixture.home = path.join(dir, 'claude-home');
    panelFixture.sessions = null; // only these tabs are live
    for (const f of ALL) {
      fs.mkdirSync(path.join(repoOf(f), '.git'), { recursive: true });
      fs.writeFileSync(path.join(repoOf(f), '.git', 'HEAD'), `ref: refs/heads/${f.branch}\n`);
      writeTranscript(transcript(f), f, repoOf(f));
    }
    extraTabFixtures.push(...ALL.map((f) => ({ sessionId: f.id, transcript: transcript(f), status: 'idle', cwd: repoOf(f) })));
    for (let i = 0; i < ALL.length; i++) openTab(win.webContents);
    const up = await waitFor(async () => {
      const ids: (string | null)[] = await js('PastelTerm.tabs.ids().map((t) => PastelTerm.tabs.get(t).update?.sessionId ?? null)');
      return ALL.every((f) => ids.includes(f.id)) ? ids : null;
    }, 15000);
    check(up, `a tab follows each fixture: ${JSON.stringify(up)}`);
    const loginTab = await tabOf(LOGIN);
    const docsTab = await tabOf(DOCS);
    const apiTab = await tabOf(API);
    await js(`PastelTerm.tabs.activate(${JSON.stringify(loginTab)})`);
    const names: Record<string, string> = await js(`Object.fromEntries(PastelTerm.tabs.ids().map((t) => [PastelTerm.tabs.get(t).update?.sessionId, PastelTerm.tabs.get(t).update?.label]))`);
    const nameOf = (f: Fixture) => names[f.id] ?? '';

    // 1 The Board opens on Sessions; no Tasks section or Give task under the cards.
    await openBoard();
    const views = await waitFor(async () => ((await extras(LOGIN)) ? js("[...document.querySelectorAll('#board .board-view')].map((b) => b.textContent + ':' + b.getAttribute('aria-selected'))") : null), 5000);
    check(JSON.stringify(views) === JSON.stringify(['Sessions:true', 'Activity:false']), `under the Sessions view: ${JSON.stringify(views)}`);
    check(!(await js("document.querySelector('#board .board-tasks, #board .board-give, #board .task-row')")), 'no task list or Give task on the Board');

    // 2 A task given to the login session through the store (as Testing does) shows on its card; Task lines move it.
    const file = path.join(repoOf(LOGIN), '.petal', 'tasks.json');
    const added = await taskOp(loginTab, { kind: 'add', title: 'Fix the cart total', notes: 'Rounding is off by a cent' });
    const cartTask: string = added?.tasks?.[0]?.id ?? '';
    const brief = 'Task: Fix the cart total. Rounding is off by a cent. When you start, end your replies with **Task:** Fix the cart total · working|blocked|done.';
    const assigned = await taskOp(loginTab, { kind: 'assign', id: cartTask, toTabId: loginTab });
    check(cartTask && assigned?.brief === brief, `the store hands back the task's brief: ${JSON.stringify(assigned?.brief ?? assigned)}`);
    const claimed = await waitFor(async () => { const c = await extras(LOGIN); return c?.task === 'Fix the cart total · Given' ? c : null; }, 5000);
    check(claimed?.taskClass?.includes('claimed'), `Given on the login card: ${JSON.stringify(claimed ?? await extras(LOGIN))}`);
    appendTurn(transcript(LOGIN), LOGIN, 1, brief, '**Found the rounding bug.**\n\n**Doing:** fixing the total\n**Task:** Fix the cart total · working');
    const working = await waitFor(async () => { const c = await extras(LOGIN); return c?.task === 'Fix the cart total · Working' ? c : null; }, 8000);
    check(working, `the working line moves it to Working: ${JSON.stringify(working ?? await extras(LOGIN))}`);
    appendTurn(transcript(LOGIN), LOGIN, 2, 'ship it', '**The total rounds right.**\n\n**Next:** nothing pending\n**Task:** Fix the cart total · done');
    const done = await waitFor(async () => { const c = await extras(LOGIN); return c?.task === 'Fix the cart total · Done' ? c : null; }, 8000);
    check(done, `the done line moves it to Done: ${JSON.stringify(done ?? await extras(LOGIN))}`);
    const doneFile = (JSON.parse(fs.readFileSync(file, 'utf8')) as { tasks: { id: string; status: string; doneBy: { sessionId: string } | null }[] }).tasks.find((t) => t.id === cartTask);
    check(doneFile?.status === 'done' && doneFile.doneBy?.sessionId === LOGIN.id, `and the file records who finished it: ${JSON.stringify(doneFile)}`);
    await capture('board-task-line');

    // 3 Clash: the two shop sessions both edited src/cart.ts; the api session's src/cart.ts is another repo.
    const chips = await waitFor(async () => { const [l, d, a] = [await extras(LOGIN), await extras(DOCS), await extras(API)]; return l?.clash && d?.clash ? { l: l.clash, d: d.clash, a: a?.clash ?? null } : null; }, 8000);
    check(chips?.l === 'Clash · src/cart.ts' && chips.d === 'Clash · src/cart.ts' && chips.a === null, `clash chips on both shop cards, none on api: ${JSON.stringify(chips)}`);
    await capture('clash-board');
    await js('PastelTerm.sessionsBoard.close()');
    await js(`PastelTerm.tabs.activate(${JSON.stringify(loginTab)})`);
    const notice = await waitFor(() => js("(() => { const n = document.getElementById('reader-clash'); return n && !n.hidden ? { text: n.querySelector('.clash-text').textContent, button: n.querySelector('.clash-headsup')?.textContent ?? null, under: n.previousElementSibling?.id } : null; })()"), 5000);
    check(notice?.text === `Also being edited in ${nameOf(DOCS)}: src/cart.ts` && notice.button === 'Send heads-up' && notice.under === 'reader-status-strip', `the reader strip names the other session and file: ${JSON.stringify(notice)}`);
    await capture('clash');
    const headsBefore = pasteWrites.length;
    await js("document.querySelector('#reader-clash .clash-headsup').click()");
    const heads = await waitFor(async () => (pasteWrites.length > headsBefore ? pasteWrites.at(-1) : null), 4000);
    check(heads?.tabId === docsTab && heads.data.includes(`Heads-up from Petal: ${nameOf(LOGIN)} is also editing src/cart.ts`), `Send heads-up goes to the other session through the reply box path: ${JSON.stringify(heads)}`);
    check(await waitFor(() => js("document.querySelector('#reader-clash .clash-sent')?.textContent ?? null"), 3000) === 'Heads-up sent', 'and says it was sent');
    await js(`PastelTerm.tabs.activate(${JSON.stringify(apiTab)})`);
    check(await waitFor(() => js("document.getElementById('reader-clash').hidden || null"), 3000), 'the api tab shows no clash');

    // 4 Activity: a conclusion (real, from the docs log) plus a test run, a Library note and a message recorded the way their modules do.
    appendTurn(transcript(DOCS), DOCS, 1, 'conclude', '**Conclusion:** The cart API is documented.\n**Result:** README covers both endpoints.\n**Impact:** New devs can call it.');
    await waitFor(async () => ((await js('PastelTerm.tabs.get(' + JSON.stringify(docsTab) + ').update?.conclusion?.conclusion')) ? true : null), 8000);
    recordActivity({ id: 'test:run-snapshot', kind: 'test', sessionId: null, sessionName: null, branch: 'main', repo: 'shop', text: 'Tests passed in shop: 42 passed', detail: ['Unit: passed'], target: { runId: 'run-snapshot' } });
    recordActivity({ kind: 'library', sessionId: DOCS.id, sessionName: nameOf(DOCS), branch: null, repo: null, text: `Library: 1 note added from ${nameOf(DOCS)}` });
    recordActivity({ kind: 'message', sessionId: API.id, sessionName: nameOf(API), branch: 'feature-x', repo: 'api', toSessionId: LOGIN.id, toSessionName: nameOf(LOGIN), text: 'Coupons change the cart total too; rebase after mine lands.' });
    await openBoard();
    await js("document.querySelector('#board .board-view[data-view=\"activity\"]').click()");
    const kinds = ['task', 'edits', 'test', 'conclusion', 'library', 'clash', 'message'];
    const concluded = `${nameOf(DOCS)} concluded: The cart API is documented.`; // the coord tick records it a moment later
    const listed = await waitFor(async () => { const items: { kind: string; text: string }[] = await js(ACTIVITY); return kinds.every((k) => items.some((i) => i.kind === k)) && items.some((i) => i.text === concluded) ? items : null; }, 8000);
    const items: { id: string; kind: string; text: string; who: string; at: number }[] = listed ?? await js(ACTIVITY);
    check(listed, `Activity lists every kind: ${JSON.stringify(kinds.map((k) => [k, items.filter((i) => i.kind === k).length]))}`);
    check(items.every((i, n) => n === 0 || (items[n - 1]?.at ?? 0) >= i.at), `newest first: ${JSON.stringify(items.map((i) => `${i.kind}@${new Date(i.at).toISOString().slice(11, 19)}`))}`);
    const texts = items.map((i) => i.text);
    for (const want of [`Gave “Fix the cart total” to ${nameOf(LOGIN)}`, `${nameOf(LOGIN)} started “Fix the cart total”`, `${nameOf(LOGIN)} finished “Fix the cart total”`, `${nameOf(LOGIN)} and ${nameOf(DOCS)} both edited src/cart.ts`, `${nameOf(DOCS)} concluded: The cart API is documented.`, `${nameOf(DOCS)} edited 2 files`]) {
      check(texts.includes(want), `Activity has "${want}"`);
    }
    const finished = items.findIndex((i) => i.text.includes('finished “Fix')), started = items.findIndex((i) => i.text.includes('started “Fix')), gave = items.findIndex((i) => i.text.startsWith('Gave “Fix'));
    check(finished < started && started < gave, `task given, then claimed, then done, read newest first: ${JSON.stringify({ finished, started, gave })}`);
    check(items.find((i) => i.kind === 'edits' && i.text.includes(nameOf(API)))?.who.includes('feature-x'), 'items carry the session’s branch');
    await capture('activity');

    // 5 Filters: kind, session and branch; each one narrows the list to exactly its items.
    const press = async (selector: string) => { await js(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); return (await js(ACTIVITY)) as typeof items; };
    const edits = await press('#board .activity-kind[data-kind="edits"]');
    check(edits.length === items.filter((i) => i.kind === 'edits').length && edits.every((i) => i.kind === 'edits'), `Edits filter: ${edits.length}`);
    await press('#board .activity-kind[data-kind="all"]');
    await js(`(() => { const s = document.querySelector('#board .activity-session'); s.value = ${JSON.stringify(DOCS.id)}; s.dispatchEvent(new Event('change')); })()`);
    await settle();
    const docsOnly: typeof items = await js(ACTIVITY);
    check(docsOnly.length > 0 && docsOnly.every((i) => i.text.includes(nameOf(DOCS)) || i.who.includes(nameOf(DOCS))), `session filter keeps that session's items: ${JSON.stringify(docsOnly.map((i) => i.text))}`);
    await js("(() => { const s = document.querySelector('#board .activity-session'); s.value = ''; s.dispatchEvent(new Event('change')); })()");
    await js("(() => { const s = document.querySelector('#board .board-branch'); s.value = 'feature-x'; s.dispatchEvent(new Event('change')); })()");
    await settle();
    const featureOnly: typeof items = await js(ACTIVITY);
    check(featureOnly.length >= 2 && featureOnly.every((i) => i.who.includes('feature-x')), `branch filter on Activity: ${JSON.stringify(featureOnly.map((i) => i.text))}`);
    await js("document.querySelector('#board .board-view[data-view=\"sessions\"]').click()");
    await settle();
    const featureCards: string[] = await js("[...document.querySelectorAll('#board .board-card')].map((c) => c.dataset.sessionId)");
    check(JSON.stringify(featureCards) === JSON.stringify([API.id]), `the same branch filter on the Board's cards: ${JSON.stringify(featureCards)}`);
    await js("(() => { const s = document.querySelector('#board .board-branch'); s.value = ''; s.dispatchEvent(new Event('change')); })()");

    // 6 Clicking an item jumps: a Task line's item to its tab and reply, a test run to Testing.
    await js("document.querySelector('#board .board-view[data-view=\"activity\"]').click()");
    await settle();
    const doneItem = (await js(ACTIVITY) as typeof items).find((i) => i.text.includes('finished “Fix'));
    await js(`document.querySelector('#board .activity-item[data-id="${doneItem?.id}"]').click()`);
    const jumped = await waitFor(async () => { const s = await js("({ active: PastelTerm.tabs.active()?.id, open: PastelTerm.overlays.current(), flash: Boolean(document.querySelector('#reader .flash')) })"); return s.active === loginTab && s.open === null ? s : null; }, 4000);
    check(jumped, `a task item opens its session's tab and reply: ${JSON.stringify(jumped)}`);
    await openBoard();
    await js("document.querySelector('#board .board-view[data-view=\"activity\"]').click()");
    await settle();
    await js("document.querySelector('#board .activity-item[data-id=\"test:run-snapshot\"]').click()");
    check(await waitFor(() => js("PastelTerm.overlays.current() === 'testing' || null"), 4000), 'a test run item opens Testing');
    await js('PastelTerm.testing.close()');

    // 7 Survives a restart: the capped list is in userData/activity.json.
    flushActivity();
    const userData = path.join(outDir, 'userData', 'activity.json');
    const persisted = JSON.parse(fs.readFileSync(userData, 'utf8')) as { version: number; events: { kind: string }[] };
    check(persisted.version === 1 && persisted.events.length >= items.length && persisted.events.length <= 500, `activity.json keeps ${persisted.events.length} events (cap 500)`);

    // 8 Contrast in 3 themes x 4 reading styles, Sessions and Activity views, and the reader's clash line.
    await openBoard();
    for (const [themeId] of Object.entries(themes)) {
      applyTheme(themeId, { persist: false });
      for (const [look] of READING_CHOICES) {
        await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
        await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
        const low: { sel: string; ratio: number }[] = [];
        let counted = 0;
        for (const boardView of ['sessions', 'activity']) {
          await js(`document.querySelector('#board .board-view[data-view="${boardView}"]').click()`);
          await wait(200);
          const pairs: { sel: string; cls: string; ratio: number }[] = await js(CONTRAST);
          counted += pairs.length;
          low.push(...pairs.filter((p) => p.ratio < 4.5));
        }
        await js('PastelTerm.sessionsBoard.close()');
        await js(`PastelTerm.tabs.activate(${JSON.stringify(loginTab)})`);
        await wait(200);
        const strip: { sel: string; ratio: number }[] = await js(CONTRAST);
        counted += strip.length;
        low.push(...strip.filter((p) => p.ratio < 4.5));
        check(low.length === 0 && counted > 20, `${themeId} ${look}: ${counted} text parts at 4.5:1 or more ${JSON.stringify(low)}`);
        await openBoard();
      }
    }
    applyTheme('paleSky', { persist: false });
    await js("window.pastel.look.setReading('newspaper')");

    // 9 No overflow at 800, 1200 and 1600, in Sessions and Activity.
    for (const width of WIDTHS) {
      check(await sizeTo(width), `${width}px window sized`);
      for (const boardView of ['sessions', 'activity']) {
        await js(`document.querySelector('#board .board-view[data-view="${boardView}"]').click()`);
        await wait(250);
        const over = await js(OVERFLOW);
        check(over.length === 0, `${width}px ${boardView}: nothing sideways ${JSON.stringify(over)}`);
      }
      await js('PastelTerm.sessionsBoard.close()');
      await js(`PastelTerm.tabs.activate(${JSON.stringify(loginTab)})`);
      await wait(200);
      const strip = await js(OVERFLOW.replace("const board = document.getElementById('board');", "const board = document.getElementById('reader-area');"));
      check(strip.length === 0, `${width}px reader clash line: nothing sideways ${JSON.stringify(strip)}`);
      await openBoard();
    }
    check(await sizeTo(1280), 'back to 1280px');
    await js("document.querySelector('#board .board-view[data-view=\"sessions\"]').click()");
  } finally {
    applyTheme('paleSky', { persist: false });
    await js("window.pastel.look.setReading('newspaper')");
    await js('PastelTerm.sessionsBoard.close()');
    extraTabFixtures.length = 0;
    const opened: string[] = (await js('PastelTerm.tabs.ids()')).filter((t: string) => !startTabs.includes(t));
    for (const t of opened) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(t)})`);
    await waitFor(async () => ((await js('PastelTerm.tabs.ids()')).length === startTabs.length ? true : null), 8000); // closing is async; the feed restore waits for it
    await js(`PastelTerm.tabs.activate(${JSON.stringify(startTabs[0])})`);
    panelFixture.sessions = saved.panel;
    folderFixture.home = saved.home;
    restoreActivity();
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
