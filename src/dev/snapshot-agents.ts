// Agents (PASTEL_SNAPSHOT_MODE=agents): header chip (no overlap); its dropdown over the reply (running first, then newest;
// Esc, outside click, the chip and arrow keys); an agent opens in Notes' right slot at full height, follows appends within 1s,
// and swaps with Notes; nothing scrolls sideways at 800px; every theme; the Sessions entry.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { unclippedCheck } from './snapshot-divider';
import { appendedReport, appendedStep, FINISHED_ID, HOSTILE_OUTPUT, NEWER_ID, RUNNING_ID, writeAgentsFixture, writeManyAgents, writeYesterdayAgent, YESTERDAY_ID } from './snapshot-agents-fixture';
import { AGENTS_LISTED } from '../main/agents';
import { fixtureFile, panelFixture } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { READING_CHOICES } from '../main/menu';
import { load as loadConfig } from '../main/config-store';

const WIDTHS = [800, 1280, 1600];

// Chip vs view toggle, Notes toggle and status strip: no intersection, inside the column, every one still takes its click.
const CHIP_PROBE = `(() => {
  const r = (el) => el.getBoundingClientRect();
  const chip = document.getElementById('agents-chip');
  const notes = document.getElementById('notes-toggle');
  const strip = document.querySelector('#reader-head .status-strip');
  const c = r(chip), col = r(document.querySelector('#reader-head .reader-head-column'));
  const others = [document.querySelector('#reader-head .view-toggle'), notes, strip].filter((el) => el && !el.hidden && r(el).height > 0);
  const apart = others.every((el) => { const t = r(el); return c.left >= t.right || c.right <= t.left || c.top >= t.bottom || c.bottom <= t.top; });
  const takes = (el) => { const b = r(el); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return hit === el || el.contains(hit); };
  return { shown: !chip.hidden && c.width > 0, apart, inside: c.left >= col.left - 0.5 && c.right <= col.right + 0.5 && c.top >= col.top - 0.5 && c.bottom <= col.bottom + 0.5,
    hit: takes(chip), notesHit: Boolean(notes) && takes(notes), notes: Boolean(notes) && !notes.hidden, strip: Boolean(strip) && !strip.hidden, text: chip.textContent };
})()`;

// A reply with Doing / Recommend / Next, so the header strip shows during the geometry check.
const STRIP_REPLY = ['**Header check.**', '', '**Doing:** checking the header row.', '**Recommend:** keep the chip beside Notes.', '**Next:** open the agents dropdown.'].join('\n');

// The dropdown, the chip it hangs from, and whether the reply under it is still on screen.
const MENU_PROBE = `(() => {
  const m = document.getElementById('agents-menu');
  const r = m.getBoundingClientRect();
  const chip = document.getElementById('agents-chip');
  const c = chip.getBoundingClientRect();
  const latest = document.getElementById('latest');
  const l = latest.getBoundingClientRect();
  const task = m.querySelector('.agents-menu-task');
  return {
    open: !m.hidden && r.height > 0, expanded: chip.getAttribute('aria-expanded'),
    rows: [...m.querySelectorAll('.agents-menu-row')].map((b) => ({ id: b.dataset.agentId, status: b.dataset.status, task: b.querySelector('.agents-menu-task').textContent,
      time: b.querySelector('.agents-menu-time').textContent, dot: b.querySelector('.agents-dot.' + b.dataset.status) !== null })),
    under: r.top >= c.bottom - 0.5 && r.top - c.bottom <= 12, rightEdge: Math.abs(r.right - c.right) <= 1,
    reply: !document.getElementById('reader').hidden && latest.innerText.trim().length > 0 && l.height > 0 && l.top < window.innerHeight && l.bottom > 0,
    overlay: PastelTerm.overlays.current(),
    focused: document.activeElement?.dataset?.agentId ?? null,
    bg: getComputedStyle(m).backgroundColor, fg: task ? getComputedStyle(task).color : null,
    inView: r.left >= 0 && r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5,
    sideways: document.documentElement.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth,
    more: m.querySelector('.agents-menu-more')?.textContent ?? null,
    scrolls: m.scrollHeight > m.clientHeight + 1, height: Math.round(r.height), cap: parseFloat(getComputedStyle(m).maxHeight),
  };
})()`;

