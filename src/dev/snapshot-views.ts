// Dev-only snapshot steps for History, the Outcome Flow and its Mermaid export.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, Menu, type MenuItem } from 'electron';
import type { IPty } from 'node-pty';
import * as flowStore from '../main/flow-store';
import * as responseHook from '../main/response-hook';
import * as closedStore from '../main/closed-store';
import * as configStore from '../main/config-store';
import { counters, panelFixture, userDataDir } from '../main/snapshot-mode';
import { send } from '../main/ipc';
import { buildResumeCommand, resumeArgs } from '../main/resume-command';
import type { ReaderFeed } from '../main/reader-feed';
import { setFixtureStatus, type Kit, type TabsDeps } from './snapshot';
import type { TabSessions } from '../main/tab-session';
import type { Theme } from '../shared/types';

const THEMES = ['paleSky', 'nightPastel'];

const CLAUDE_DIR = path.join(os.homedir(), '.claude');

// The fixture jsonl is written and appended to; it must never land in her real Claude data.
export function assertFixtureOutsideClaude(file: string): void {
  const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const target = path.join(real(path.dirname(path.resolve(file))), path.basename(file));
  const claudeDir = real(CLAUDE_DIR);
  if (target === claudeDir || target.startsWith(`${claudeDir}${path.sep}`)) {
    throw new Error(`refusing to write the snapshot fixture under ~/.claude: ${file}`);
  }
}

async function exportAndPreview(kit: Kit, containerSelector: string, name: string, theme: Theme): Promise<string | null> {
  const { js, waitFor, wait, log, verifiedCapture } = kit;
  await wait(2000); // let the theme-switch re-render of the flow land first
  await js(`document.querySelector('${containerSelector} .flow-export .flow-button').click()`);
  const valid = await waitFor(() => js(`document.querySelector('${containerSelector} .flow-export').dataset.valid ?? null`), 20000);
  log(`${valid === 'true' ? 'ok' : 'FAIL'} ${name}: mermaid.parse on export = ${valid}; ${await js(`document.querySelector('${containerSelector} .flow-export-status').textContent`)}`);
  await js(`[...document.querySelectorAll('${containerSelector} .flow-export .flow-button')].find((b) => b.textContent === 'Preview').click()`);
  await waitFor(() => js(`Boolean(document.querySelector('${containerSelector} .flow-export-preview svg'))`), 20000);
  await wait(500);
  await verifiedCapture({ ...kit, theme, panelOpen: false, name, scrollTo: `${containerSelector} .flow-export-preview` });
  return js(`document.querySelector('${containerSelector} .flow-export').lastSource`);
}

// Flow for this window's (fixture) session, plus its exported chart.
export async function fixtureFlow(kit: Kit): Promise<void> {
  const { js, waitFor, log, themes, applyTheme, verifiedCapture, outDir } = kit;
  applyTheme('paleSky', { persist: false });
  const before = counters.flowExtractions;
  await js("PastelTerm.reader.setView('flow')");
  const empty = await waitFor(() => js("Boolean(document.querySelector('#flow-view .flow-empty'))"), 10000);
  log(`${empty && counters.flowExtractions === before ? 'ok' : 'FAIL'} no stored flow: empty state shown, jsonl extractions ${counters.flowExtractions - before}`);
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: false, name: 'flow-empty-paleSky' });
  await js("document.querySelector('#flow-view .flow-empty .flow-button').click()");
  await waitFor(() => js("document.querySelectorAll('#flow-view .flow-step').length"), 100_000); // Haiku titling can take up to claude-cli's 90s
  const file = flowStore.fileFor('fixture');
  const stored = flowStore.load('fixture');
  log(`${stored ? 'ok' : 'FAIL'} created: ${file} exists=${Boolean(file && fs.existsSync(file))} keys=${stored && Object.keys(stored).join(',')} steps=${stored?.steps.length} under ~/.claude=${file?.includes('/.claude/')}`);
  for (const id of THEMES) {
    applyTheme(id, { persist: false });
    await js("PastelTerm.reader.setView('flow')");
    await waitFor(() => js("document.querySelectorAll('#flow-view .flow-step').length"), 10000);
    const shape = await js(`({
      steps: document.querySelectorAll('#flow-view .flow-step').length,
      quietRows: [...document.querySelectorAll('#flow-view .flow-quiet')].map((b) => b.textContent),
      waiting: document.querySelectorAll('#flow-view .flow-step.waiting').length,
      files: [...document.querySelectorAll('#flow-view .flow-file')].map((f) => f.textContent),
      ledgerRows: document.querySelectorAll('#flow-view .flow-ledger-row').length,
      actors: [...document.querySelectorAll('#flow-view .flow-actor')].map((a) => a.className.split(' ')[1]),
      finalNext: document.querySelector('#flow-view .flow-final')?.innerText ?? null,
    })`);
    log(`fixture flow ${id}: ${JSON.stringify(shape)}`);
    await verifiedCapture({ ...kit, theme: themes[id], panelOpen: false, name: `flow-${id}` });
    const source = await exportAndPreview(kit, '#flow-view', `flow-export-${id}`, themes[id]);
    if (id === 'paleSky') {
      const file = path.join(outDir, 'fixture-flow.mmd');
      fs.writeFileSync(file, source ?? '');
      log(`fixture .mmd written: ${file}; equals the stored mermaid: ${source === flowStore.load('fixture')?.mermaid.latest.source}`);
    }
  }
  for (const id of THEMES) {
    applyTheme(id, { persist: false });
    await js("PastelTerm.reader.setView('decisions')");
    await waitFor(() => js("document.querySelectorAll('#decisions-view .decision').length"), 10000);
    const decisions = await js(`[...document.querySelectorAll('#decisions-view .decision')].map((d) => d.querySelector('.flow-actor').textContent + ' | ' + d.querySelector('.decision-what').textContent)`);
    log(`${decisions.length ? 'ok' : 'FAIL'} decisions ${id}: ${JSON.stringify(decisions)}`);
    await verifiedCapture({ ...kit, theme: themes[id], panelOpen: false, name: `decisions-${id}` });
  }
  // Click a step: it must land on that reply in Replies view.
  await js("document.querySelector('#flow-view .flow-step:last-of-type .flow-step-head').click()");
  log(`jump to reply: view=${await js('PastelTerm.reader.currentView()')} flashed=${await js("Boolean(document.querySelector('.flash'))")}`);
  await js("PastelTerm.reader.setView('replies')");
  applyTheme('paleSky', { persist: false });
}

