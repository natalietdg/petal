// Get started and the folder question, on fixture state only: a stand-in ~/.claude with a sentinel, a faked install check,
// and the first tab's fixture swapped for an empty log, so each step ticks when the harness makes it true.
import fs from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import * as configStore from '../main/config-store';
import * as organizer from '../main/session-organizer';
import { claudeFixture, claudeStarts, folderFixture, historyFixture, ptyWrites } from '../main/snapshot-mode';
import { harnessLine } from '../main/snapshot-shell';
import { resizeOffscreen } from '../main/snapshot-window';
import { send } from '../main/ipc';
import { READING_CHOICES } from '../main/menu';
import type { ActiveSession } from '../main/tab-session';
import type { Kit } from './snapshot';

const INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash'; // code.claude.com/docs/en/setup
const NARROW = 800;
const STEP_IDS = ['install', 'add-session', 'sign-in', 'ask'];
const SENTINEL_SESSION = 'bbbbbbbb-0000-4000-8000-000000000001';

// An install from before the folder question: every section she has touched, welcome seen, no claudeFolder or getStarted.
const EXISTING_CONFIG = {
  organizer: { enabled: false, intervalMinutes: 10, perPass: 12, model: 'haiku' }, // off: a schedule here would fail the run's organizer-off check
  flowTitles: {},
  responseHook: { command: '', notify: false },
  sessions: { maxOpen: 8 },
  tarot: { birthdate: '1990-01-01' },
  welcome: { seen: true },
  notesPanel: { open: 'closed', width: 520 },
  layout: { splits: { 0: 0.85 } },
  history: { listCollapsed: false, favorites: [] },
  pet: { size: 'normal' },
};

const STATE = `(() => {
  const open = PastelTerm.overlays.current();
  const view = document.getElementById('get-started');
  const list = view.querySelector('.gs-list');
  const steps = [...(list?.querySelectorAll('.gs-step') ?? [])].map((li) => ({ id: li.dataset.step, done: li.classList.contains('done'), badge: li.querySelector('.step-badge')?.textContent }));
  const status = document.getElementById('reader-status');
  return {
    open,
    steps,
    allSet: Boolean(list?.classList.contains('all-set')),
    allSetLine: list?.querySelector('.gs-all-set')?.textContent ?? null,
    command: list?.querySelector('.gs-command code')?.textContent ?? null,
    copy: list?.querySelector('.gs-copy')?.dataset.copy ?? null,
    checks: [...(list?.querySelectorAll('.step-check') ?? [])].map((p) => p.textContent),
    privateLine: list?.querySelector('.gs-private')?.textContent ?? null,
    status: status.innerText,
    statusAction: status.querySelector('.status-action')?.textContent ?? null,
    tabs: PastelTerm.tabs.ids(),
    active: PastelTerm.tabs.active()?.id ?? null,
    emDashes: (view.innerText.match(/—/g) ?? []).length,
  };
})()`;

const CONSENT = `(() => {
  const view = document.getElementById('consent');
  return {
    shown: !view.hidden,
    title: view.querySelector('.welcome-title')?.textContent ?? null,
    reads: [...view.querySelectorAll('.consent-reads li')].map((li) => li.textContent),
    text: view.innerText,
    buttons: [...view.querySelectorAll('footer button')].map((b) => b.textContent),
    emDashes: (view.innerText.match(/—/g) ?? []).length,
  };
})()`;

// Nothing in the open view sticks out sideways, at this window width.
const OVERFLOW = `(() => {
  const view = document.getElementById(PastelTerm.overlays.current());
  const pane = view.querySelector('.welcome-pane');
  const box = pane.getBoundingClientRect();
  const wide = [...pane.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1); });
  const code = pane.querySelector('.gs-command code');
  return {
    width: window.innerWidth,
    paneScroll: pane.scrollWidth - pane.clientWidth,
    pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    sticking: wide.slice(0, 4).map((e) => e.className || e.tagName),
    codeScrollsInside: code ? code.scrollWidth >= code.clientWidth : null,
  };
})()`;