// The right panel: geometry against the header, the reader area, Notes and the cat; then the timeline's rows.
const PANEL_PROBE = `(() => {
  const R = (b) => ({ left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width) });
  const p = document.getElementById('agent-panel');
  const notes = document.getElementById('notes-panel');
  const area = document.getElementById('reader-area');
  return {
    open: !p.hidden && p.getBoundingClientRect().width > 0, id: PastelTerm.agentPanel.openAgentId(),
    title: p.querySelector('.agent-panel-title')?.textContent, meta: p.querySelector('.agent-panel-meta')?.textContent,
    close: Boolean(p.querySelector('.notes-panel-close')),
    rect: R(p.getBoundingClientRect()), notesRect: R(notes.getBoundingClientRect()), notesOpen: !notes.hidden,
    notesPressed: document.getElementById('notes-toggle').getAttribute('aria-pressed'),
    headTop: Math.round(document.getElementById('reader-head').getBoundingClientRect().top), areaBottom: Math.round(area.getBoundingClientRect().bottom),
    reader: R(document.getElementById('reader').getBoundingClientRect()), cat: R(document.getElementById('cat').getBoundingClientRect()),
    docked: area.classList.contains('cat-docked'), viewport: window.innerWidth,
    sideways: document.documentElement.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth,
    bg: getComputedStyle(p).backgroundColor,
    promptCollapsed: p.querySelector('.agent-prompt details')?.open === false,
    steps: [...p.querySelectorAll('.agent-step')].map((s) => s.querySelector('.agent-step-summary').textContent + ' ' + s.querySelector('.agent-step-status').textContent),
    markdown: Boolean(p.querySelector('.agent-message strong')), report: p.querySelector('.agent-report')?.innerText ?? null,
    outputMax: Math.max(0, ...[...p.querySelectorAll('.agent-step-output pre')].map((x) => x.textContent.length)),
    outputsCollapsed: [...p.querySelectorAll('.agent-step-output')].every((d) => !d.open),
    injected: Boolean(document.getElementById('agents-xss-probe')) || Boolean(window.__agentsXss),
  };
})()`;

// The header's way back to Notes, and the chip, are not under the panel.
const REACH_PROBE = `(() => {
  const takes = (el) => { const b = el.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return b.width > 0 && (hit === el || el.contains(hit)); };
  return { notes: takes(document.getElementById('notes-toggle')), chip: takes(document.getElementById('agents-chip')) };
})()`;

const near = (a: number, b: number, px = 2): boolean => Math.abs(a - b) <= px;
type Rect = { left: number; right: number; top: number; bottom: number };
const sameRect = (a: Rect, b: Rect): boolean => near(a.left, b.left) && near(a.right, b.right) && near(a.top, b.top) && near(a.bottom, b.bottom);
const opaque = (colour: string): boolean => !/rgba\(.*, 0\)$|transparent/.test(colour);