// This real session, read-only: step count, flow screenshot, export validation.
export async function realSessionFlow(kit: Kit, sessionId: string | undefined): Promise<void> {
  const { js, waitFor, log, themes, applyTheme, verifiedCapture } = kit;
  if (!sessionId) return;
  await js(`PastelTerm.history.open().then(() => { PastelTerm.history.select(${JSON.stringify(sessionId)}); return PastelTerm.history.setPreviewMode('flow'); })`);
  await waitFor(() => js("Boolean(document.querySelector('#history-preview .flow-empty .flow-button'))"), 15000);
  await js("document.querySelector('#history-preview .flow-empty .flow-button').click()");
  await waitFor(() => js("document.querySelectorAll('#history-preview .flow-step').length"), 30000);
  log(`history chip after create: ${await js(`Boolean(document.querySelector('.history-row[data-session-id="${sessionId}"] .history-flow'))`)}`);
  const summary = await js(`(async () => {
    const target = { kind: 'history', sessionId: ${JSON.stringify(sessionId)} };
    const flow = await window.pastel.flow.get(target);
    const capped = await window.pastel.flow.mermaid(target, false);
    const full = await window.pastel.flow.mermaid(target, true);
    return {
      steps: flow?.steps.length ?? 0,
      quiet: flow?.steps.filter((s) => s.quiet).length ?? 0,
      withOutcomes: flow?.steps.filter((s) => s.outcomes.length).length ?? 0,
      auditRows: flow?.steps.reduce((n, s) => n + s.audit.length, 0) ?? 0,
      exportCapped: { exported: capped.exported, total: capped.total, valid: await PastelTerm.diagrams.validate(capped.source) },
      exportAll: { exported: full.exported, valid: await PastelTerm.diagrams.validate(full.source), lines: full.source.split('\\n').length },
    };
  })()`);
  log(`real session flow ${sessionId}: ${JSON.stringify(summary)}`);
  for (const id of THEMES) {
    applyTheme(id, { persist: false });
    await js(`PastelTerm.history.open().then(() => { PastelTerm.history.select(${JSON.stringify(sessionId)}); return PastelTerm.history.setPreviewMode('flow'); })`);
    await waitFor(() => js("document.querySelectorAll('#history-preview .flow-step').length"), 15000);
    await verifiedCapture({ ...kit, theme: themes[id], panelOpen: false, name: `real-flow-${id}` });
    if (id === 'paleSky') await exportAndPreview(kit, '#history-preview', `real-flow-export-${id}`, themes[id]);
  }
  await js("PastelTerm.history.setPreviewMode('replies'); PastelTerm.history.close()");
  applyTheme('paleSky', { persist: false });
}

// History list + preview, from real transcripts, read-only.
export async function historyScreens(kit: Kit): Promise<void> {
  const { js, waitFor, log, themes, applyTheme, verifiedCapture } = kit;
  for (const id of THEMES) {
    applyTheme(id, { persist: false });
    await js("PastelTerm.history.open().then(() => PastelTerm.history.setPreviewMode('replies'))");
    await waitFor(() => js("document.querySelectorAll('#history-preview .history-reply').length"), 15000);
    const shape = await js(`({
      rows: document.querySelectorAll('.history-row').length,
      days: [...document.querySelectorAll('.history-day')].map((d) => d.textContent),
      live: document.querySelectorAll('.history-live').length,
      previewReplies: document.querySelectorAll('#history-preview .history-reply').length,
    })`);
    log(`history ${id}: ${JSON.stringify(shape)}`);
    await verifiedCapture({ ...kit, theme: themes[id], panelOpen: false, name: `history-${id}` });
  }
  await js('PastelTerm.history.close()');
  applyTheme('paleSky', { persist: false });
}


