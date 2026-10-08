// Agents view: header chip (no overlap), list with status and step, timeline that follows appends within 1s, Esc back, Sessions entry.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { unclippedCheck } from './snapshot-divider';
import { appendedReport, appendedStep, FINISHED_ID, HOSTILE_OUTPUT, RUNNING_ID, writeAgentsFixture } from './snapshot-agents-fixture';
import { fixtureFile, panelFixture } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { READING_CHOICES } from '../main/menu';

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
const STRIP_REPLY = ['**Header check.**', '', '**Doing:** checking the header row.', '**Recommend:** keep the chip beside Notes.', '**Next:** open the agents list.'].join('\n');

const LIST_PROBE = `[...document.querySelectorAll('#agents .agents-row')].map((b) => ({
  id: b.dataset.agentId, task: b.querySelector('.agents-row-task').textContent, status: b.querySelector('.agent-status').textContent,
  step: b.querySelector('.agents-row-step').textContent, meta: b.querySelector('.agents-row-meta').textContent }))`;

const TIMELINE_PROBE = `(() => {
  const v = document.getElementById('agents');
  return {
    open: PastelTerm.agentsView.openAgentId(), title: v.querySelector('.agent-title')?.textContent, meta: v.querySelector('.agent-meta')?.textContent,
    promptCollapsed: v.querySelector('.agent-prompt details')?.open === false,
    steps: [...v.querySelectorAll('.agent-step')].map((s) => s.querySelector('.agent-step-summary').textContent + ' ' + s.querySelector('.agent-step-status').textContent),
    markdown: Boolean(v.querySelector('.agent-message strong')), report: v.querySelector('.agent-report')?.innerText ?? null,
    outputMax: Math.max(0, ...[...v.querySelectorAll('.agent-step-output pre')].map((p) => p.textContent.length)),
    outputsCollapsed: [...v.querySelectorAll('.agent-step-output')].every((d) => !d.open),
    injected: Boolean(document.getElementById('agents-xss-probe')) || Boolean(window.__agentsXss),
  };
})()`;

