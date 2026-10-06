// Dev-only snapshot steps for History, the Outcome Flow and its Mermaid export.
const fs = require('node:fs');
const path = require('node:path');
const { stats } = require('./flow');
const flowStore = require('./flow-store');

const THEMES = ['paleSky', 'nightPastel'];

async function exportAndPreview(kit, containerSelector, name, theme) {
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
async function fixtureFlow(kit) {
  const { js, waitFor, log, themes, applyTheme, verifiedCapture, outDir } = kit;
  applyTheme('paleSky', { persist: false });
  const before = stats.extractions;
  await js("PastelTerm.reader.setView('flow')");
  const empty = await waitFor(() => js("Boolean(document.querySelector('#flow-view .flow-empty'))"), 10000);
  log(`${empty && stats.extractions === before ? 'ok' : 'FAIL'} no stored flow: empty state shown, jsonl extractions ${stats.extractions - before}`);
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: false, name: 'flow-empty-paleSky' });
  await js("document.querySelector('#flow-view .flow-empty .flow-button').click()");
  await waitFor(() => js("document.querySelectorAll('#flow-view .flow-step').length"), 100_000); // Haiku titling can take up to claude-cli's 90s
  const file = flowStore.fileFor('fixture');
  const stored = flowStore.load('fixture');
  log(`${stored ? 'ok' : 'FAIL'} created: ${file} exists=${fs.existsSync(file)} keys=${stored && Object.keys(stored).join(',')} steps=${stored?.steps.length} under ~/.claude=${file.includes('/.claude/')}`);
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
      log(`fixture .mmd written: ${file}; equals the stored mermaid: ${source === flowStore.load('fixture').mermaid.latest.source}`);
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
async function realSessionFlow(kit, sessionId) {
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
async function historyScreens(kit) {
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

module.exports = { fixtureFlow, realSessionFlow, historyScreens };

// Real resume round-trip on a throwaway session in a scratch folder (never her real sessions).
async function resumeRoundTrip(kit, { pty, feed, transcript }) {
  const { js, wait, waitFor, log, themes, verifiedCapture, outDir } = kit;
  // A new folder would need its trust prompt answered on her behalf, so the throwaway session runs in ~.
  const cwd = require('node:os').homedir();
  const exitClaude = async () => { pty.write('\x04'); await wait(400); pty.write('\x04'); };

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
    log(`${answer.confirm && !transcript().includes(`--resume ${other}`) ? 'ok' : 'FAIL'} live elsewhere asks first: ${JSON.stringify(answer)}`);
  }

  const before = transcript().length;
  await js(`PastelTerm.history.open().then(() => PastelTerm.history.select(${JSON.stringify(first.sessionId)}))`);
  await waitFor(() => js("Boolean(document.querySelector('.resume-button'))"), 10000);
  await js("document.querySelector('.resume-button').click()");
  const expected = `cd '${first.cwd}' && claude --resume ${first.sessionId}`;
  const typed = await waitFor(() => transcript().slice(before).includes(expected) || null, 10000);
  log(`${typed ? 'ok' : 'FAIL'} pty received exactly: ${expected}`);

  const resumed = await waitFor(() => feed.session, 40000);
  const history = await waitFor(async () => /pineapple/i.test(await js("document.getElementById('reader').innerText")) || null, 30000);
  log(`${resumed && history ? 'ok' : 'FAIL'} resumed session ${resumed?.sessionId} (original ${first.sessionId}); reader shows its history: ${Boolean(history)}`);

  const blocked = await js(`window.pastel.history.resume(${JSON.stringify(first.sessionId)})`);
  const typedTwice = (transcript().match(new RegExp(`--resume ${first.sessionId}`, 'g')) ?? []).length > 1;
  log(`${blocked.ok && blocked.focused === false && !typedTwice ? 'ok' : 'FAIL'} same session again just focuses this tab: ${JSON.stringify(blocked)} typedTwice=${typedTwice}`);
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: false, name: 'resume-after' });
  await exitClaude();
  await wait(3000);
}

module.exports.resumeRoundTrip = resumeRoundTrip;