// Real resume round-trip on a throwaway session in a scratch folder (never her real sessions).
export async function resumeRoundTrip(kit: Kit, { pty, feed, transcript }: { pty: IPty; feed: ReaderFeed; transcript: () => string }): Promise<void> {
  const { js, wait, waitFor, log, themes, verifiedCapture, outDir } = kit;
  // A new folder would need its trust prompt answered on her behalf, so the throwaway session runs in ~.
  const cwd = os.homedir();
  const exitClaude = async (): Promise<void> => { pty.write('\x04'); await wait(400); pty.write('\x04'); };

  pty.write(`cd '${cwd}' && claude\r`);
  await wait(7000);
  if (/Quick safety check/i.test(transcript().replace(/\s+/g, ' '))) {
    log('FAIL trust prompt shown; not answering it');
    return;
  }
  pty.write('reply with just the word pineapple');
  await wait(500);
  pty.write('\r');
  const first = await waitFor(() => feed.session, 40000);
  const replied = await waitFor(async () => /pineapple/i.test(await js("document.getElementById('latest').innerText")) || null, 60000);
  log(`${first && replied ? 'ok' : 'FAIL'} disposable session ${first?.sessionId} in ${first?.cwd}`);
  if (!first) {
    fs.writeFileSync(path.join(outDir, 'pty-transcript.log'), transcript());
    return;
  }
  await exitClaude();
  await waitFor(() => (!feed.claudePid ? true : null), 20000);
  pty.write('cd /tmp\r'); // resume must cd back itself
  await wait(1000);

  // A session live elsewhere must ask first, and write nothing.
  const other = await js("window.pastel.history.list().then(({ sessions }) => sessions.find((s) => s.live)?.sessionId ?? null)");
  if (other) {
    const answer = await js(`window.pastel.history.resume(${JSON.stringify(other)})`);
    log(`${answer.confirm && !transcript().includes(resumeArgs(other)) ? 'ok' : 'FAIL'} live elsewhere asks first: ${JSON.stringify(answer)}`);
  }

  const before = transcript().length;
  await js(`PastelTerm.history.open().then(() => PastelTerm.history.select(${JSON.stringify(first.sessionId)}))`);
  await waitFor(() => js("Boolean(document.querySelector('.resume-button'))"), 10000);
  await js("document.querySelector('.resume-button').click()");
  const expected = buildResumeCommand(first.cwd ?? '', first.sessionId).trimEnd();
  const typed = await waitFor(() => transcript().slice(before).includes(expected) || null, 10000);
  log(`${typed ? 'ok' : 'FAIL'} pty received exactly: ${expected}`);

  const resumed = await waitFor(() => feed.session, 40000);
  const history = await waitFor(async () => /pineapple/i.test(await js("document.getElementById('reader').innerText")) || null, 30000);
  log(`${resumed && history ? 'ok' : 'FAIL'} resumed session ${resumed?.sessionId} (original ${first.sessionId}); reader shows its history: ${Boolean(history)}`);

  const blocked = await js(`window.pastel.history.resume(${JSON.stringify(first.sessionId)})`);
  const typedTwice = transcript().split(resumeArgs(first.sessionId)).length - 1 > 1;
  log(`${blocked.ok && blocked.focused === false && !typedTwice ? 'ok' : 'FAIL'} same session again just focuses this tab: ${JSON.stringify(blocked)} typedTwice=${typedTwice}`);
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: false, name: 'resume-after' });
  await exitClaude();
  await wait(3000);
}


// Click-to-open: a free tab resumes here, same session focuses, a busy tab opens a new tab.
// Uses only the two throwaway sessions earlier test runs left in ~.
export async function openFromHistory(kit: Kit, { pty, feed, transcript, sessions, win }: { pty: IPty; feed: ReaderFeed; transcript: () => string; sessions: TabSessions; win: BrowserWindow }): Promise<void> {
  const { js, wait, waitFor, log, themes, verifiedCapture } = kit;
  const [first, second] = [process.env.PETAL_OPEN_A, process.env.PETAL_OPEN_B];
  const exitClaude = async (p: IPty): Promise<void> => { p.write('\x04'); await wait(400); p.write('\x04'); };

  const before = transcript().length;
  await js("PastelTerm.history.open()");
  await waitFor(() => js(`Boolean(document.querySelector('.history-row[data-session-id="${first}"]'))`), 10000);
  await js(`document.querySelector('.history-row[data-session-id="${first}"]').click()`);
  const typed = await waitFor(() => transcript().slice(before).includes(`claude ${resumeArgs(first ?? '')}`) || null, 10000);
  const resumed = await waitFor(() => (feed.session?.sessionId === first ? feed.session : null), 40000);
  log(`${typed && resumed ? 'ok' : 'FAIL'} row click on a free tab resumed here: typed=${Boolean(typed)} following=${feed.session?.sessionId}`);
  const focused = await js("document.activeElement?.classList.contains('xterm-helper-textarea') ?? false");
  log(`${focused ? 'ok' : 'FAIL'} keyboard focus back in the terminal after the click: ${focused}`);

  const again = await js(`window.pastel.history.resume(${JSON.stringify(first)})`);
  const ownTabs = () => [...sessions.values()].filter((s) => s.contentsId === win.webContents.id);
  log(`${again.ok && !again.newTab && ownTabs().length === 1 ? 'ok' : 'FAIL'} same session again focuses, no new tab: ${JSON.stringify(again)}`);

  const other = await js(`window.pastel.history.resume(${JSON.stringify(second)})`);
  const opened = await waitFor(() => (ownTabs().length === 2 && BrowserWindow.getAllWindows().length === 1 ? true : null), 10000);
  const follower = await waitFor(() => ownTabs().find((s) => s.feed.session?.sessionId === second) ?? null, 45000);
  log(`${other.newTab && opened && follower ? 'ok' : 'FAIL'} busy tab opened a new tab following ${second}: ${JSON.stringify(other)}`);
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: false, name: 'open-from-history' });

  if (follower) await exitClaude(follower.pty);
  await exitClaude(pty);
  await wait(3000);
}