export async function agentsCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, log, wait, waitFor, capture, applyTheme } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} agents: ${what}`);
  const dir = path.join(path.dirname(fixtureFile() ?? ''), 'snapshot-fixture', 'subagents');
  const files = writeAgentsFixture(dir);
  await js('(() => { const open = PastelTerm.overlays.current(); if (open) PastelTerm.overlays.hide(open); })()'); // the reader header shows
  await js('PastelTerm.tabs.activate(PastelTerm.tabs.ids()[0])');
  const own = await waitFor(() => js("PastelTerm.tabs.active()?.update?.sessionId === 'snapshot-fixture'"), 5000);
  check(own, 'the reader shows the fixture session');
  applyTheme('paleSky', { persist: false });
  await js("PastelTerm.reader.setView('replies')");
  await js('PastelTerm.sessionsPanel.refresh()');
  const chip = await waitFor(async () => { const p = await js(CHIP_PROBE); return p.shown ? p : null; }, 8000);
  check(chip?.text === 'Agents · 1 running', `header chip counts this session's running agents: ${JSON.stringify(chip?.text)}`);

  const [startWidth, startHeight] = win.getContentSize();
  const stripUpdate = { state: 'live', replies: [{ id: 'agents-strip', markdown: STRIP_REPLY, prompt: '', timestamp: new Date().toISOString() }], sessionId: 'snapshot-fixture' };
  await js(`PastelTerm.reader.update({ ...${JSON.stringify(stripUpdate)}, tabId: PastelTerm.tabs.active().id })`);
  for (const [look] of READING_CHOICES) {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    for (const width of WIDTHS) {
      resizeOffscreen(win, width, 900);
      await waitFor(async () => (await js('window.innerWidth')) === width, 3000);
      await wait(200);
      const p = await js(CHIP_PROBE);
      check(p.shown && p.notes && p.strip && p.apart && p.inside && p.hit && p.notesHit, `${look} ${width}px chip, Notes toggle and strip all shown, chip clear of each, inside the column, both clickable: ${JSON.stringify(p)}`);
      if (width === 800) await capture(`agents-chip-${look}-800`);
    }
  }
  await js("window.pastel.look.setReading('newspaper')");
  await js('(() => { const tab = PastelTerm.tabs.active(); PastelTerm.reader.update({ ...tab.update, tabId: tab.id }); })()'); // back to the fixture's replies
  resizeOffscreen(win, 1280, 900);

  await js("document.getElementById('agents-chip').click()");
  const list = await waitFor(async () => { const rows = await js(LIST_PROBE); return rows.length === 2 ? rows : null; }, 5000);
  check(list?.[0]?.id === RUNNING_ID && list[0].status === 'running' && list[0].step === 'Running npm test' && list[0].task === 'Tidy the print styles' && list[0].meta.endsWith('2 tool calls'),
    `running agent first with its step: ${JSON.stringify(list?.[0])}`);
  check(list?.[1]?.id === FINISHED_ID && list[1].status === 'finished' && list[1].task === 'Check the header spacing', `finished agent second: ${JSON.stringify(list?.[1])}`);
  await unclippedCheck(kit, 'Agents list', '#agents');
  for (const id of ['paleSky', 'nightPastel']) {
    applyTheme(id, { persist: false });
    await capture(`agents-list-${id}`);
  }
  applyTheme('paleSky', { persist: false });

  await js(`document.querySelector('#agents .agents-row[data-agent-id="${RUNNING_ID}"]').click()`);
  const opened = await waitFor(async () => { const t = await js(TIMELINE_PROBE); return t.steps.length === 2 ? t : null; }, 5000);
  check(opened?.open === RUNNING_ID && opened.title === 'Tidy the print styles' && opened.promptCollapsed && opened.markdown, `clicking a row opens its timeline: ${JSON.stringify(opened)}`);
  check(opened?.steps.join() === 'Reading print.css ok,Running npm test ok', `steps as compact rows with result status: ${JSON.stringify(opened?.steps)}`);
  check(opened && !opened.injected && opened.outputMax <= 301 && opened.outputMax < HOSTILE_OUTPUT.length && opened.outputsCollapsed, `tool output cut short, collapsed, never HTML: ${JSON.stringify(opened)}`);
  await capture('agents-timeline-paleSky');

  // The page stamps the moment the row lands, so the 500ms waitFor poll doesn't blur the latency.
  await js(`window.__agentRowAt = 0; new MutationObserver((_m, o) => {
    if ([...document.querySelectorAll('#agents .agent-step-summary')].some((s) => s.textContent.startsWith('Editing print.css'))) { window.__agentRowAt = Date.now(); o.disconnect(); }
  }).observe(document.getElementById('agents'), { childList: true, subtree: true })`);
  const appendAt = Date.now();
  fs.appendFileSync(files.running, appendedStep());
  const rowAt = await waitFor(() => js('window.__agentRowAt'), 3000);
  const latency = rowAt ? rowAt - appendAt : null;
  check(latency !== null && latency <= 1000, `an appended line shows up within 1s: ${latency}ms`);
  fs.appendFileSync(files.running, appendedReport());
  const done = await waitFor(async () => { const t = await js(TIMELINE_PROBE); return t.report && t.meta?.startsWith('finished') ? t : null; }, 3000);
  check(done?.report?.includes('Print styles tidied.'), `final report shows when it finishes: ${JSON.stringify({ report: done?.report, meta: done?.meta })}`);
  applyTheme('nightPastel', { persist: false });
  await capture('agents-timeline-nightPastel');
  applyTheme('paleSky', { persist: false });

  const esc = "document.getElementById('agents').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))";
  await js(esc);
  const back = await waitFor(async () => { const rows = await js(LIST_PROBE); return rows.length === 2 && !(await js('PastelTerm.agentsView.openAgentId()')) ? rows : null; }, 3000);
  check(back?.[1]?.status === 'finished' && back[0]?.status === 'finished', `Esc goes back to the list, both finished now: ${JSON.stringify(back?.map((r: { status: string }) => r.status))}`);
  await js(esc);
  const closed = await waitFor(() => js("document.getElementById('agents').hidden && !document.getElementById('reader-head').hidden"), 3000);
  check(closed, 'Esc again closes the view back to the reader');

  // Sessions panel entry: another session's agent row opens its timeline.
  const root = path.join(path.dirname(dir), 'panel-agents');
  const otherId = 'a9a9a9a9-0000-4000-8000-00000000aa01';
  writeAgentsFixture(path.join(root, otherId));
  panelFixture.subagentsRoot = root;
  panelFixture.sessions = [{ pid: 0, sessionId: otherId, cwd: '/tmp/petal-fixture/agents', kind: 'interactive', status: 'busy', name: 'Agents elsewhere', updatedAt: Date.now() }];
  await js('PastelTerm.sessionsPanel.setOpen(true)');
  const row = `#sessions-panel .session-row[data-session-id="${otherId}"] .session-agent[data-agent-id="${RUNNING_ID}"]`;
  check(await waitFor(() => js(`Boolean(document.querySelector('${row}'))`), 5000), 'Sessions panel lists the other session\'s agent');
  await js(`document.querySelector('${row}').click()`);
  const fromPanel = await waitFor(async () => { const t = await js(TIMELINE_PROBE); return t.steps.length === 2 ? t : null; }, 5000);
  check(fromPanel?.open === RUNNING_ID && (await js("document.getElementById('sessions-panel').hidden")), `clicking it closes the panel and opens the timeline: ${JSON.stringify(fromPanel?.title)}`);
  await js('PastelTerm.overlays.hide("agents")');

  panelFixture.sessions = null;
  panelFixture.subagentsRoot = null;
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
  await js('PastelTerm.sessionsPanel.setOpen(false)');
  const gone = await waitFor(() => js("document.getElementById('agents-chip').hidden"), 8000);
  check(gone, 'the chip hides when the session has no agents today');
  resizeOffscreen(win, startWidth, startHeight);
}