export async function agentsCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, log, wait, waitFor, capture, applyTheme, themes } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} agents: ${what}`);
  // any: the probes' shapes are built in the scripts above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const menu = (): Promise<any> => js(MENU_PROBE);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const panel = (): Promise<any> => js(PANEL_PROBE);
  const sizeTo = async (width: number) => {
    resizeOffscreen(win, width, 900);
    await waitFor(async () => (await js('window.innerWidth')) === width, 3000);
    await wait(250);
  };
  const openMenu = async () => {
    await js("PastelTerm.agentsMenu.isOpen() || document.getElementById('agents-chip').click()");
    return waitFor(async () => { const m = await menu(); return m.open && m.rows.length >= 3 && m.focused ? m : null; }, 5000);
  };
  const key = (name: string) => js(`(document.activeElement ?? document).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(name)}, bubbles: true, cancelable: true }))`);
  const openFromMenu = async (agentId: string) => {
    await openMenu();
    await js(`document.querySelector('#agents-menu .agents-menu-row[data-agent-id="${agentId}"]').click()`);
    return waitFor(async () => { const p = await panel(); return p.open && p.id === agentId && p.steps.length > 0 ? p : null; }, 5000);
  };

  const dir = path.join(path.dirname(fixtureFile() ?? ''), 'snapshot-fixture', 'subagents');
  const files = writeAgentsFixture(dir);
  await js('(() => { const open = PastelTerm.overlays.current(); if (open) PastelTerm.overlays.hide(open); })()'); // the reader header shows
  await js('PastelTerm.tabs.activate(PastelTerm.tabs.ids()[0])');
  const own = await waitFor(() => js("PastelTerm.tabs.active()?.update?.sessionId === 'snapshot-fixture'"), 5000);
  check(own, 'the reader shows the fixture session');
  applyTheme('paleSky', { persist: false });
  await js("PastelTerm.reader.setView('replies')");
  const notesBefore = loadConfig().notesPanel.open; // restored at the end, for the steps after this one
  await js('PastelTerm.notesPanel.setOpen(false)');
  await js('PastelTerm.sessionsPanel.refresh()');
  const chip = await waitFor(async () => { const p = await js(CHIP_PROBE); return p.shown ? p : null; }, 8000);
  check(chip?.text === 'Agents · 1 running', `header chip counts this session's running agents: ${JSON.stringify(chip?.text)}`);

  const [startWidth, startHeight] = win.getContentSize();
  const stripUpdate = { state: 'live', replies: [{ id: 'agents-strip', markdown: STRIP_REPLY, prompt: '', timestamp: new Date().toISOString() }], sessionId: 'snapshot-fixture' };
  await js(`PastelTerm.reader.update({ ...${JSON.stringify(stripUpdate)}, tabId: PastelTerm.tabs.active().id })`);
  for (const [look] of READING_CHOICES) {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    for (const width of WIDTHS) {
      await sizeTo(width);
      const p = await js(CHIP_PROBE);
      check(p.shown && p.notes && p.strip && p.apart && p.inside && p.hit && p.notesHit, `${look} ${width}px chip, Notes toggle and strip all shown, chip clear of each, inside the column, both clickable: ${JSON.stringify(p)}`);
      if (width === 800) await capture(`agents-chip-${look}-800`);
    }
  }
  await js("window.pastel.look.setReading('newspaper')");
  await js('(() => { const tab = PastelTerm.tabs.active(); PastelTerm.reader.update({ ...tab.update, tabId: tab.id }); })()'); // back to the fixture's replies
  await sizeTo(1280);

  // 1. The chip opens a dropdown; the reply stays on screen.
  const opened = await openMenu();
  check(opened?.open && opened.expanded === 'true' && opened.under && opened.rightEdge, `the chip opens a dropdown hanging under it: ${JSON.stringify(opened && { under: opened.under, rightEdge: opened.rightEdge, expanded: opened.expanded })}`);
  check(opened?.reply && opened.overlay === null, `no page switch, the reply is still on screen: ${JSON.stringify(opened && { reply: opened.reply, overlay: opened.overlay })}`);
  check(opened?.rows.map((r: { id: string }) => r.id).join() === [RUNNING_ID, NEWER_ID, FINISHED_ID].join(), `running first, then newest: ${JSON.stringify(opened?.rows.map((r: { id: string }) => r.id))}`);
  check(opened?.rows[0]?.status === 'running' && opened.rows[1]?.status === 'done' && opened.rows[2]?.status === 'done' && opened.rows.every((r: { dot: boolean }) => r.dot),
    `each row has its status dot: ${JSON.stringify(opened?.rows.map((r: { status: string }) => r.status))}`);
  check(opened?.rows[0]?.task === 'Tidy the print styles' && /· \d+[smh]/.test(opened.rows[0].time) && /· \d+[smh]/.test(opened.rows[2].time), `rows show the description and time · duration: ${JSON.stringify(opened?.rows[0])}`);
  check(opened?.focused === RUNNING_ID, `focus lands on the first row: ${opened?.focused}`);
  await capture('agents-dropdown-paleSky');

  // 2. Keyboard: arrows move, End jumps, Esc closes back to the chip.
  await key('ArrowDown');
  const down = (await menu()).focused;
  await key('ArrowUp');
  const up = (await menu()).focused;
  await key('End');
  const end = (await menu()).focused;
  await key('ArrowDown');
  const wrapped = (await menu()).focused;
  check(down === NEWER_ID && up === RUNNING_ID && end === FINISHED_ID && wrapped === RUNNING_ID, `arrow keys move the focus: ${JSON.stringify({ down, up, end, wrapped })}`);
  await key('Escape');
  const escaped = await waitFor(async () => { const m = await menu(); return !m.open ? m : null; }, 2000);
  check(escaped && escaped.expanded === 'false' && (await js("document.activeElement?.id === 'agents-chip'")), 'Esc closes it and hands focus back to the chip');

  await openMenu();
  await js("document.getElementById('latest').click()");
  check(await waitFor(async () => !(await menu()).open || null, 2000), 'a click outside closes it');
  await openMenu();
  await js("document.getElementById('agents-chip').click()");
  check(await waitFor(async () => !(await menu()).open || null, 2000), 'clicking the chip again closes it');

  // 3. Enter opens the focused agent in the right panel at full height.
  await openMenu();
  await key('End');
  await key('Enter');
  const byKey = await waitFor(async () => { const p = await panel(); return p.open && p.id === FINISHED_ID && p.steps.length ? p : null; }, 5000);
  check(byKey && !(await menu()).open && byKey.title === 'Check the header spacing', `Enter opens that agent in the panel and closes the dropdown: ${JSON.stringify(byKey?.title)}`);

  const running = await openFromMenu(RUNNING_ID);
  check(running?.title === 'Tidy the print styles' && running.meta?.startsWith('running') && running.close && running.promptCollapsed && running.markdown,
    `clicking a row opens its timeline in the panel, name, status and Close in the header: ${JSON.stringify(running && { title: running.title, meta: running.meta })}`);
  check(running?.steps.join() === 'Reading print.css ok,Running npm test ok', `steps as compact rows with result status: ${JSON.stringify(running?.steps)}`);
  check(running && !running.injected && running.outputMax <= 301 && running.outputMax < HOSTILE_OUTPUT.length && running.outputsCollapsed, `tool output cut short, collapsed, never HTML: ${JSON.stringify(running && { outputMax: running.outputMax })}`);
  check(running && near(running.rect.top, running.headTop) && near(running.rect.bottom, running.areaBottom) && running.rect.right === running.viewport,
    `full height at the right edge, header top to reader-area bottom: ${JSON.stringify(running && { rect: running.rect, headTop: running.headTop, areaBottom: running.areaBottom })}`);
  check(running && running.reader.right <= running.rect.left && (running.docked || running.cat.right <= running.rect.left), `reader and cat stay left of the panel: ${JSON.stringify(running && { reader: running.reader, cat: running.cat, docked: running.docked })}`);
  await unclippedCheck(kit, 'Agent panel 1280', '#agent-panel');
  await capture('agents-panel-paleSky');

  // 4. Live: an appended line shows up within 1s; the report and "done" when it finishes.
  await js(`window.__agentRowAt = 0; new MutationObserver((_m, o) => {
    if ([...document.querySelectorAll('#agent-panel .agent-step-summary')].some((s) => s.textContent.startsWith('Editing print.css'))) { window.__agentRowAt = Date.now(); o.disconnect(); }
  }).observe(document.getElementById('agent-panel'), { childList: true, subtree: true })`);
  const appendAt = Date.now();
  fs.appendFileSync(files.running, appendedStep());
  const rowAt = await waitFor(() => js('window.__agentRowAt'), 3000);
  const latency = rowAt ? rowAt - appendAt : null;
  check(latency !== null && latency <= 1000, `an appended line shows up in the panel within 1s: ${latency}ms`);
  fs.appendFileSync(files.running, appendedReport());
  const done = await waitFor(async () => { const p = await panel(); return p.report && p.meta?.startsWith('done') ? p : null; }, 3000);
  check(done?.report?.includes('Print styles tidied.'), `final report shows and the header says done: ${JSON.stringify({ report: done?.report, meta: done?.meta })}`);

  // 5. Notes and the agent panel swap in one slot.
  await js('PastelTerm.agentPanel.hide()');
  await js('PastelTerm.notesPanel.setOpen(true)');
  const notesFirst = await waitFor(async () => { const p = await panel(); return p.notesOpen && !p.open ? p : null; }, 3000);
  const swapIn = await openFromMenu(RUNNING_ID);
  check(swapIn && !swapIn.notesOpen && notesFirst && sameRect(swapIn.rect, notesFirst.notesRect) && swapIn.notesPressed === 'false',
    `the agent replaces Notes in the same slot: ${JSON.stringify({ notes: notesFirst?.notesRect, agent: swapIn?.rect })}`);
  await js("document.getElementById('notes-toggle').click()");
  const swapBack = await waitFor(async () => { const p = await panel(); return p.notesOpen && !p.open ? p : null; }, 3000);
  check(swapBack && swapBack.id === null && swapBack.notesPressed === 'true' && swapIn && sameRect(swapBack.notesRect, swapIn.rect), `the Notes button takes the slot back: ${JSON.stringify(swapBack?.notesRect)}`);
  await openFromMenu(RUNNING_ID);
  await js("document.querySelector('#agent-panel .notes-panel-close').click()");
  const closed = await waitFor(async () => { const p = await panel(); return !p.open && p.notesOpen ? p : null; }, 3000);
  check(closed && closed.id === null, 'Close hands the slot back to Notes');
  await js('PastelTerm.notesPanel.setOpen(false)');
  const onlyOne = await openFromMenu(RUNNING_ID);
  check(onlyOne && !onlyOne.notesOpen, 'one right panel at a time');

  // 6. Narrow and wide: no sideways scroll, the reader and cat clear of the panel when docked.
  for (const width of [800, 1600]) {
    await sizeTo(width);
    const p = await panel();
    const drawer = width < 1000;
    check(p.open && !p.sideways && p.rect.right === p.viewport, `${width}px panel open at the right edge, nothing scrolls sideways: ${JSON.stringify({ rect: p.rect, sideways: p.sideways })}`);
    if (drawer) check(p.rect.width <= p.viewport * 0.88 + 1, `${width}px drawer ${p.rect.width}px leaves the column its measure`);
    else check(p.reader.right <= p.rect.left && (p.docked || p.cat.right <= p.rect.left), `${width}px reader and cat left of the panel: ${JSON.stringify({ reader: p.reader, cat: p.cat })}`);
    const reach = await js(REACH_PROBE);
    check(reach.notes && reach.chip, `${width}px the Notes button and the chip stay clickable beside the panel: ${JSON.stringify(reach)}`);
    await unclippedCheck(kit, `Agent panel ${width}`, '#agent-panel');
    const m = await openMenu();
    check(m && m.inView && !m.sideways && m.reply, `${width}px dropdown inside the window, nothing scrolls sideways: ${JSON.stringify(m && { inView: m.inView, sideways: m.sideways })}`);
    await unclippedCheck(kit, `Agents dropdown ${width}`, '#agents-menu');
    if (width === 800) await capture('agents-dropdown-800');
    await key('Escape');
  }
  await sizeTo(1280);

  // 7. Every theme: the dropdown and panel are opaque with readable rows.
  for (const id of Object.keys(themes)) {
    applyTheme(id, { persist: false });
    await wait(150);
    const m = await openMenu();
    const p = await panel();
    check(m && opaque(m.bg) && m.fg !== m.bg && p.open && opaque(p.bg), `${id} dropdown and panel opaque, rows readable: ${JSON.stringify({ menu: m?.bg, fg: m?.fg, panel: p.bg })}`);
    if (id === 'nightPastel') {
      await capture('agents-dropdown-nightPastel');
      await key('Escape');
      await capture('agents-panel-nightPastel');
    } else await key('Escape');
  }
  applyTheme('paleSky', { persist: false });
  await js('PastelTerm.agentPanel.hide()');

  // 8. A long list scrolls inside the dropdown's cap.
  writeManyAgents(dir, 24);
  writeYesterdayAgent(dir);
  await js('PastelTerm.sessionsPanel.refresh()');
  const long = await waitFor(async () => { await js("PastelTerm.agentsMenu.isOpen() || document.getElementById('agents-chip').click()"); const m = await menu(); return m.rows.length >= 28 ? m : null; }, 6000);
  check(long && long.scrolls && long.height <= long.cap + 1 && long.inView, `a long list scrolls inside the capped dropdown: ${JSON.stringify(long && { rows: long.rows.length, height: long.height, cap: long.cap })}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const old = long?.rows.find((r: any) => r.id === YESTERDAY_ID);
  check(old && old.status === 'done' && long.rows.at(-1)?.id === YESTERDAY_ID && /,/.test(old.time) && long.more === null, `yesterday's agent is listed last, with its date: ${JSON.stringify(old)}`);
  const allDays = await js(CHIP_PROBE);
  check(allDays.text === 'Agents · 28', `with none running the chip counts the whole session, any day: ${JSON.stringify(allDays.text)}`);
  await key('Escape');

  // 8b. Past the list cap the newest show and the rest are "+N more"; the chip still counts them all.
  writeManyAgents(dir, AGENTS_LISTED + 10);
  const total = 3 + AGENTS_LISTED + 10 + 1;
  await js('PastelTerm.sessionsPanel.refresh()');
  const capped = await waitFor(async () => { await js("PastelTerm.agentsMenu.isOpen() || document.getElementById('agents-chip').click()"); await js('PastelTerm.sessionsPanel.refresh()'); const m = await menu(); return m.rows.length === AGENTS_LISTED && m.more ? m : null; }, 8000);
  const cappedChip = await js(CHIP_PROBE);
  check(capped && capped.more === `+${total - AGENTS_LISTED} more` && cappedChip.text === `Agents · ${total}`, `past the cap: ${JSON.stringify(capped && { rows: capped.rows.length, more: capped.more, chip: cappedChip.text })}`);
  await key('Escape');

  // 9. Sessions panel entry: another session's agent row opens in the panel.
  const root = path.join(path.dirname(dir), 'panel-agents');
  const otherId = 'a9a9a9a9-0000-4000-8000-00000000aa01';
  writeAgentsFixture(path.join(root, otherId));
  panelFixture.subagentsRoot = root;
  panelFixture.sessions = [{ pid: 0, sessionId: otherId, cwd: '/tmp/petal-fixture/agents', kind: 'interactive', status: 'busy', name: 'Agents elsewhere', updatedAt: Date.now() }];
  await js('PastelTerm.sessionsPanel.setOpen(true)');
  const row = `#sessions-panel .session-row[data-session-id="${otherId}"] .session-agent[data-agent-id="${RUNNING_ID}"]`;
  check(await waitFor(() => js(`Boolean(document.querySelector('${row}'))`), 5000), 'Sessions panel lists the other session\'s agent');
  await js(`document.querySelector('${row}').click()`);
  const fromPanel = await waitFor(async () => { const p = await panel(); return p.open && p.steps.length === 2 && p.title === 'Tidy the print styles' ? p : null; }, 5000);
  check(fromPanel?.id === RUNNING_ID && (await js("document.getElementById('sessions-panel').hidden")), `clicking it closes Sessions and opens the agent panel: ${JSON.stringify(fromPanel?.title)}`);
  check(fromPanel && !(await menu()).open && !(await js("document.getElementById('agent-panel').hidden")), 'the Sessions row and the header menu open the same agent panel');
  await js('PastelTerm.agentPanel.hide()');
  await js('PastelTerm.sessionsPanel.setOpen(true)');
  await waitFor(() => js(`Boolean(document.querySelector('${row}'))`), 5000);
  const keyable = await js(`(() => { const r = document.querySelector('${row}'); r.focus(); return { focused: document.activeElement === r, role: r.getAttribute('role') }; })()`);
  check(keyable.focused && keyable.role === 'button', `an agent row takes keyboard focus as a button: ${JSON.stringify(keyable)}`);
  await key('Enter');
  const byEnter = await waitFor(async () => { const p = await panel(); return p.open && p.id === RUNNING_ID && p.steps.length ? p : null; }, 5000);
  check(byEnter && (await js("document.getElementById('sessions-panel').hidden")), 'Enter on a Sessions agent row opens the agent panel too');
  await js('PastelTerm.agentPanel.hide()');

  panelFixture.sessions = null;
  panelFixture.subagentsRoot = null;
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
  await js('PastelTerm.sessionsPanel.setOpen(false)');
  const gone = await waitFor(() => js("document.getElementById('agents-chip').hidden"), 8000);
  check(gone, 'the chip hides when the session has no agents');
  await js(`window.pastel.config.save({ notesPanel: { open: ${JSON.stringify(notesBefore)} } }).then(() => PastelTerm.notesPanel.loadPrefs())`);
  resizeOffscreen(win, startWidth, startHeight);
}
