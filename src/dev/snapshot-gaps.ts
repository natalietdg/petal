// The gaps build's screens (ui review, 2026-11-15, Table 2): outside-Petal Board cards with Follow, Open a copy and
// Close and its confirm, the spend chip, Ended today, the follow banner and context notice, the launch format notice,
// "Follow a session you already have", the welcome card and the New worktree tick. Captured and checked.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit, TabsDeps } from './snapshot';
import { folderFixture, panelFixture } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { transcriptPath, type SessionFile } from '../main/claude-session';
import { assertFixtureOutsideClaude } from './snapshot-views';
import { keepActivity } from './snapshot-activity';
import { FOLLOW_BANNER, FOLLOW_OFFER_TITLE, OPEN_IN_TAB_LABEL, OUTSIDE_CLOSE_CONFIRM, OUTSIDE_MARK } from '../shared/outside-sessions';
import { formatChangedNotice } from '../shared/reader-notice';

interface Turn { prompt: string; reply: string; usage?: { input: number; cacheWrite: number; cacheRead: number; output: number } }
interface Fixture { id: string; folder: string; branch?: string; status: 'busy' | 'idle'; minutesAgo: number; turns: Turn[] }

const id = (n: number) => `9a95a000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Past the Board's 1M new-token chip, and its latest turn 65% into Claude 5's 1M window, so following it shows the context line.
const BIG: Fixture = { id: id(1), folder: 'garden-planner', branch: 'raised-beds', status: 'busy', minutesAgo: 2, turns: [
  { prompt: 'plan the raised beds', reply: '**The beds fit along the south fence.**\n\n**Doing:** measuring the shade line\n**Next:** order the timber', usage: { input: 1000, cacheWrite: 600_000, cacheRead: 0, output: 20_000 } },
  { prompt: 'and the paths?', reply: '**Paths stay 60cm wide, so the barrow fits.**\n\n**Doing:** drawing the path grid\n**Next:** check the gate width', usage: { input: 1000, cacheWrite: 400_000, cacheRead: 250_000, output: 20_000 } },
] };
const LONG: Fixture = { id: id(2), folder: 'a-very-long-recipe-collection-service-name', branch: 'feature/seasonal-menu-planner', status: 'idle', minutesAgo: 25, turns: [
  { prompt: 'add the autumn menu', reply: '**The autumn menu is in.**' },
] };
const ENDED: Fixture = { id: id(3), folder: 'tide-tables', status: 'idle', minutesAgo: 95, turns: [
  { prompt: 'why are the tide times off by an hour?', reply: '**The feed reports UTC; the page now converts it.**' },
] };
const LIVE = [BIG, LONG];
const THEMES = ['paleSky', 'nightPastel'] as const;
const WIDTHS = [800, 1600] as const;

const entry = (fields: Record<string, unknown>) => JSON.stringify({ isSidechain: false, ...fields });

function writeTranscript(file: string, f: Fixture, cwd: string): void {
  assertFixtureOutsideClaude(file);
  const at = (step: number) => new Date(Date.now() - f.minutesAgo * 60_000 - (f.turns.length * 2 - step) * 1000).toISOString();
  const lines = f.turns.flatMap((turn, i) => [
    entry({ type: 'user', uuid: `${f.id}-u${i}`, timestamp: at(i * 2), cwd, sessionId: f.id, message: { role: 'user', content: turn.prompt } }),
    entry({ type: 'assistant', uuid: `${f.id}-a${i}`, timestamp: at(i * 2 + 1), cwd, sessionId: f.id, message: {
      id: `msg-${f.id}-${i}`, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: turn.reply }],
      ...(turn.usage ? { usage: { input_tokens: turn.usage.input, cache_creation_input_tokens: turn.usage.cacheWrite, cache_read_input_tokens: turn.usage.cacheRead, output_tokens: turn.usage.output } } : {}),
    } }),
  ]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  const mtime = new Date(Date.now() - f.minutesAgo * 60_000);
  fs.utimesSync(file, mtime, mtime);
}

// One outside card's parts, as she sees them.
const OUTSIDE_CARD = (sessionId: string) => `(() => {
  const item = document.querySelector('#board .board-card[data-session-id="${sessionId}"]')?.closest('.board-item');
  if (!item) return null;
  const box = item.getBoundingClientRect();
  const where = item.querySelector('.board-place-where');
  const chip = item.querySelector('.board-spend');
  const chipBox = chip?.getBoundingClientRect();
  const actions = [...item.querySelectorAll(':scope > .board-actions > button')];
  const close = item.querySelector(':scope > .board-actions > .board-close')?.getBoundingClientRect();
  return {
    where: where?.textContent ?? null, whereWhole: where ? where.scrollWidth <= where.clientWidth + 0.5 && where.getBoundingClientRect().right <= box.right : false,
    chip: chip?.textContent ?? null, chipInside: chipBox ? chipBox.left >= box.left && chipBox.right <= box.right + 0.5 : null,
    actions: actions.map((b) => b.textContent), minHeight: Math.min(...actions.map((b) => Math.round(b.getBoundingClientRect().height))),
    closeRight: close ? Math.round(box.right - close.right) : null,
    overflow: item.scrollWidth > item.clientWidth + 1,
    confirm: item.querySelector('.board-close-confirm')?.innerText.replace(/\\s+/g, ' ').trim() ?? null,
  };
})()`;

export async function gapsCheck(kit: Kit, { win, openTab }: Pick<TabsDeps, 'openTab'> & { win: BrowserWindow }): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, themes, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} gaps: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  const sizeTo = async (width: number, height = 900) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      resizeOffscreen(win, width, height);
      if (await waitFor(async () => { win.webContents.invalidate(); return (await js('window.innerWidth')) === width; }, 3000)) return true;
    }
    return false;
  };
  const dir = path.join(outDir, 'gaps');
  const saved = { panel: { ...panelFixture }, home: folderFixture.home };
  const restoreActivity = keepActivity();
  const startTabs: string[] = await js('PastelTerm.tabs.ids()');
  const startActive: string | null = await js('PastelTerm.tabs.active()?.id ?? null');
  const startConfig = await js('window.pastel.config.get()');
  const cwdOf = (f: Fixture) => path.join(dir, 'repos', f.folder);
  // The Board redraws on its tick, so scroll #board itself to the card's current node, twice across a redraw.
  const scrollToCard = async (sessionId: string) => {
    for (let pass = 0; pass < 2; pass++) {
      await js(`(() => { const b = document.getElementById('board'); const i = document.querySelector('#board .board-card[data-session-id="${sessionId}"]')?.closest('.board-item'); if (i) b.scrollTop += i.getBoundingClientRect().top - b.getBoundingClientRect().top - 12; })()`);
      await wait(400);
    }
  };
  const openBoard = async () => {
    if (!(await js("PastelTerm.overlays.current() === 'board'"))) await js("document.getElementById('board-button').click()");
    return waitFor(async () => ((await js("PastelTerm.overlays.current() === 'board'")) ? true : null), 4000);
  };

  try {
    // Fixture: two live sessions no Petal window holds, one ended 95 minutes ago, logs under a stand-in ~/.claude.
    fs.rmSync(dir, { recursive: true, force: true });
    folderFixture.home = path.join(dir, 'claude-home');
    for (const f of [...LIVE, ENDED]) {
      fs.mkdirSync(cwdOf(f), { recursive: true });
      if (f.branch) {
        fs.mkdirSync(path.join(cwdOf(f), '.git'), { recursive: true });
        fs.writeFileSync(path.join(cwdOf(f), '.git', 'HEAD'), `ref: refs/heads/${f.branch}\n`);
      }
      writeTranscript(transcriptPath({ cwd: cwdOf(f), sessionId: f.id }), f, cwdOf(f));
    }
    panelFixture.sessions = LIVE.map((f): SessionFile => ({ pid: 0, sessionId: f.id, cwd: cwdOf(f), kind: 'interactive', entrypoint: 'cli', status: f.status, updatedAt: Date.now() - f.minutesAgo * 60_000 } as SessionFile));
    panelFixture.outside = true;

    // 1 Board: outside cards, their footer, the spend chip, the outside Close confirm, Ended today; light and dark, 800 and 1600.
    for (const theme of THEMES) {
      applyTheme(theme, { persist: false });
      for (const width of WIDTHS) {
        check(await sizeTo(width), `${theme} ${width}px window sized`);
        check(await openBoard(), `${theme} ${width}: Board open`);
        const big = await waitFor(async () => { const c = await js(OUTSIDE_CARD(BIG.id)); return c?.chip && c.where ? c : null; }, 12000);
        const long = await js(OUTSIDE_CARD(LONG.id));
        check(big && big.where === `· ${OUTSIDE_MARK}` && big.whereWhole && long?.where === `· ${OUTSIDE_MARK}` && long.whereWhole,
          `${theme} ${width}: "· outside Petal" stays whole, even after a long repo and branch: ${JSON.stringify({ big: big && [big.where, big.whereWhole], long: long && [long.where, long.whereWhole] })}`);
        check(big && /^1(\.0)?M new tokens$/.test(big.chip ?? '') && big.chipInside, `${theme} ${width}: spend chip past 1M new tokens, inside its card: ${JSON.stringify(big && [big.chip, big.chipInside])}`);
        check(big && JSON.stringify(big.actions) === JSON.stringify(['Follow', OPEN_IN_TAB_LABEL, 'Close']) && big.minHeight >= 24 && (big.closeRight ?? 99) <= 20 && !big.overflow,
          `${theme} ${width}: footer Follow, ${OPEN_IN_TAB_LABEL}, then Close on the right, 24px tall, no overflow: ${JSON.stringify(big)}`);
        await scrollToCard(BIG.id);
        await capture(`gaps-board-outside-${theme}-${width}`);

        await js(`document.querySelector('#board .board-card[data-session-id="${BIG.id}"]').closest('.board-item').querySelector('.board-close').click()`);
        const asked = await waitFor(async () => { const c = await js(OUTSIDE_CARD(BIG.id)); return c?.confirm ? c : null; }, 3000);
        check(asked?.confirm === `${OUTSIDE_CLOSE_CONFIRM} Yes · No` && !asked.overflow, `${theme} ${width}: outside Close asks where it runs, inside the card: ${JSON.stringify(asked?.confirm)}`);
        await scrollToCard(BIG.id);
        await capture(`gaps-board-outside-close-${theme}-${width}`);
        await js(`document.querySelector('#board .board-card[data-session-id="${BIG.id}"]').closest('.board-item').querySelector('.board-close-confirm .session-no').click()`);
        check(await waitFor(async () => ((await js(OUTSIDE_CARD(BIG.id)))?.confirm === null ? true : null), 3000), `${theme} ${width}: No closes nothing`);

        const ended = await waitFor(async () => js(`(() => {
          const section = document.querySelector('#board .board-ended');
          const cards = [...document.querySelectorAll('#board .board-ended-card')];
          const grid = document.querySelector('#board .board-repo-cards')?.getBoundingClientRect();
          if (!section || section.hidden || !cards.length || !grid) return null;
          const first = cards[0].getBoundingClientRect();
          return { names: cards.map((c) => c.querySelector('.board-name')?.textContent), leftGap: Math.round(first.left - grid.left), width: Math.round(first.width), gridWidth: Math.round(grid.width) };
        })()`), 8000);
        check(ended && ended.names.includes(ENDED.turns[0]?.prompt) && Math.abs(ended.leftGap) <= 1, `${theme} ${width}: Ended today lists the ended session, lined up with the cards: ${JSON.stringify(ended)}`);
        await js("document.querySelector('#board .board-ended').scrollIntoView({ block: 'start' })");
        await wait(250);
        await capture(`gaps-board-ended-${theme}-${width}`);
        await js('PastelTerm.sessionsBoard.close()');
      }
    }
    applyTheme('paleSky', { persist: false });

    // 2 Follow: the banner on the reader column, no reply box, the context line; Book at 1280, a magazine look at 800.
    for (const [reading, width] of [['book', 1280], ['editorial', 800]] as const) {
      await js(`window.pastel.look.setReading(${JSON.stringify(reading)})`);
      check(await sizeTo(width), `follow ${reading} ${width}px window sized`);
      await openBoard();
      await waitFor(() => js(`Boolean(document.querySelector('#board .board-card[data-session-id="${BIG.id}"]'))`), 8000);
      await js(`document.querySelector('#board .board-card[data-session-id="${BIG.id}"]').closest('.board-item').querySelector('.board-follow').click()`);
      const followed = await waitFor(async () => {
        const s = await js(`(() => {
          const banner = document.querySelector('.follow-banner');
          const text = banner?.querySelector('.follow-banner-text');
          const stop = banner?.querySelector('.follow-stop');
          const notice = document.querySelector('.context-notice');
          const close = notice?.querySelector('.context-notice-close');
          const column = document.querySelector('#latest')?.getBoundingClientRect();
          return { banner: banner && !banner.hidden ? text.textContent : null, textLeft: text ? Math.round(text.getBoundingClientRect().left) : null, columnLeft: column ? Math.round(column.left) : null,
            stopHeight: stop ? Math.round(stop.getBoundingClientRect().height) : null, composer: getComputedStyle(document.getElementById('composer')).display,
            notice: notice && !notice.hidden ? notice.textContent : null, gotItHeight: close ? Math.round(close.getBoundingClientRect().height) : null,
            reply: document.querySelector('#latest')?.textContent.includes('barrow fits') ?? false, pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
        })()`);
        return s.banner && s.reply && s.notice ? s : null;
      }, 10000);
      check(followed && followed.banner === FOLLOW_BANNER && followed.composer === 'none' && Math.abs((followed.textLeft ?? 0) - (followed.columnLeft ?? 99)) <= 2 && (followed.stopHeight ?? 0) >= 24 && !followed.pageOverflow,
        `${reading} ${width}: follow banner on the reader column, reply box gone, Stop following 24px: ${JSON.stringify(followed)}`);
      check(followed && /^Context about 70% full\. \/compact at a clean point\./.test(followed.notice ?? '') && (followed.gotItHeight ?? 0) >= 24, `${reading} ${width}: context line with Got it, 24px: ${JSON.stringify(followed && [followed.notice, followed.gotItHeight])}`);
      await capture(`gaps-follow-${reading}-${width}`);
      await js("document.querySelector('.follow-banner .follow-stop').click()");
      check(await waitFor(async () => ((await js("document.querySelector('.follow-banner').hidden")) ? true : null), 3000), `${reading} ${width}: Stop following ends it`);
    }
    await js("window.pastel.look.setReading('newspaper')");
    check(await sizeTo(1280), '1280px window sized');

    // 3 The launch format notice, in light and dark.
    const formatText = formatChangedNotice('2.1.400', 'Claude Code’s session file has no sessionId.');
    await js(`PastelTerm.reader.showNotice(${JSON.stringify(formatText)})`);
    for (const theme of THEMES) {
      applyTheme(theme, { persist: false });
      await wait(250);
      const shown = await js("(() => { const n = [...document.querySelectorAll('.reader-notice')].find((e) => !e.hidden && !e.classList.contains('context-notice')); const r = n?.getBoundingClientRect(); return n ? { text: n.textContent, width: Math.round(r.width), right: Math.round(r.right), inner: window.innerWidth } : null; })()");
      check(shown?.text === formatText && shown.right <= shown.inner, `${theme}: format notice shown, wraps inside the window: ${JSON.stringify(shown)}`);
      await js("document.getElementById('reader').scrollTop = 0");
      await capture(`gaps-format-notice-${theme}`);
    }
    await js("[...document.querySelectorAll('.reader-notice')].filter((e) => e.textContent.startsWith('Claude Code')).forEach((e) => { e.hidden = true; })");
    applyTheme('paleSky', { persist: false });

    // 4 "Follow a session you already have": on What's next, and under First steps in an empty reader.
    await js('PastelTerm.petGuide.openSteps()');
    const offer = await waitFor(() => js("(() => { const o = document.querySelector('#pet-guide .follow-offer'); return o && !o.hidden ? { title: o.querySelector('.follow-offer-title')?.textContent, follows: [...o.querySelectorAll('.follow-offer-follow')].map((b) => b.textContent) } : null; })()"), 8000);
    check(offer && offer.title === FOLLOW_OFFER_TITLE && offer.follows.length === 2, `What's next offers to follow the outside sessions: ${JSON.stringify(offer)}`);
    await js("document.querySelector('#pet-guide .follow-offer')?.scrollIntoView({ block: 'center' })");
    await capture('gaps-whats-next-follow-offer');
    await js('PastelTerm.petGuide.closeSteps()');
    openTab(win.webContents);
    const empty = await waitFor(() => js("(() => { const o = document.querySelector('#reader-status .follow-offer'); const last = [...o?.querySelectorAll('.follow-offer-follow') ?? []].at(-1)?.getBoundingClientRect(); const reader = document.getElementById('reader').getBoundingClientRect(); return o && !o.hidden && last ? { follows: o.querySelectorAll('.follow-offer-follow').length, status: document.getElementById('reader-status').classList.contains('empty'), aboveFold: last.bottom <= reader.bottom } : null; })()"), 10000);
    check(empty && empty.follows === 2 && empty.status && empty.aboveFold, `an empty reader offers them under First steps, above the fold: ${JSON.stringify(empty)}`);
    await capture('gaps-empty-reader-follow-offer');

    // 5 The welcome card, raw beside the page: every theme at 800 and 1280, and Book.
    await js('PastelTerm.petGuide.restart()');
    const hello = await waitFor(() => js("Boolean(document.querySelector('#pet-guide .pg-hello-page'))"), 8000);
    check(hello, 'Help › Get started opens the welcome card');
    for (const theme of Object.keys(themes)) {
      applyTheme(theme, { persist: false });
      for (const width of [800, 1280]) {
        await sizeTo(width);
        await wait(300);
        const fit = await js("(() => { const v = document.getElementById('pet-guide'); const boxes = [...document.querySelectorAll('#pet-guide .pg-hello > *')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }); return { page: document.documentElement.scrollWidth > window.innerWidth + 1, card: v.scrollWidth > v.clientWidth + 1, boxes }; })()");
        check(fit && !fit.page && !fit.card, `welcome ${theme} ${width}: nothing sideways: ${JSON.stringify(fit)}`);
        await capture(`gaps-welcome-${theme}-${width}`);
      }
    }
    applyTheme('paleSky', { persist: false });
    await js("window.pastel.look.setReading('book')");
    await wait(300);
    await capture('gaps-welcome-book-1280');
    await js("window.pastel.look.setReading('newspaper')");
    await js('PastelTerm.petGuide.skip()');
    await restoreGuideState(startConfig);

    // 6 The New worktree tick, ticked, in light and dark.
    for (const theme of THEMES) {
      applyTheme(theme, { persist: false });
      await js("PastelTerm.repos.open('', 'session')");
      await waitFor(() => js("!document.querySelector('.repos-worktree').hidden"), 3000);
      await js("document.querySelector('.repos-worktree-toggle input').click()");
      const tick = await waitFor(() => js("(() => { const t = document.querySelector('.repos-worktree-toggle'); const n = document.querySelector('.repos-worktree-name'); return t.querySelector('input').checked && !n.hidden ? { height: Math.round(t.getBoundingClientRect().height), name: Math.round(n.getBoundingClientRect().width) } : null; })()"), 3000);
      check(tick && tick.height >= 24 && tick.name > 100, `${theme}: New worktree ticked shows its name field; the tick row is 24px: ${JSON.stringify(tick)}`);
      await capture(`gaps-worktree-${theme}`);
      await js('PastelTerm.repos.close()');
    }
  } finally {
    applyTheme('paleSky', { persist: false });
    await js("window.pastel.look.setReading('newspaper')");
    await js("PastelTerm.overlays.current() === 'board' && PastelTerm.sessionsBoard.close()");
    await js("document.querySelector('.follow-banner:not([hidden]) .follow-stop')?.click()");
    const opened: string[] = (await js('PastelTerm.tabs.ids()')).filter((t: string) => !startTabs.includes(t));
    for (const t of opened) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(t)})`);
    await waitFor(async () => ((await js('PastelTerm.tabs.ids()')).length === startTabs.length ? true : null), 8000);
    if (startActive) await js(`PastelTerm.tabs.activate(${JSON.stringify(startActive)})`);
    panelFixture.sessions = saved.panel.sessions;
    panelFixture.subagentsRoot = saved.panel.subagentsRoot;
    panelFixture.outside = saved.panel.outside;
    folderFixture.home = saved.home;
    restoreActivity();
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }

  // The guide's saved stage and welcome flag, as they were before Get started reopened it.
  async function restoreGuideState(before: { config?: { onboarding?: unknown; welcome?: unknown } }): Promise<void> {
    if (before?.config) await js(`window.pastel.config.save(${JSON.stringify({ onboarding: before.config.onboarding, welcome: before.config.welcome })})`);
  }
}