// Click-to-open: a free tab resumes here, same session focuses, a busy tab opens a new tab.
// Uses only the two throwaway sessions earlier test runs left in ~.
async function openFromHistory(kit, { pty, feed, transcript, sessions, win }) {
  const { BrowserWindow } = require('electron');
  const { js, wait, waitFor, log, themes, verifiedCapture } = kit;
  const [first, second] = [process.env.PETAL_OPEN_A, process.env.PETAL_OPEN_B];
  const exitClaude = async (p) => { p.write('\x04'); await wait(400); p.write('\x04'); };

  const before = transcript().length;
  await js("PastelTerm.history.open()");
  await waitFor(() => js(`Boolean(document.querySelector('.history-row[data-session-id="${first}"]'))`), 10000);
  await js(`document.querySelector('.history-row[data-session-id="${first}"]').click()`);
  const typed = await waitFor(() => transcript().slice(before).includes(`claude --resume ${first}`) || null, 10000);
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

module.exports.openFromHistory = openFromHistory;

// Second launch on the same userData: the stored flow shows without parsing, then goes stale on new lines.
async function flowRelaunch(kit, { fixtureFile, realSessionId }) {
  const { js, wait, waitFor, log, themes, applyTheme, verifiedCapture } = kit;
  applyTheme('paleSky', { persist: false });
  const before = stats.extractions;
  await js("PastelTerm.reader.setView('flow')");
  const steps = await waitFor(() => js("document.querySelectorAll('#flow-view .flow-step').length || null"), 15000);
  log(`${steps && stats.extractions === before ? 'ok' : 'FAIL'} relaunch: stored flow rendered (${steps} cards), jsonl extractions ${stats.extractions - before}, stale note ${await js("Boolean(document.querySelector('#flow-view .flow-stale:not(:empty)'))")}`);
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: false, name: 'flow-relaunch-paleSky' });

  const line = (fields) => `${JSON.stringify({ isSidechain: false, timestamp: new Date().toISOString(), ...fields })}\n`;
  fs.appendFileSync(fixtureFile, line({ type: 'user', uuid: 'fixture-u9', message: { role: 'user', content: 'add a stored flow' } })
    + line({ type: 'assistant', uuid: 'fixture-a9', message: { role: 'assistant', content: [{ type: 'text', text: '**Flows are now stored.**\n\n**Done:** flows save to userData and load instantly' }] } }));
  const stale = await waitFor(() => js("document.querySelector('#flow-view .flow-stale')?.innerText.includes('continued') || null"), 15000);
  log(`${stale && stats.extractions === before ? 'ok' : 'FAIL'} after append: stale note shown, nothing auto-updated (extractions ${stats.extractions - before})`);
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: false, name: 'flow-stale-paleSky' });

  await js("document.querySelector('#flow-view .flow-stale .flow-button').click()");
  const updated = await waitFor(async () => {
    const state = await js("({ cards: document.querySelectorAll('#flow-view .flow-step').length, stale: Boolean(document.querySelector('#flow-view .flow-stale:not(:empty)')) })");
    return state.cards > steps && !state.stale ? state : null;
  }, 15000);
  log(`${updated ? 'ok' : 'FAIL'} update: ${JSON.stringify(updated)}; stored steps ${flowStore.load('fixture').steps.length}`);
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: false, name: 'flow-updated-paleSky' });
  await js("PastelTerm.reader.setView('replies')");

  await js('PastelTerm.history.open()');
  await wait(1500);
  const chips = await js("[...document.querySelectorAll('.history-row')].filter((r) => r.querySelector('.history-flow')).map((r) => r.dataset.sessionId)");
  log(`${chips.includes(realSessionId) ? 'ok' : 'FAIL'} history flow chips: ${JSON.stringify(chips)}`);
  await js(`document.querySelector('.history-row[data-session-id="${realSessionId}"]').scrollIntoView({ block: 'center' })`);
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: false, name: 'history-chip-paleSky' });
}

module.exports.flowRelaunch = flowRelaunch;