// Second launch on the same userData: the stored flow shows without parsing, then goes stale on new lines.
export async function flowRelaunch(kit: Kit, { fixtureFile, realSessionId }: { fixtureFile: string; realSessionId: string }): Promise<void> {
  const { js, wait, waitFor, log, themes, applyTheme, verifiedCapture } = kit;
  applyTheme('paleSky', { persist: false });
  const before = counters.flowExtractions;
  await js("PastelTerm.reader.setView('flow')");
  const steps = await waitFor(() => js("document.querySelectorAll('#flow-view .flow-step').length || null"), 15000);
  log(`${steps && counters.flowExtractions === before ? 'ok' : 'FAIL'} relaunch: stored flow rendered (${steps} cards), jsonl extractions ${counters.flowExtractions - before}, stale note ${await js("Boolean(document.querySelector('#flow-view .flow-stale:not(:empty)'))")}`);
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: false, name: 'flow-relaunch-paleSky' });

  assertFixtureOutsideClaude(fixtureFile);
  const line = (fields: Record<string, unknown>) => `${JSON.stringify({ isSidechain: false, timestamp: new Date().toISOString(), ...fields })}\n`;
  fs.appendFileSync(fixtureFile, line({ type: 'user', uuid: 'fixture-u9', message: { role: 'user', content: 'add a stored flow' } })
    + line({ type: 'assistant', uuid: 'fixture-a9', message: { role: 'assistant', content: [{ type: 'text', text: '**Flows are now stored.**\n\n**Done:** flows save to userData and load instantly' }] } }));
  const stale = await waitFor(() => js("document.querySelector('#flow-view .flow-stale')?.innerText.includes('continued') || null"), 15000);
  log(`${stale && counters.flowExtractions === before ? 'ok' : 'FAIL'} after append: stale note shown, nothing auto-updated (extractions ${counters.flowExtractions - before})`);
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: false, name: 'flow-stale-paleSky' });

  await js("document.querySelector('#flow-view .flow-stale .flow-button').click()");
  const updated = await waitFor(async () => {
    const state = await js("({ cards: document.querySelectorAll('#flow-view .flow-step').length, stale: Boolean(document.querySelector('#flow-view .flow-stale:not(:empty)')) })");
    return state.cards > (steps ?? 0) && !state.stale ? state : null;
  }, 15000);
  log(`${updated ? 'ok' : 'FAIL'} update: ${JSON.stringify(updated)}; stored steps ${flowStore.load('fixture')?.steps.length}`);
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: false, name: 'flow-updated-paleSky' });
  await js("PastelTerm.reader.setView('replies')");

  await js('PastelTerm.history.open()');
  await wait(1500);
  const chips = await js("[...document.querySelectorAll('.history-row')].filter((r) => r.querySelector('.history-flow')).map((r) => r.dataset.sessionId)");
  log(`${chips.includes(realSessionId) ? 'ok' : 'FAIL'} history flow chips: ${JSON.stringify(chips)}`);
  await js(`document.querySelector('.history-row[data-session-id="${realSessionId}"]').scrollIntoView({ block: 'center' })`);
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: false, name: 'history-chip-paleSky' });
}