const bufferText = (id: string): string => `(() => {
  const b = PastelTerm.tabs.get(${JSON.stringify(id)}).term.buffer.active;
  return Array.from({ length: b.length }, (_, i) => b.getLine(i).translateToString(true)).join('\\n');
})()`;

// A stand-in ~/.claude a reader would open: a live session file, a log, settings, a style, CLAUDE.md.
function sentinelHome(root: string): string {
  const home = path.join(root, 'fake-claude-home');
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, 'projects', '-tmp-petal-sentinel'), { recursive: true });
  fs.mkdirSync(path.join(home, 'output-styles'), { recursive: true });
  fs.writeFileSync(path.join(home, 'sessions', `${process.pid}.json`), JSON.stringify({ sessionId: SENTINEL_SESSION, cwd: '/tmp/petal-sentinel', kind: 'interactive', status: 'idle' }));
  fs.writeFileSync(path.join(home, 'projects', '-tmp-petal-sentinel', `${SENTINEL_SESSION}.jsonl`), `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'SENTINEL prompt' }, cwd: '/tmp/petal-sentinel' })}\n`);
  fs.writeFileSync(path.join(home, 'settings.json'), '{"outputStyle":"sentinel"}');
  fs.writeFileSync(path.join(home, 'output-styles', 'sentinel.md'), '---\nname: sentinel\n---\nSENTINEL\n');
  fs.writeFileSync(path.join(home, 'CLAUDE.md'), '# SENTINEL\n');
  return home;
}