// Tabs: a second tab gets its own pty, xterm and reader feed; switching swaps all three. Shell only.
async function tabsCheck(kit, { win, feed, sessions, activeSession, openTab }) {
  const { js, wait, waitFor, log, themes, applyTheme, verifiedCapture } = kit;
  const contents = win.webContents;
  const check = (ok, what) => log(`${ok ? 'ok' : 'FAIL'} tabs: ${what}`);
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
  const waitState = (test, ms = 8000) => waitFor(async () => { const s = await state(); return test(s) ? s : null; }, ms);
  const bufferText = (id) => js(`(() => {
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

  feed.fakeStatus = 'busy'; // tab 1's claude goes busy while tab 2 is shown
  const dotted = await waitState((s) => s.busyDots.includes(first));
  check(dotted && !dotted.catBusy && !dotted.busyDots.includes(second), `busy dot on tab 1 only, pet idle on tab 2: ${JSON.stringify(dotted?.busyDots)} catBusy=${dotted?.catBusy}`);

  await js(`document.querySelector('#tab-strip .tab[data-tab-id="${first}"]').click()`);
  const back = await waitState((s) => s.active === first && s.latest && s.catBusy);
  check(back && back.shown.join() === first && mainActive() === first, `click on tab 1: reader back on the fixture reply, pet busy: ${JSON.stringify(back)} mainActive=${mainActive()}`);
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: false, name: 'tabs-first' });

  feed.fakeStatus = 'idle';
  contents.send('tabs:cycle', 1); // the ⌘⇧] path
  const cycled = await waitState((s) => s.active === second && !s.latest && !s.catBusy);
  check(cycled && cycled.shown.join() === second && mainActive() === second, `next tab: tab 2 shown, reader empty, pet idle: ${JSON.stringify(cycled)}`);
  await verifiedCapture({ ...kit, theme: themes.paleSky, panelOpen: false, name: 'tabs-second' });

  await js(`document.querySelector('#tab-strip .tab[data-tab-id="${second}"] .tab-close').click()`);
  const closed = await waitState((s) => s.ids.length === 1 && s.active === first && s.latest && ownTabs().length === 1);
  check(closed && !win.isDestroyed() && mainActive() === first, `× closed tab 2 and its pty, window stays on tab 1: ${JSON.stringify(closed)} ptys=${ownTabs().length}`);
}

module.exports.tabsCheck = tabsCheck;

// Reply box: Enter pastes into the active tab's pty; here the shell runs it, so its output proves delivery.
async function composerCheck(kit, { win, activeSession }) {
  const { js, waitFor, log } = kit;
  const session = activeSession(win.webContents.id);
  let output = '';
  const listener = session.pty.onData((data) => { output += data; });
  await js(`(() => { const box = document.getElementById('composer-input'); box.value = 'echo composer-ok-' + (6 * 7); box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
  const delivered = await waitFor(() => (/composer-ok-42/.test(output) ? true : null), 8000);
  const cleared = await js("document.getElementById('composer-input').value === ''");
  listener.dispose?.();
  log(`${delivered && cleared ? 'ok' : 'FAIL'} reply box sends to the active tab: delivered=${Boolean(delivered)} cleared=${cleared}`);
}
module.exports.composerCheck = composerCheck;

// Customize page: every section in light and dark, a Look change synced to the menu, and no hook runs.
async function customizeScreens(kit) {
  const { js, waitFor, log, wait, themes, applyTheme, verifiedCapture } = kit;
  const { Menu } = require('electron');
  const menuChecked = (label) => Menu.getApplicationMenu().items.flatMap((m) => m.submenu?.items ?? []).find((i) => i.label === label)?.checked;
  const sections = ['look', 'formatting', 'organizer', 'flowTitles', 'handoff', 'hook'];
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
  const responseHook = require('./response-hook');
  const hook = responseHook.stats();
  log(`${hook.runs === 0 && hook.skippedInSnapshot >= 1 ? 'ok' : 'FAIL'} reply-finished fired, response hook skipped in snapshot: ${JSON.stringify(hook)}`);
}
module.exports.customizeScreens = customizeScreens;