// Tabs: a second tab gets its own pty, xterm and reader feed; switching swaps all three. Shell only.
export async function tabsCheck(kit: Kit, { win, feed, sessions, activeSession, openTab }: TabsDeps & { win: BrowserWindow; feed: ReaderFeed }): Promise<void> {
  const { js, wait, waitFor, log, themes, applyTheme, verifiedCapture } = kit;
  const contents = win.webContents;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} tabs: ${what}`);
  const ownTabs = () => [...sessions.values()].filter((s) => s.contentsId === contents.id);
  const mainActive = () => activeSession(contents.id)?.tabId;
  const state = () => js(`(() => {
    const t = PastelTerm.tabs;
    return {
      ids: t.ids(),
      active: t.active()?.id,
      shown: t.ids().filter((id) => !t.get(id).host.hidden),
      labels: [...document.querySelectorAll('#tab-strip .tab-label')].map((e) => e.textContent),
      busyDots: [...document.querySelectorAll('#tab-strip .tab.busy')].map((e) => e.dataset.tabId),
      latest: document.getElementById('latest').innerText.trim().slice(0, 50),
      status: document.getElementById('reader-status').innerText,
      catBusy: document.getElementById('cat').classList.contains('busy'),
    };
  })()`);
  // any: the page state probe's shape is built in the script above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const waitState = (test: (s: any) => boolean, ms = 8000) => waitFor(async () => { const s = await state(); return test(s) ? s : null; }, ms);
  const bufferText = (id: string): Promise<string> => js(`(() => {
    const b = PastelTerm.tabs.get(${JSON.stringify(id)}).term.buffer.active;
    return Array.from({ length: b.length }, (_, i) => b.getLine(i).translateToString(true)).join('\\n');
  })()`);

  applyTheme('paleSky', { persist: false });
  await js("PastelTerm.reader.setView('replies')");
  const start = await state();
  const [first] = start.ids;
  check(start.ids.length === 1 && ownTabs().length === 1 && start.latest, `one tab at start, reader on the fixture: ${JSON.stringify(start)}`);

  openTab(contents); // the ⌘T path
  const opened = await waitState((s) => s.ids.length === 2 && ownTabs().length === 2 && !s.latest);
  const second = opened?.active;
  check(opened && second !== first && mainActive() === second && opened.shown.join() === second && /run claude/i.test(opened.status),
    `⌘T opened a second tab with its own pty, shown alone, reader on its empty feed: ${JSON.stringify(opened)} mainActive=${mainActive()}`);

  await wait(2500); // login shell rc files
  await js(`window.pastel.write(${JSON.stringify(second)}, 'echo tab2\\r')`);
  const echoed = await waitFor(async () => (/^tab2\s*$/m.test(await bufferText(second)) || null), 10000);
  const firstText = await bufferText(first);
  check(echoed && !firstText.includes('echo tab2') && firstText.includes('Petal render check'),
    `"echo tab2" printed in tab 2 only; tab 1 keeps its own output: tab2=${Boolean(echoed)} leakedIntoTab1=${firstText.includes('echo tab2')} tab1Sample=${firstText.includes('Petal render check')}`);

  setFixtureStatus(feed, 'busy'); // tab 1's claude goes busy while tab 2 is shown
  const dotted = await waitState((s) => s.busyDots.includes(first));
  check(dotted && !dotted.catBusy && !dotted.busyDots.includes(second), `busy dot on tab 1 only, pet idle on tab 2: ${JSON.stringify(dotted?.busyDots)} catBusy=${dotted?.catBusy}`);

  await js(`document.querySelector('#tab-strip .tab[data-tab-id="${first}"]').click()`);
  const back = await waitState((s) => s.active === first && s.latest && s.catBusy);
  check(back && back.shown.join() === first && mainActive() === first, `click on tab 1: reader back on the fixture reply, pet busy: ${JSON.stringify(back)} mainActive=${mainActive()}`);
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: false, name: 'tabs-first' });

  setFixtureStatus(feed, 'idle');
  send(contents, 'tabs:cycle', 1); // the ⌘⇧] path
  const cycled = await waitState((s) => s.active === second && !s.latest && !s.catBusy);
  check(cycled && cycled.shown.join() === second && mainActive() === second, `next tab: tab 2 shown, reader empty, pet idle: ${JSON.stringify(cycled)}`);
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: false, name: 'tabs-second' });

  await js(`document.querySelector('#tab-strip .tab[data-tab-id="${second}"] .tab-close').click()`);
  const closed = await waitState((s) => s.ids.length === 1 && s.active === first && s.latest && ownTabs().length === 1);
  check(closed && !win.isDestroyed() && mainActive() === first, `× closed tab 2 and its pty, window stays on tab 1: ${JSON.stringify(closed)} ptys=${ownTabs().length}`);
}


// Reply box: Enter pastes into the active tab's pty; here the shell runs it, so its output proves delivery.
// Only a tab whose Claude is live accepts a reply; ESC and other control characters never reach the pty.
export async function composerCheck(kit: Kit, { win, activeSession, openTab }: TabsDeps & { win: BrowserWindow }): Promise<void> {
  const { js, wait, waitFor, log } = kit;
  const session = activeSession(win.webContents.id);
  if (!session) throw new Error('composer check: no active tab');
  let output = '';
  const listener = session.pty.onData((data) => { output += data; });
  const type = (text: string) => js(`(() => { const box = document.getElementById('composer-input'); box.value = ${text}; box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
  await type("'echo composer-ok-' + (6 * 7)");
  const delivered = await waitFor(() => (/composer-ok-42/.test(output) ? true : null), 8000);
  const cleared = await js("document.getElementById('composer-input').value === ''");
  log(`${delivered && cleared ? 'ok' : 'FAIL'} reply box sends to the active tab: delivered=${Boolean(delivered)} cleared=${cleared}`);

  // With ESC kept, the shell would print "strip-" in red; stripped, it prints the literal "[31m".
  await type("'echo strip-' + String.fromCharCode(27) + '[31mok' + String.fromCharCode(7)");
  const stripped = await waitFor(() => (/strip-\[31mok/.test(output) ? true : null), 8000);
  log(`${stripped && !output.includes('strip-\x1b') ? 'ok' : 'FAIL'} reply box strips ESC and control characters before pasting: ${Boolean(stripped)}`);
  listener.dispose();

  // A fresh tab has no Claude: the reply stays in the box with a hint, and nothing is written.
  openTab(win.webContents);
  const fresh = await waitFor(() => {
    const next = activeSession(win.webContents.id);
    return next && next !== session ? next : null;
  }, 8000);
  if (!fresh) throw new Error('composer check: second tab never opened');
  let freshOutput = '';
  const freshListener = fresh.pty.onData((data) => { freshOutput += data; });
  await wait(2500); // login shell rc files
  await type("'echo gate-should-not-run'");
  await wait(1500);
  const gate = await js("({ hint: !document.getElementById('composer-hint').hidden, text: document.getElementById('composer-hint').textContent, kept: document.getElementById('composer-input').value })");
  freshListener.dispose();
  log(`${gate.hint && gate.kept === 'echo gate-should-not-run' && !freshOutput.includes('gate-should-not-run') ? 'ok' : 'FAIL'} reply box refuses a tab without live Claude: ${JSON.stringify(gate)} written=${freshOutput.includes('gate-should-not-run')}`);
  await js("document.getElementById('composer-input').value = ''");
  await js(`document.querySelector('#tab-strip .tab[data-tab-id="${fresh.tabId}"] .tab-close').click()`);
  await waitFor(() => (activeSession(win.webContents.id) === session ? true : null), 8000);
}

// Customize page: every section in light and dark, a Look change synced to the menu, and no hook runs.
export async function customizeScreens(kit: Kit): Promise<void> {
  const { js, waitFor, log, wait, themes, applyTheme, verifiedCapture } = kit;
  const menuChecked = (label: string) => Menu.getApplicationMenu()?.items.flatMap((m): MenuItem[] => m.submenu?.items ?? []).find((i) => i.label === label)?.checked;
  const sections = ['look', 'formatting', 'sessions', 'organizer', 'flowTitles', 'handoff', 'hook'];
  for (const id of THEMES) {
    applyTheme(id, { persist: false });
    await js("PastelTerm.customize.open('look')");
    for (const section of sections) {
      await js(`PastelTerm.customize.show(${JSON.stringify(section)}).then(() => { document.getElementById('customize').scrollTop = 0; })`);
      const shown = await waitFor(() => js(`document.querySelector('#customize-tabs [aria-selected="true"]')?.dataset.section === ${JSON.stringify(section)} && document.querySelectorAll('#customize-body .cz-card').length`), 5000);
      log(`${shown ? 'ok' : 'FAIL'} customize ${section} ${id}: ${shown} cards`);
      await verifiedCapture({ ...kit, theme: themes[id], panelOpen: false, name: `customize-${section}-${id}` });
    }
    await js("PastelTerm.customize.show('formatting')");
    await verifiedCapture({ ...kit, theme: themes[id], panelOpen: false, name: `customize-formatting-preview-${id}`, scrollTo: '.cz-preview' });
    await js('PastelTerm.customize.close()');
  }
  applyTheme('paleSky', { persist: false });

  // Reading chip -> applyReading: page, renderer and menu tick all agree, then back to newspaper.
  await js("PastelTerm.customize.open('look')");
  await js("[...document.querySelectorAll('.cz-chip')].find((c) => c.textContent === 'Magazine · Editorial').click()");
  const synced = await waitFor(async () => (await js('document.documentElement.dataset.reading')) === 'editorial' && menuChecked('Magazine · Editorial'), 5000);
  log(`${synced ? 'ok' : 'FAIL'} reading chip applies live and ticks the View menu: ${JSON.stringify({ reading: await js('document.documentElement.dataset.reading'), menu: menuChecked('Magazine · Editorial') })}`);
  await js("PastelTerm.customize.show('formatting').then(() => { document.getElementById('customize').scrollTop = 0; })");
  await wait(300);
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: false, name: 'customize-formatting-editorial-paleSky', scrollTo: '.cz-preview' });
  await js("PastelTerm.customize.show('look')");
  await js("[...document.querySelectorAll('.cz-chip')].find((c) => c.textContent === 'Newspaper').click()");
  await waitFor(async () => (await js('document.documentElement.dataset.reading')) === 'newspaper', 5000);

  // Esc on the page closes it and brings the reader back.
  await js("document.querySelector('#customize-tabs button').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  const closed = await js("({ customize: document.getElementById('customize').hidden, reader: !document.getElementById('reader').hidden })");
  log(`${closed.customize && closed.reader ? 'ok' : 'FAIL'} Esc closes Customize: ${JSON.stringify(closed)}`);

  // The fixture's busy -> idle flip (cat frames) fires reply-finished; the hook must count it and not run.
  const hook = responseHook.stats();
  log(`${hook.runs === 0 && hook.skippedInSnapshot >= 1 ? 'ok' : 'FAIL'} reply-finished fired, response hook skipped in snapshot: ${JSON.stringify(hook)}`);
}

// Overlay manager: History, Workflow and Customize replace each other; Esc closes the open one and brings back the reader and reply box.
export async function overlaysCheck(kit: Kit): Promise<void> {
  const { js, wait, log } = kit;
  const state = () => js(`(() => {
    const ids = ['history', 'workflow', 'customize'];
    return {
      shown: ids.filter((id) => !document.getElementById(id).hidden),
      pressed: ids.filter((id) => document.getElementById(id + '-button').getAttribute('aria-pressed') === 'true'),
      reader: !document.getElementById('reader').hidden,
      composer: getComputedStyle(document.getElementById('composer')).display !== 'none',
    };
  })()`);
  const only = (id: string, s: { shown: string[]; pressed: string[]; reader: boolean; composer: boolean }) =>
    s.shown.join() === id && s.pressed.join() === id && !s.reader && !s.composer;
  for (const [step, id] of [["document.getElementById('history-button').click()", 'history'], ["document.getElementById('customize-button').click()", 'customize'], ["document.getElementById('workflow-button').click()", 'workflow']]) {
    await js(step);
    await wait(400);
    const s = await state();
    log(`${only(id, s) ? 'ok' : 'FAIL'} overlays: ${id} open alone, reader and reply box hidden: ${JSON.stringify(s)}`);
  }
  await js("document.querySelector('#workflow-tabs button').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  const closed = await state();
  log(`${!closed.shown.length && !closed.pressed.length && closed.reader && closed.composer ? 'ok' : 'FAIL'} overlays: Esc closes Workflow, reader and reply box back: ${JSON.stringify(closed)}`);
}

// Invoke failures come back as { error } instead of rejecting; an unknown setting is a safe one to provoke (nothing is written).
export async function errorRepliesCheck(kit: Kit): Promise<void> {
  const { js, log } = kit;
  const reply = await js("window.pastel.config.reset('nope.nothing').then((r) => ({ resolved: true, r }), (e) => ({ resolved: false, r: String(e) }))");
  log(`${reply.resolved && /Unknown setting/.test(reply.r?.error ?? '') ? 'ok' : 'FAIL'} invoke failure resolves as { error }: ${JSON.stringify(reply)}`);
}

// Sessions panel Close / Recently closed / over-limit, on fixture sessions only. Close goes through sessions:close,
// which reads the real session files, finds none of these ids, and so never signals anything.
export async function sessionsCloseCheck(kit: Kit): Promise<void> {
  const { js, wait, waitFor, log, themes, applyTheme, verifiedCapture } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} sessions close: ${what}`);
  const userData = app.getPath('userData');
  if (userData !== userDataDir()) throw new Error(`sessions close check: userData is not the scratch dir (${userData})`);

  const fake = (n: number) => `f1f1f1f1-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const minutesAgo = (m: number) => Date.now() - m * 60_000;
  panelFixture.sessions = [
    { pid: 0, sessionId: fake(1), cwd: '/tmp/petal-fixture/reader', kind: 'interactive', status: 'busy', name: 'Reader polish', updatedAt: minutesAgo(1) },
    { pid: 0, sessionId: fake(2), cwd: '/tmp/petal-fixture/notes', kind: 'interactive', status: 'idle', name: 'Release notes', updatedAt: minutesAgo(40) },
    { pid: 0, sessionId: fake(3), cwd: '/tmp/petal-fixture/forecast', kind: 'interactive', status: 'idle', name: 'Forecast draft', updatedAt: minutesAgo(190) },
    { pid: 0, sessionId: fake(4), cwd: '/tmp/petal-fixture/api', kind: 'bg', status: 'busy', name: 'API sweep', updatedAt: minutesAgo(400) },
  ];
  configStore.save({ sessions: { maxOpen: 2 } });
  closedStore.add({ sessionId: fake(2), title: 'Release notes', cwd: '/tmp/petal-fixture/notes', closedAt: minutesAgo(90) }); // live again: hidden
  closedStore.add({ sessionId: fake(8), title: 'Tab labels', cwd: '/tmp/petal-fixture/tabs', closedAt: minutesAgo(30) });
  closedStore.add({ sessionId: fake(9), title: 'Scene matrix', cwd: '/tmp/petal-fixture/scenes', closedAt: minutesAgo(5) });

  await js('window.__confirms = 0; window.confirm = () => { window.__confirms += 1; return false; }; true');
  const panel = (code: string) => js(`PastelTerm.sessionsPanel.${code}`);
  const state = () => js(`(() => {
    const p = document.getElementById('sessions-panel');
    return {
      pill: document.getElementById('sessions-pill').innerText.replace(/\\s+/g, ' ').trim(),
      pillOver: document.getElementById('sessions-pill').classList.contains('over-limit'),
      rows: [...p.querySelectorAll('.session-row')].map((r) => r.dataset.sessionId),
      closeControls: p.querySelectorAll('.session-row > .session-close').length,
      closeInsideHead: p.querySelectorAll('.session-head .session-close, button button').length,
      confirm: [...p.querySelectorAll('.session-confirm')].map((c) => c.innerText.replace(/\\s+/g, ' ').trim()),
      banner: p.querySelector('.sessions-limit-text')?.textContent ?? null,
      oldestButton: Boolean(p.querySelector('.sessions-limit-close')),
      closedHeading: p.querySelector('.closed-heading')?.textContent ?? null,
      closed: [...p.querySelectorAll('.closed-row')].map((r) => r.dataset.sessionId),
      notes: [...p.querySelectorAll('.session-note')].map((n) => n.textContent),
      windowConfirms: window.__confirms,
    };
  })()`);
  // any: the probe's shape is built in the script above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const waitState = (test: (s: any) => boolean, ms = 6000) => waitFor(async () => { const s = await state(); return test(s) ? s : null; }, ms);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);

  await panel('expandedIds.clear()');
  await panel('setOpen(true)');
  const shown = await waitState((s) => s.rows.length === 4 && s.closed.length === 2);
  check(shown && shown.closeControls === 4 && shown.closeInsideHead === 0, `every row has its own Close beside the head, no nested buttons: ${JSON.stringify(shown)}`);
  check(shown && shown.pillOver && shown.pill.endsWith('4 open your limit is 2') && shown.banner === '4 open, your limit is 2' && shown.oldestButton,
    `over the limit: pill and banner say "4 open, your limit is 2", Close oldest idle offered: ${JSON.stringify({ pill: shown?.pill, banner: shown?.banner })}`);
  check(shown && shown.closedHeading === 'Recently closed' && shown.closed.join() === [fake(9), fake(8)].join(),
    `Recently closed lists the closed ones newest first, minus the one live again: ${JSON.stringify(shown?.closed)}`);

  await click(`.session-row[data-session-id="${fake(2)}"] > .session-close`);
  const asking = await waitState((s) => s.confirm.length === 1);
  check(asking && asking.confirm[0] === 'Close this Claude? Yes · No' && asking.windowConfirms === 0, `Close asks inline, not with window.confirm: ${JSON.stringify(asking?.confirm)} windowConfirms=${asking?.windowConfirms}`);
  await wait(2500); // a timer refresh must leave the open confirm in place
  check((await state()).confirm.length === 1, 'the inline confirm survives a timer refresh');
  for (const id of THEMES) {
    applyTheme(id, { persist: false });
    await verifiedCapture({ ...kit, theme: themes[id], panelOpen: true, name: `sessions-close-confirm-${id}` });
  }
  applyTheme('paleSky', { persist: false });
  await click('.session-confirm .session-no');
  const dismissed = await waitState((s) => s.confirm.length === 0);
  check(dismissed && dismissed.rows.length === 4, 'No dismisses the confirm and closes nothing');

  await click('.sessions-limit-close');
  const oldest = await waitState((s) => s.confirm.length === 1);
  check(oldest && oldest.confirm[0] === 'Close the oldest idle Claude, “Forecast draft”? Yes · No',
    `Close oldest idle picks the idle one updated longest ago, never a busy one: ${JSON.stringify(oldest?.confirm)}`);
  for (const id of THEMES) {
    applyTheme(id, { persist: false });
    await verifiedCapture({ ...kit, theme: themes[id], panelOpen: true, name: `sessions-limit-${id}` });
  }
  applyTheme('paleSky', { persist: false });

  // Yes: main looks the id up in the real session files, finds nothing, and refuses before any signal.
  await click('.sessions-limit .session-yes');
  const refused = await waitState((s) => s.notes.some((n: string) => /not running/.test(n)));
  check(refused, `Yes on a session that is not live is refused by main: ${JSON.stringify(refused?.notes)}`);

  await click(`.closed-row[data-session-id="${fake(9)}"] .closed-reopen`);
  const reopened = await waitState((s) => s.notes.some((n: string) => /no longer on disk/.test(n)));
  check(reopened, `Reopen goes through history:resume (fixture id has no transcript, so it says so): ${JSON.stringify(reopened?.notes)}`);
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: true, name: 'sessions-closed-paleSky', scrollTo: '.closed-heading' });

  configStore.save({ sessions: { maxOpen: 8 } });
  await panel('refresh()');
  const under = await waitState((s) => !s.pillOver && s.banner === null);
  check(under, `at or under the limit: no banner, plain pill: ${JSON.stringify(under?.pill)}`);

  panelFixture.sessions = null;
  await panel('setOpen(false)');
}