// Records every fs call into the stand-in folder from the main process, where every reader runs.
function watchReads(home: string): { seen: string[]; stop: () => void } {
  const seen: string[] = [];
  const restore: (() => void)[] = [];
  const wrap = (target: Record<string, unknown>, name: string, label: string) => {
    const real = target[name];
    if (typeof real !== 'function') return;
    target[name] = function (this: unknown, ...args: unknown[]) {
      if (String(args[0]).startsWith(home)) seen.push(`${label} ${String(args[0]).slice(home.length)}`);
      return (real as (...a: unknown[]) => unknown).apply(this, args);
    };
    restore.push(() => { target[name] = real; });
  };
  const sync = fs as unknown as Record<string, unknown>;
  for (const name of ['readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'existsSync', 'openSync', 'watch', 'createReadStream', 'readFile', 'readdir', 'stat']) wrap(sync, name, name);
  const promises = fs.promises as unknown as Record<string, unknown>;
  for (const name of ['readFile', 'readdir', 'stat', 'open']) wrap(promises, name, `promises.${name}`);
  return { seen, stop: () => restore.forEach((undo) => undo()) };
}

const assistantLine = (text: string) => `${JSON.stringify({ type: 'assistant', uuid: `gs-${Date.now()}`, timestamp: new Date().toISOString(), isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text }] } })}\n`;
const userLine = (text: string) => `${JSON.stringify({ type: 'user', uuid: `gs-u-${Date.now()}`, timestamp: new Date().toISOString(), isSidechain: false, message: { role: 'user', content: text } })}\n`;

export async function getStartedCheck(kit: Kit, { win, activeSession }: { win: BrowserWindow; activeSession: ActiveSession }): Promise<void> {
  const { js, log, wait, waitFor, capture, themes, applyTheme, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} get started: ${what}`);
  // any: the probes' shapes are built in the scripts above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const until = (test: (s: any) => boolean, ms = 8000) => waitFor(async () => { const s = await js(STATE); return test(s) ? s : null; }, ms);
  const doneIds = (s: { steps: { id: string; done: boolean }[] }) => s.steps.filter((x) => x.done).map((x) => x.id).join();
  const [startWidth, startHeight] = win.getContentSize();
  const first = activeSession(win.webContents.id);
  const fixture = first?.feed.fixture;
  if (!first || !fixture) throw new Error('get started: the first tab has no fixture');
  const saved = { transcript: fixture.transcript, sessionId: fixture.sessionId, history: historyFixture.records.splice(0) }; // no past sessions: a fresh install

  // Fixture state: the stand-in folder, Claude Code missing, an empty log behind the first tab, a fresh install's config.
  const home = sentinelHome(outDir);
  folderFixture.home = home;
  claudeFixture.installed = false;
  const log1 = path.join(outDir, 'get-started-log.jsonl');
  fs.writeFileSync(log1, '');
  fixture.transcript = log1;
  fixture.sessionId = 'cccccccc-0000-4000-8000-000000000001';
  configStore.save({ claudeFolder: { choice: 'unasked' }, getStarted: { done: [] }, welcome: { seen: false } });
  await js('PastelTerm.overlays.hideCurrent()');
  await js('PastelTerm.getStarted.load()');

  // 1. The folder question comes first on a fresh install.
  await js('PastelTerm.launchScreens.show()');
  const consent = await waitFor(async () => { const c = await js(CONSENT); return c.shown ? c : null; }, 5000);
  check(consent && consent.title === 'Read your Claude folder?' && consent.buttons.join() === 'Allow,Not now' && consent.reads.length === 7
    && /stays on this Mac\. Nothing is uploaded\./.test(consent.text) && /What Petal writes in ~\/\.claude, only when you ask/i.test(consent.text) && /CLAUDE\.md: a lesson/.test(consent.text) && consent.emDashes === 0,
    `fresh state shows "Read your Claude folder?" with what it reads, Allow and Not now: ${JSON.stringify(consent)}`);
  for (const [id, look] of [['paleSky', 'light'], ['nightPastel', 'dark']]) {
    applyTheme(id, { persist: false });
    await wait(500);
    await capture(`get-started-consent-${look}`);
  }
  applyTheme('paleSky', { persist: false });

  // 2. Not now: nothing under the folder is opened, by any reader, while the terminal still works.
  const probe = watchReads(home);
  await js("document.querySelector('#consent .consent-later').click()");
  const checklistUp = await until((s) => s.open === 'get-started', 6000);
  check(checklistUp && configStore.load().claudeFolder.choice === 'declined', `Not now saves "declined" and Get started follows: ${JSON.stringify({ open: checklistUp?.open, choice: configStore.load().claudeFolder.choice })}`);
  const readers = await js(`(async () => ({
    history: (await window.pastel.history.list()),
    setup: (await window.pastel.workflow.setup()),
    styles: (await window.pastel.config.get()).outputStyles,
    panel: (await window.pastel.getSessions({ detailed: true, expandedIds: [] })),
    agents: (await window.pastel.agents.list(null)),
  }))()`);
  await js('PastelTerm.history.open()');
  await wait(3000); // several reader ticks
  await js('PastelTerm.history.close()');
  await js('PastelTerm.getStarted.open()'); // History took its place
  const historyRows = JSON.stringify(readers.history).includes('SENTINEL');
  check(probe.seen.length === 0, `Not now: no reader opened anything in the stand-in ~/.claude: ${JSON.stringify(probe.seen.slice(0, 6))}`);
  check(!historyRows && !readers.setup?.hasClaudeMd && !(readers.styles?.styles?.length) && /isn’t reading your Claude folder/.test(readers.styles?.problem ?? ''),
    `Not now: History, Setup and output styles come back empty: ${JSON.stringify({ historyRows, setup: readers.setup?.hasClaudeMd, styles: readers.styles })}`);
  // Her keys still reach main (recorded, never typed in snapshot runs), and the shell still runs the harness's own line.
  const writesBefore = ptyWrites.length;
  await js("window.pastel.write(PastelTerm.tabs.active().id, 'petal-gs-keys')");
  const keysIn = await waitFor(() => ptyWrites.slice(writesBefore).find((w) => w.data === 'petal-gs-keys') ?? null, 5000);
  activeSession(win.webContents.id)?.pty.write(harnessLine('echo gs-term-ok'));
  const firstId = (await js(STATE)).tabs[0];
  const echoed = await waitFor(async () => (/^gs-term-ok\s*$/m.test(await js(bufferText(firstId))) || null), 8000);
  check(keysIn && echoed, `Not now: the terminal still takes keys and runs commands: keys=${Boolean(keysIn)} ran=${Boolean(echoed)}`);
  const blocked = await js(STATE);
  check(/isn’t reading your Claude folder/.test(blocked.status) && blocked.statusAction === 'Allow reading your Claude folder',
    `Not now: the reader says so and offers Allow: ${JSON.stringify([blocked.status, blocked.statusAction])}`);

  // 3. Add Session with Claude Code missing: a plain shell, nothing typed, the checklist stays up.
  const startsBefore = claudeStarts.length;
  await js("document.getElementById('add-session-button').click()");
  const plain = await until((s) => s.tabs.length === 2);
  await wait(2500);
  const plainId = plain?.tabs[1];
  check(plainId && claudeStarts.length === startsBefore && !(await js(bufferText(plainId))).includes('petal-start-claude') && plain.open === 'get-started',
    `Add Session without Claude Code types nothing and the checklist stays: ${JSON.stringify({ tabs: plain?.tabs, starts: claudeStarts.length - startsBefore, open: plain?.open })}`);
  if (plainId) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(plainId)})`);
  await until((s) => s.tabs.length === 1);
  configStore.save({ getStarted: { done: [] } }); // the extra tab ticked Add Session; a fresh install hasn't
  await js('PastelTerm.getStarted.load()');
  await js('PastelTerm.getStarted.open()');

  // 4. Fresh: step 1 open with the install command and Copy, nothing ticked.
  const fresh = await until((s) => s.open === 'get-started' && s.steps.length === 4);
  check(fresh && fresh.steps.map((s: { id: string }) => s.id).join() === STEP_IDS.join() && doneIds(fresh) === '' && fresh.command === INSTALL_COMMAND && fresh.copy === INSTALL_COMMAND,
    `fresh install: four steps, none ticked, step 1 shows the install command with Copy: ${JSON.stringify(fresh)}`);
  check(fresh && /Petal never sees your login/.test(fresh.privateLine ?? '') && fresh.checks.length === 0 && fresh.emDashes === 0,
    `steps have no Check lines and say Petal never sees the login: ${JSON.stringify({ privateLine: fresh?.privateLine, checks: fresh?.checks })}`);
  const bottom = await js(`(() => {
    const view = document.getElementById('get-started');
    const pane = view.querySelector('.welcome-pane');
    pane.scrollTop = pane.scrollHeight;
    const last = [...pane.querySelectorAll('.gs-step')].at(-1).getBoundingClientRect();
    const r = { gap: Math.round(view.querySelector('footer').getBoundingClientRect().top - last.bottom), intro: view.querySelector('.welcome-line').textContent };
    pane.scrollTop = 0;
    return r;
  })()`);
  check(bottom.gap >= 16 && bottom.intro === 'Four steps to your first reply.', `one-line intro; scrolled down, the last step clears the footer: ${JSON.stringify(bottom)}`);
  // History's Send is drawn off-screen here: it must match the reader's Send; Close is the quiet outline.
  const looks = await js(`(() => {
    const look = (b) => { const s = getComputedStyle(b); return [s.backgroundColor, s.color, s.borderRadius, s.fontWeight].join(' '); };
    const probe = document.createElement('button');
    probe.className = 'send-button history-reply-send';
    document.body.append(probe);
    const r = { reader: look(document.getElementById('composer-send')), history: look(probe), close: getComputedStyle(document.querySelector('#get-started .gs-close')).backgroundColor };
    probe.remove();
    return r;
  })()`);
  check(looks.reader === looks.history && looks.close === 'rgba(0, 0, 0, 0)', `one Send style in the reader and History; Close is quiet: ${JSON.stringify(looks)}`);
  for (const id of Object.keys(themes)) {
    applyTheme(id, { persist: false });
    await wait(450);
    await capture(`get-started-fresh-${id}`);
  }
  applyTheme('paleSky', { persist: false });
  for (const [reading] of READING_CHOICES) {
    await js(`document.documentElement.dataset.reading = ${JSON.stringify(reading)}`);
    await wait(300);
    await capture(`get-started-fresh-reading-${reading}`);
  }
  await js("document.documentElement.dataset.reading = 'newspaper'");
  resizeOffscreen(win, NARROW, 900);
  await wait(700);
  const narrowFresh = await js(OVERFLOW);
  check(narrowFresh.width <= NARROW && narrowFresh.paneScroll <= 0 && narrowFresh.pageScroll <= 0 && narrowFresh.sticking.length === 0,
    `no overflow at ${NARROW}px with the install command showing: ${JSON.stringify(narrowFresh)}`);
  await capture('get-started-fresh-800');
  resizeOffscreen(win, startWidth, startHeight);
  await wait(500);

  // 5. Claude Code found: Check again ticks step 1.
  claudeFixture.installed = true;
  await js("document.querySelector('#get-started .gs-recheck').click()");
  const found = await until((s) => s.steps[0]?.done === true);
  check(found && doneIds(found) === 'install' && found.command === null, `Check again with Claude Code installed ticks step 1 only: ${JSON.stringify(found && { done: doneIds(found), command: found.command })}`);
  await capture('get-started-claude-found');

  // 6. Allow from the reader: the first tab's fixture session is read, so Add Session and sign-in tick.
  fs.rmSync(path.join(home, 'projects'), { recursive: true, force: true }); // a fresh install has no past conversations
  await js('PastelTerm.getStarted.close()');
  await js("document.querySelector('#reader-status .status-action').click()");
  const allowed = await waitFor(() => (configStore.load().claudeFolder.choice === 'allowed' ? true : null), 5000);
  const session = await waitFor(async () => {
    await js('PastelTerm.getStarted.refresh()');
    const tab = await js('(() => { const u = PastelTerm.tabs.get(PastelTerm.tabs.ids()[0]).update; return u && { state: u.state, sessionId: u.sessionId, replies: u.replies.length }; })()');
    return tab?.sessionId ? tab : null;
  }, 8000);
  check(allowed && session?.state === 'live' && session.replies === 0, `Allow from the reader turns reading on; the fixture tab has a session and no reply yet: ${JSON.stringify(session)}`);

  // Add Session with Claude Code installed: `claude` is sent to the new tab's shell (a no-op stands in for it here).
  await js("document.getElementById('add-session-button').click()");
  const second = await until((s) => s.tabs.length === 2);
  const secondId = second?.tabs[1];
  const typed = await waitFor(() => claudeStarts.find((s) => s.tabId === secondId) ?? null, 8000);
  const shown = secondId ? await waitFor(async () => ((await js(bufferText(secondId))).includes('petal-start-claude') || null), 8000) : null;
  check(typed?.command === 'claude\r' && shown, `Add Session types claude into the new tab once its shell is ready: ${JSON.stringify({ typed, shown: Boolean(shown) })}`);
  const hint = await until((s) => s.active === secondId && /Start here/.test(s.status));
  check(hint && /No conversation yet\. Start here: click Add Session, and Claude starts in the new tab\./.test(hint.status) && hint.statusAction === 'Get started',
    `empty reader with no Claude points to the checklist: ${JSON.stringify(hint && [hint.status, hint.statusAction])}`);
  for (const [id, look] of [['paleSky', 'light'], ['nightPastel', 'dark']]) {
    applyTheme(id, { persist: false });
    await wait(450);
    await capture(`get-started-empty-hint-${look}`);
  }
  applyTheme('paleSky', { persist: false });
  await js("document.querySelector('#reader-status .status-action').click()");
  const midway = await until((s) => s.open === 'get-started' && s.steps.length === 4);
  check(midway && doneIds(midway) === 'install,add-session,sign-in', `a tab with a Claude session ticks Add Session and sign-in, not Ask: ${JSON.stringify(midway && doneIds(midway))}`);
  await capture('get-started-session');

  // 7. A reply arrives: the last step ticks and the checklist folds to "You're all set".
  fs.appendFileSync(log1, userLine('what is petal?') + assistantLine('**Petal is a terminal for Claude Code.**'));
  const allSet = await until((s) => s.allSet, 10000);
  check(allSet && allSet.steps.length === 0 && allSet.allSetLine?.startsWith('You’re all set'), `a reply ticks the last step and the checklist collapses to all set: ${JSON.stringify(allSet && { allSet: allSet.allSet, line: allSet.allSetLine })}`);
  const savedDone = configStore.load().getStarted.done.join();
  check(savedDone === 'add-session,sign-in,ask', `progress is saved in Petal's config (install is rechecked each launch): ${savedDone}`);
  for (const id of Object.keys(themes)) {
    applyTheme(id, { persist: false });
    await wait(450);
    await capture(`get-started-all-set-${id}`);
  }
  applyTheme('paleSky', { persist: false });
  resizeOffscreen(win, NARROW, 900);
  await wait(700);
  const narrowDone = await js(OVERFLOW);
  check(narrowDone.paneScroll <= 0 && narrowDone.pageScroll <= 0 && narrowDone.sticking.length === 0, `no overflow at ${NARROW}px when all set: ${JSON.stringify(narrowDone)}`);
  await capture('get-started-all-set-800');
  resizeOffscreen(win, startWidth, startHeight);
  await wait(500);

  // 8. Done means it stops showing on launch.
  await js('PastelTerm.overlays.hideCurrent()');
  configStore.save({ welcome: { seen: true } });
  const relaunch = await js('PastelTerm.launchScreens.show()');
  await wait(400);
  check(relaunch === false && (await js('PastelTerm.overlays.current()')) === null, `all done: nothing opens on launch: ${JSON.stringify(relaunch)}`);

  // 9. Reopen from Customize, and from Help.
  await js("PastelTerm.customize.open('start')");
  await waitFor(() => js("document.querySelector('#customize-body .cz-open-get-started') ? true : null"), 5000);
  await capture('get-started-customize');
  await js("document.querySelector('#customize-body .cz-open-get-started').click()");
  const reopened = await until((s) => s.open === 'get-started' && s.allSet);
  check(reopened, 'Customize › Get started › Open Get started reopens it, all set');
  await js("document.querySelector('#get-started .gs-show-steps').click()");
  const expanded = await until((s) => s.steps.length === 4 && s.steps.every((x: { done: boolean }) => x.done));
  check(expanded, 'Show the steps lists all four, ticked');
  await js('PastelTerm.overlays.hideCurrent()');
  send(win.webContents, 'get-started:open'); // what Customize › Get started's button does
  check(await until((s) => s.open === 'get-started'), 'Customize › Get started reopens it');
  await js('PastelTerm.overlays.hideCurrent()');

  // 10. The Customize switch revokes and restores reading.
  const firstTab = `(() => { const u = PastelTerm.tabs.get(PastelTerm.tabs.ids()[0]).update; return u ? u.replies.length : -1; })()`;
  await js("PastelTerm.customize.open('start')");
  await waitFor(() => js("document.querySelector('#customize-body .cz-folder-switch input') ? true : null"), 5000);
  const toggle = "(() => { const box = document.querySelector('#customize-body .cz-folder-switch input'); box.checked = !box.checked; box.dispatchEvent(new Event('change')); return box.checked; })()";
  const off = await js(toggle);
  const revoked = await waitFor(async () => (configStore.load().claudeFolder.choice === 'declined' && (await js(firstTab)) === 0 ? true : null), 8000);
  check(off === false && revoked, `Customize switch off: "declined" saved and the reader drops what it read: ${JSON.stringify({ off, replies: await js(firstTab) })}`);
  const on = await js(toggle);
  const restored = await waitFor(async () => (configStore.load().claudeFolder.choice === 'allowed' && (await js(firstTab)) > 0 ? true : null), 8000);
  check(on === true && restored, `Customize switch on: "allowed" saved and the reply is back: ${JSON.stringify({ on, replies: await js(firstTab) })}`);
  probe.stop();
  check(probe.seen.length > 0, `the read probe sees reads once allowed, so its zero above means something: ${probe.seen.length} reads`);
  await js('PastelTerm.customize.close()');

  // 11. An existing 1.0.0 install: a config.json, past conversations, never asked. The question comes first;
  // after Allow, History shows she has done it all, so Get started is all set before it would draw and never opens.
  await js('PastelTerm.overlays.hideCurrent()');
  const pastDir = path.join(home, 'projects', '-tmp-petal-past');
  fs.mkdirSync(pastDir, { recursive: true });
  fs.writeFileSync(path.join(pastDir, 'dddddddd-0000-4000-8000-000000000001.jsonl'), userLine('an older question') + assistantLine('An older answer.'));
  configStore.save({ claudeFolder: { choice: 'unasked' }, getStarted: { done: [] }, welcome: { seen: true } });
  const waiting = await waitFor(async () => { const s = await js(STATE); return s.statusAction === 'Allow reading your Claude folder' ? s : null; }, 8000);
  check(waiting, `existing install, not yet answered: the reader offers Allow while the terminal keeps running: ${JSON.stringify(waiting?.status)}`);
  await js(`(() => { const view = document.getElementById('get-started'); window.__gsFlash = false;
    new MutationObserver(() => { if (!view.hidden) window.__gsFlash = true; }).observe(view, { attributes: true }); })()`);
  const shownOnLaunch = await js('PastelTerm.launchScreens.show()');
  const asked = await waitFor(async () => { const c = await js(CONSENT); return c.shown ? c : null; }, 5000);
  check(shownOnLaunch && asked, 'existing install: the folder question shows on launch');
  await capture('get-started-existing-consent');
  await js("document.querySelector('#consent .consent-allow').click()");
  const autoDone = await waitFor(() => (configStore.load().getStarted.done.join() === 'add-session,sign-in,ask' ? true : null), 8000);
  await wait(1000);
  const flashed = await js('window.__gsFlash');
  const seen = await js('PastelTerm.getStarted.currentFacts()');
  check(seen.pastSessions === true, `existing install: History's past conversation is what Get started reads: ${JSON.stringify(seen)}`);
  check(autoDone && configStore.load().claudeFolder.choice === 'allowed' && flashed === false && (await js('PastelTerm.overlays.current()')) === null,
    `existing install: after Allow the checklist completes from History and never opens: ${JSON.stringify({ done: configStore.load().getStarted.done, flashed, open: await js('PastelTerm.overlays.current()') })}`);
  check((await js('PastelTerm.launchScreens.show()')) === false, 'existing install: the next launch opens nothing');
  await js('PastelTerm.getStarted.open()');
  const existingSet = await until((s) => s.open === 'get-started' && s.allSet);
  check(existingSet, 'existing install: Get started opened by hand reads "You’re all set"');
  await capture('get-started-existing-all-set');
  await js('PastelTerm.overlays.hideCurrent()');

  // 12. An existing install like 1.0.2's first report: a config.json full of her settings, welcome seen, no claudeFolder.
  // The question stays up whatever else she clicks first; History, while reading is off, says why and offers Allow.
  const configPath = path.join(app.getPath('userData'), 'config.json');
  const savedConfig = fs.readFileSync(configPath, 'utf8'); // put back after, so later checks see the run's own config
  fs.writeFileSync(configPath, JSON.stringify(EXISTING_CONFIG, null, 2));
  const fixtureLoad = configStore.load();
  check(fixtureLoad.claudeFolder.choice === 'unasked' && fixtureLoad.welcome.seen && fixtureLoad.notesPanel.open === 'closed',
    `existing config fixture loads as unasked, welcome seen, her settings kept: ${JSON.stringify({ folder: fixtureLoad.claudeFolder, welcome: fixtureLoad.welcome })}`);
  configStore.save({}); // what a fresh launch would load; tells main's folder gate and the renderer
  // A real launch has no tabs yet. This run's tabs showed Claude replying while reading was on, and Get started
  // ticks from them (and writes back its in-memory ticks) until main's feed clears them; wait for that, then start clean.
  const cleared = await waitFor(async () => { const f = await js('PastelTerm.getStarted.currentFacts()'); return !f.claudeRunning && !f.sessionStarted && !f.replied ? f : null; }, 8000);
  check(cleared, 'existing config: with reading off, the open tabs no longer show Claude replying');
  configStore.save({ getStarted: { done: [] } }); // the fixture has none; undo any ticks written back meanwhile
  await js('PastelTerm.getStarted.load()'); // as a launch does (app.ts) before the launch screens
  await js('PastelTerm.getStarted.refresh()'); // what a tab event does; it must not bring the run's earlier ticks back
  await wait(300);
  const restarted = configStore.load().getStarted.done; // two open tabs still tick Add Session, as they would at launch
  check(!restarted.includes('sign-in') && !restarted.includes('ask'), `existing config: Get started starts from the fixture, not the run's earlier ticks: ${JSON.stringify(restarted)}`);
  check(await js('PastelTerm.launchScreens.show()'), 'existing config: launch reports a screen');
  const askedAgain = await waitFor(async () => { const c = await js(CONSENT); return c.shown ? c : null; }, 5000);
  check(askedAgain, 'existing config: the folder question shows on launch');
  check((await js("document.activeElement?.id")) === 'consent', `existing config: focus sits on the question, not Allow, so a stray Enter can't answer it: ${await js('document.activeElement?.className')}`);
  for (const id of ['history-button', 'customize-button']) await js(`document.getElementById('${id}').click()`);
  send(win.webContents, 'get-started:open');
  await wait(600);
  const stillAsked = await js(CONSENT);
  check(stillAsked.shown && (await js('PastelTerm.overlays.current()')) === 'consent' && configStore.load().claudeFolder.choice === 'unasked',
    `existing config: History, Customize and Get started wait behind the question: ${JSON.stringify({ open: await js('PastelTerm.overlays.current()'), choice: configStore.load().claudeFolder.choice })}`);
  await js("document.querySelector('#consent .consent-later').click()");
  // With reading off, sign-in and ask are hand-ticked only, so Get started follows only while another step is open.
  await wait(800);
  const reopens = await js('PastelTerm.getStarted.reopensOnLaunch()');
  const followed = (await js('PastelTerm.overlays.current()')) === (reopens ? 'get-started' : null);
  check(followed && configStore.load().claudeFolder.choice === 'declined',
    `existing config: Not now saves "declined" and Get started follows only for a step Petal can see: ${JSON.stringify({ open: await js('PastelTerm.overlays.current()'), done: configStore.load().getStarted.done, facts: await js('PastelTerm.getStarted.currentFacts()') })}`);
  await js('PastelTerm.overlays.hideCurrent()');
  await js("document.getElementById('history-button').click()");
  const HISTORY = `(() => ({ open: PastelTerm.overlays.current(), off: document.querySelector('#history-list .history-folder-off')?.innerText ?? null,
    allow: document.querySelector('#history-list .history-allow')?.textContent ?? null, rows: document.querySelectorAll('#history-list .history-row').length }))()`;
  const offered = await waitFor(async () => { const h = await js(HISTORY); return h.open === 'history' && h.off ? h : null; }, 5000);
  check(offered && /Petal isn’t reading your Claude folder/.test(offered.off) && offered.allow === 'Allow' && offered.rows === 0,
    `reading off: History says why it's empty and offers Allow: ${JSON.stringify(offered)}`);
  await capture('get-started-history-folder-off');
  await js("document.querySelector('#history-list .history-allow').click()");
  const listed = await waitFor(async () => { const h = await js(HISTORY); return h.rows > 0 && !h.off ? h : null; }, 8000);
  check(listed && configStore.load().claudeFolder.choice === 'allowed', `History's Allow saves "allowed" and lists her sessions: ${JSON.stringify(listed ?? { ...(await js(HISTORY)), choice: configStore.load().claudeFolder.choice })}`);
  await capture('get-started-history-allowed');
  await js('PastelTerm.overlays.hideCurrent()');
  fs.writeFileSync(configPath, savedConfig);
  configStore.save({}); // tells the organizer schedule and the folder gate, as the fixture's save did
  const organizerAfter = { enabled: configStore.load().organizer.enabled, schedule: organizer.status().schedule };
  check(!organizerAfter.enabled && organizerAfter.schedule?.enabled === false, `existing config: step 12 puts the config back, organizer still off: ${JSON.stringify(organizerAfter)}`);

  // Back to the fixture every later check expects.
  if (secondId) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(secondId)})`);
  fixture.transcript = saved.transcript;
  fixture.sessionId = saved.sessionId;
  historyFixture.records.push(...saved.history);
  folderFixture.home = null;
  claudeFixture.installed = null;
  configStore.save({ claudeFolder: { choice: 'allowed' } });
  await wait(1500);
}
