// Dev-only render proof: PASTEL_SNAPSHOT=1 drives a real claude in the pty, captures PNGs, quits.
// main.ts imports this file dynamically, only in snapshot runs, so normal launches never load it.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { IPty } from 'node-pty';
import * as views from './snapshot-views';
import * as sessionsMonitor from '../main/sessions-monitor';
import { once } from '../main/ipc';
import { fixtureFile, snapshotOutDir } from '../main/snapshot-mode';
import type { ReaderFeed } from '../main/reader-feed';
import type { ActiveSession, OpenTab, TabSessions } from '../main/tab-session';
import type { Theme, Themes } from '../shared/types';

export type Log = (line: string) => void;
// any: executeJavaScript returns whatever the page script builds; each caller knows the shape it asked for.
export type Js = (code: string) => Promise<any>;
export type Capture = (name: string) => Promise<void>;
export type ApplyTheme = (id: string, options?: { persist?: boolean }) => void;

export interface CaptureRequest {
  js: Js;
  capture: Capture;
  log: Log;
  theme: Theme;
  panelOpen: boolean;
  expandedId?: string | null;
  name: string;
  scrollTo?: string | null;
}

// Everything a snapshot step needs, passed as one bag.
export interface Kit {
  js: Js;
  capture: Capture;
  log: Log;
  wait: (ms: number) => Promise<void>;
  waitFor: <T>(check: () => T | Promise<T>, timeoutMs: number) => Promise<T | null>;
  verifiedCapture: (request: CaptureRequest) => Promise<void>;
  themes: Themes;
  applyTheme: ApplyTheme;
  outDir: string;
}

export interface TabsDeps {
  sessions: TabSessions;
  activeSession: ActiveSession;
  openTab: OpenTab;
}

interface RunDeps extends TabsDeps {
  win: BrowserWindow;
  themes: Themes;
  applyTheme: ApplyTheme;
}

interface StepDeps {
  js: Js;
  win: BrowserWindow;
  capture: Capture;
  log: Log;
  themes: Themes;
  applyTheme: ApplyTheme;
}

const PROMPT = 'say hi in 3 words, then one plain sentence about pastel colours';
const fakeTranscript = fixtureFile;
const outDir = snapshotOutDir;
// The fixture feed's busy/idle, which drives the cat and reply-finished.
export function setFixtureStatus(feed: ReaderFeed, status: 'idle' | 'busy'): void {
  if (feed.fixture) feed.fixture.status = status;
}
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(check: () => T | Promise<T>, timeoutMs: number): Promise<T | null> {
  for (const start = Date.now(); Date.now() - start < timeoutMs; await wait(500)) {
    const value = await check();
    if (value) return value;
  }
  return null;
}

function terminalSample(): string {
  const esc = '\x1b';
  const swatch = (code: number, label: string) => `${esc}[${code}m${label.padEnd(9)}${esc}[0m`;
  const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
  return [
    `${esc}[1mBold: Petal render check${esc}[0m  regular  ${esc}[2mdim (SGR 2)${esc}[0m  ${esc}[90mbright-black (ansi 8)${esc}[0m`,
    names.map((name, i) => swatch(30 + i, `${i} ${name}`)).join(' '),
    names.map((name, i) => swatch(90 + i, `${i + 8} ${name}`)).join(' '),
    '',
  ].join('\r\n');
}

function newestJsonlIn(dir: string): string | undefined {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]?.f;
}

// Independent count, the same way a shell would: session files whose pid answers kill -0.
function shellSessionCounts(): string {
  const script = `cd ~/.claude/sessions; t=0; b=0; for f in [0-9]*.json; do p=\${f%.json};
    grep -qE '"kind":"(interactive|bg)"' "$f" && kill -0 "$p" 2>/dev/null || continue;
    t=$((t+1)); grep -q '"status":"busy"' "$f" && b=$((b+1)); done; echo "Sessions · $b busy · $t open"`;
  try {
    return execSync(script, { shell: '/bin/zsh' }).toString().trim();
  } catch {
    return 'Sessions · 0 busy · 0 open'; // no ~/.claude yet (fresh user)
  }
}

// Waits until the page really shows the theme, panel and row state before capturing.
async function verifiedCapture({ js, capture, log, theme, panelOpen, expandedId = null, name, scrollTo = null }: CaptureRequest): Promise<void> {
  const want = { bg: hexToRgb(theme.reader.background), panelOpen, rowExpanded: Boolean(expandedId) };
  const probe = `(() => ({
    bg: getComputedStyle(document.getElementById('reader')).backgroundColor,
    panelOpen: !document.getElementById('sessions-panel').hidden,
    rowExpanded: !document.getElementById('sessions-panel').hidden && Boolean(document.querySelector('.session-detail')),
  }))()`;
  const state = await waitFor(async () => {
    const now = await js(probe);
    return JSON.stringify(now) === JSON.stringify(want) ? now : null;
  }, 8000);
  if (scrollTo) {
    await js(`document.querySelector(${JSON.stringify(scrollTo)}).scrollIntoView({ block: 'center' })`);
  } else {
    const scrolled = await js("(() => { const r = document.getElementById('reader'); const top = r.scrollTop; r.scrollTop = 0; return top; })()");
    if (scrolled) log(`note: reader was scrolled ${scrolled}px before ${name}; reset to top`);
  }
  log(`${state ? 'ok' : 'FAIL'} state for ${name}: want ${JSON.stringify(want)} got ${JSON.stringify(state ?? await js(probe))}`);
  await capture(name);
}

const hexToRgb = (hex: string): string => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

async function captureSessionsPanel({ js, capture, log, themes, applyTheme, ownSessionId, themeIds = ['paleSky', 'nightPastel'] }: Omit<StepDeps, 'win'> & { ownSessionId: string | null; themeIds?: string[] }): Promise<void> {
  await js('PastelTerm.sessionsPanel.setOpen(true)');
  await wait(1500);
  const pill = (await js("document.getElementById('sessions-pill').innerText")).trim();
  const shell = shellSessionCounts();
  log(`sessions pill: "${pill}" | kill -0 count: "${shell}" | match=${pill === shell}`);
  log(`own row marked: ${await js("document.querySelector('.session-row.own .session-own')?.innerText ?? 'none'")}`);

  const rows = sessionsMonitor.snapshot({ detailed: true }).rows ?? [];
  const expandId = (rows.find((row) => row.status === 'busy' && row.sessionId !== ownSessionId) ?? rows[0])?.sessionId;
  log(`expanding row: ${rows.find((row) => row.sessionId === expandId)?.name}`);

  const panel = (code: string) => js(`PastelTerm.sessionsPanel.${code}`);
  for (const id of themeIds) {
    const theme = themes[id];
    applyTheme(id, { persist: false });
    await panel('setOpen(false)');
    await verifiedCapture({ js, capture, log, theme, panelOpen: false, name: `pill-${id}` });
    await panel('expandedIds.clear()');
    await panel('setOpen(true)');
    await verifiedCapture({ js, capture, log, theme, panelOpen: true, name: `panel-${id}` });
    await panel(`expandedIds.add(${JSON.stringify(expandId)})`);
    await panel('refresh()');
    await verifiedCapture({ js, capture, log, theme, panelOpen: true, expandedId: expandId, name: `panel-row-${id}` });
  }
  await panel('expandedIds.clear()');
  await panel('setOpen(false)');
}

const FIXTURE_REPLY = [
  '**The reader now follows only the claude inside this window.**',
  '',
  'Petal used to show the newest log in the folder, so another terminal could take over the reader. It now asks the process tree which claude is ours.',
  '',
  '**Process tree first.** Every second it walks the children of the shell and picks the one called `claude`, skipping background helpers.',
  '',
  "**Session file second.** That process's file in `~/.claude/sessions` names the exact transcript, so ==no guessing by timestamp== is left.",
  '',
  '**Re-read on every tick.** `/clear` and `/resume` change the session id, and the reader switches with it.',
  '',
  '```mermaid',
  'mindmap',
  '  root((Reader))',
  '    Process tree',
  '      claude pid',
  '      skip bg helpers',
  '    Session file',
  '      sessionId',
  '      cwd',
  '    Every tick',
  '      clear',
  '      resume',
  '```',
  '',
  'A broken diagram falls back to its source:',
  '',
  '```mermaid',
  'mindmap',
  '  root((unclosed',
  '    ]]] not valid',
  '```',
  '',
  '**Watch out:** the sessions file is undocumented, so a malformed one shows the empty state instead of crashing.',
  '',
  '```',
  '#23 | 2026-09-28 | ACTION | Claude | Reader pinned to the pty session | reader-feed.js',
  '#24 | 2026-09-28 | ACTION | external | Claude Code writes sessions/<pid>.json | ~/.claude/sessions',
  '```',
  '',
  '**Next:** run `claude` in the pane below and watch this page update.',
].join('\n');

// Earlier steps give the Outcome Flow labels, audit rows, edits and quiet steps to show.
const FIXTURE_STEPS: { prompt: string; edits?: string[]; reply: string | null }[] = [
  {
    prompt: 'should Petal ship to /Applications now?',
    edits: ['/Users/natalieleong/CascadeProjects/pastel-term/package.json', '/Users/natalieleong/CascadeProjects/pastel-term/src/main/menu.js'],
    reply: [
      '**The Petal build is ready in dist.**',
      '',
      '**Done:** renamed the app to Petal and moved the saved theme across',
      '**Watch out:** the old Pastel Term window keeps running until you quit it',
      '**Decide:** swap it into /Applications now, or after your session ends?',
      '',
      '```',
      '#21 | 2026-09-28 | ACTION | Claude | Renamed the app to Petal | package.json',
      '#22 | 2026-09-28 | DECISION | Natalie | Keep the project folder name | ~/CascadeProjects/pastel-term',
      '```',
    ].join('\n'),
  },
  { prompt: 'thanks', reply: 'You are welcome.' },
  { prompt: 'ok one sec', reply: 'Sure, take your time.' },
  { prompt: 'why did the reader switch sessions?', edits: ['/x/src/main/reader-feed.js', '/x/src/main/claude-session.js', '/x/src/main/reader-feed.js'], reply: null },
];

function writeFixture(file: string): void {
  views.assertFixtureOutsideClaude(file);
  const entry = (fields: Record<string, unknown>) => `${JSON.stringify({ isSidechain: false, timestamp: new Date().toISOString(), ...fields })}\n`;
  const assistant = (uuid: string, content: unknown) => entry({ type: 'assistant', uuid, message: { role: 'assistant', content } });
  const lines: string[] = [];
  FIXTURE_STEPS.forEach((step, i) => {
    lines.push(entry({ type: 'user', uuid: `fixture-u${i}`, message: { role: 'user', content: step.prompt } }));
    for (const [j, target] of (step.edits ?? []).entries()) {
      lines.push(assistant(`fixture-t${i}-${j}`, [{ type: 'tool_use', id: `t${i}${j}`, name: j % 2 ? 'Write' : 'Edit', input: { file_path: target } }]));
      lines.push(entry({ type: 'user', uuid: `fixture-r${i}-${j}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}${j}`, content: 'ok' }] } }));
    }
    lines.push(assistant(`fixture-a${i}`, [{ type: 'text', text: step.reply ?? FIXTURE_REPLY }]));
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join(''));
}

async function captureCat({ js, win, log, name }: Pick<StepDeps, 'js' | 'win' | 'log'> & { name: string }): Promise<void> {
  await captureCatAt({ js, win, log, name, size: null });
  await captureCatAt({ js, win, log, name: `${name}-zoom4x`, size: 240 });
}

async function captureCatAt({ js, win, log, name, size }: Pick<StepDeps, 'js' | 'win' | 'log'> & { name: string; size: number | null }): Promise<void> {
  if (size) await js(`Object.assign(document.getElementById('cat').style, { width: '${size}px', height: '${size}px' })`);
  await wait(300);
  const box = await js("(() => { const r = document.getElementById('cat').getBoundingClientRect(); return { x: Math.floor(r.x) - 20, y: Math.floor(r.y) - 30, width: Math.ceil(r.width) + 40, height: Math.ceil(r.height) + 40 }; })()");
  const file = path.join(outDir(), `snapshot-${name}.png`);
  fs.writeFileSync(file, (await win.webContents.capturePage(box)).toPNG());
  if (size) await js("Object.assign(document.getElementById('cat').style, { width: '', height: '' })");
  log(`captured ${name}: ${file}`);
}

async function catFrames({ js, win, capture, log, feed, themes, applyTheme }: StepDeps & { feed: ReaderFeed }): Promise<void> {
  for (const [status, busy] of [['idle', false], ['busy', true]] as const) {
    setFixtureStatus(feed, status);
    const shown = await waitFor(async () => (await js("document.getElementById('cat').classList.contains('busy')")) === busy || null, 5000);
    const info = await js("(() => { const c = document.getElementById('cat'); return { hidden: c.hidden, tip: c.querySelector('.cat-tip').textContent }; })()");
    log(`${shown ? 'ok' : 'FAIL'} cat ${status}: ${JSON.stringify(info)}`);
    for (const id of ['paleSky', 'nightPastel']) {
      applyTheme(id, { persist: false });
      await wait(600);
      await captureCat({ js, win, log, name: `cat-${status}-${id}` });
    }
    if (status === 'busy') {
      applyTheme('paleSky', { persist: false });
      await verifiedCapture({ js, capture, log, theme: themes.paleSky, panelOpen: false, name: 'busy-paleSky' });
      // Full conversation: earlier turns sit above the newest reply, each with her message.
      const convo = await js("({ turns: document.querySelectorAll('#older .older-turn').length, bubbles: document.querySelectorAll('#reader .reader-you').length, olderFirst: Boolean(document.getElementById('older').compareDocumentPosition(document.getElementById('latest')) & Node.DOCUMENT_POSITION_FOLLOWING) })");
      log(`${convo.turns > 0 && convo.olderFirst ? 'ok' : 'FAIL'} full conversation in the reader: ${JSON.stringify(convo)}`);
      await js("document.getElementById('reader').scrollTop = 0");
      await capture('conversation-top');
    }
  }
  applyTheme('paleSky', { persist: false });
  setFixtureStatus(feed, 'idle');
}

async function captureDiagrams({ js, capture, log, themes, applyTheme }: Omit<StepDeps, 'win'>): Promise<void> {
  const rendered = await waitFor(() => js("document.querySelectorAll('#latest figure.diagram svg').length"), 15000);
  const check = await js(`({
    figures: document.querySelectorAll('#latest figure.diagram').length,
    fallbackCodeBlocks: document.querySelectorAll('#latest pre code.language-mermaid').length,
    errorBoxes: document.querySelectorAll('.error-icon, .error-text, [id^="dpetal-diagram"]').length,
    nodeFont: getComputedStyle(document.querySelector('#latest figure.diagram svg text, #latest figure.diagram svg foreignObject div, #latest figure.diagram svg span') || document.body).fontFamily,
  })`);
  log(`${rendered ? 'ok' : 'FAIL'} diagrams: ${JSON.stringify(check)}`);
  for (const id of ['paleSky', 'nightPastel']) {
    applyTheme(id, { persist: false });
    const fill = await waitFor(async () => {
      await wait(400);
      return js("getComputedStyle(document.querySelector('#latest figure.diagram svg .node path, #latest figure.diagram svg .node rect, #latest figure.diagram svg .node circle')).fill");
    }, 5000);
    log(`mindmap ${id}: first node fill ${fill}`);
    await verifiedCapture({ js, capture, log, theme: themes[id], panelOpen: false, name: `mindmap-${id}`, scrollTo: '#latest figure.diagram' });
  }
  applyTheme('paleSky', { persist: false });
}

async function runFixture({ js, win, capture, log, pty, feed, themes, applyTheme, tabs }: StepDeps & { pty: IPty; feed: ReaderFeed; tabs: TabsDeps }): Promise<void> {
  log(`mermaid loaded before any diagram: ${await js("typeof window.mermaid !== 'undefined'")}`);
  writeFixture(fakeTranscript() ?? '');
  const samplePath = path.join(outDir(), 'terminal-sample.txt');
  fs.writeFileSync(samplePath, terminalSample());
  await wait(2500); // login shell rc files
  pty.write(`clear; cat '${samplePath}'; claude --version\r`);
  const reply = await waitFor(async () => (await js("document.getElementById('latest').innerText")).trim(), 10000);
  log(`reader headline: ${JSON.stringify(await js("document.querySelector('#latest .headline')?.innerText ?? 'none'"))}`);
  log(`standfirst: ${Boolean(await js("document.querySelector('#latest .headline + p')"))}; callouts: ${JSON.stringify(await js("[...document.querySelectorAll('#latest .callout')].map((el) => el.className)"))}`);
  log(`reply rendered: ${Boolean(reply)}`);
  const fonts = await js(`['400 19px "Atkinson Hyperlegible Next"', '400 16px "Atkinson Hyperlegible Mono"'].map((f) => f + '=' + document.fonts.check(f))`);
  log(`fonts: ${fonts.join(', ')}; headline family: ${await js("getComputedStyle(document.querySelector('#latest .headline')).fontFamily")}`);
  await captureDiagrams({ js, capture, log, themes, applyTheme });
  await catFrames({ js, win, capture, log, feed, themes, applyTheme });
  await captureSessionsPanel({ js, capture, log, themes, applyTheme, ownSessionId: null });
  const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
  await views.tabsCheck(kit, { win, feed, ...tabs }); // before the flow steps, which can hang on their own
  await views.composerCheck(kit, { win, ...tabs });
  await views.fixtureFlow(kit);
  await views.realSessionFlow(kit, process.env.PETAL_SNAPSHOT_REAL_SESSION);
  await views.historyScreens(kit);
  await views.customizeScreens(kit);
  await views.overlaysCheck(kit);
  await views.errorRepliesCheck(kit);
}

export async function run({ win, sessions, activeSession, openTab, themes, applyTheme }: RunDeps): Promise<void> {
  fs.mkdirSync(outDir(), { recursive: true });
  const logFile = path.join(outDir(), 'snapshot.log');
  fs.writeFileSync(logFile, '');
  const log: Log = (line) => fs.appendFileSync(logFile, `${line}\n`);
  const js: Js = (code) => win.webContents.executeJavaScript(code);
  const capture: Capture = async (name) => {
    await wait(800);
    const file = path.join(outDir(), `snapshot-${name}.png`);
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    log(`captured ${name}: ${file}`);
  };

  // The snapshot window pops up over her work: never take her mouse or keyboard.
  win.setIgnoreMouseEvents(true);
  win.setFocusable(false);
  log(`renderer: ${JSON.stringify(await new Promise((r) => once('renderer:ready', (_e, info) => r(info))))}`);
  const first = activeSession(win.webContents.id); // the window's first tab
  if (!first) throw new Error('snapshot: the first tab never started');
  const { pty, feed } = first;
  let transcript = '';
  pty.onData((data) => { transcript += data; });

  if (process.env.PASTEL_SNAPSHOT_MODE === 'flow-relaunch') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await views.flowRelaunch(kit, { fixtureFile: fakeTranscript() ?? '', realSessionId: process.env.PETAL_SNAPSHOT_REAL_SESSION ?? '' });
    return app.quit();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'open') {
    await wait(2500); // login shell rc files
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await views.openFromHistory(kit, { pty, feed, transcript: () => transcript, sessions, win });
    fs.writeFileSync(path.join(outDir(), 'pty-transcript.log'), transcript);
    return app.quit();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'resume') {
    await wait(2500); // login shell rc files
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await views.resumeRoundTrip(kit, { pty, feed, transcript: () => transcript });
    fs.writeFileSync(path.join(outDir(), 'pty-transcript.log'), transcript);
    return app.quit();
  }

  if (fakeTranscript()) {
    // A failing step logs and quits instead of leaving the run hanging.
    await runFixture({ js, win, capture, log, pty, feed, themes, applyTheme, tabs: { sessions, activeSession, openTab } })
      .catch((error: Error) => log(`FAIL ${error.stack}`));
    fs.writeFileSync(path.join(outDir(), 'pty-transcript.log'), transcript);
    return app.quit();
  }

  await wait(2500); // login shell rc files
  log(`empty state text: ${await js("document.getElementById('reader-status').innerText")}`);
  await capture('empty');

  const samplePath = path.join(outDir(), 'terminal-sample.txt');
  fs.writeFileSync(samplePath, terminalSample());
  pty.write(`clear; cat '${samplePath}'; claude --version; claude\r`);

  await wait(8000); // claude TUI startup
  log(`sessions json before first prompt: ${fs.existsSync(path.join(os.homedir(), '.claude', 'sessions', `${feed.claudePid}.json`))} (pid ${feed.claudePid})`);
  pty.write(PROMPT);
  await wait(500);
  pty.write('\r');
  const session = await waitFor(() => feed.session, 30000);
  if (!session) {
    log(`FAIL claude session never found under shell pid ${pty.pid}`);
    log(execSync('/bin/ps -Ao pid=,ppid=,comm=').toString());
    fs.writeFileSync(path.join(outDir(), 'pty-transcript.log'), transcript);
    return app.quit();
  }
  const sessionFile = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'sessions', `${session.pid}.json`), 'utf8')) as { sessionId?: string };
  log(`followed pid=${session.pid} sessionId=${session.sessionId} sessionsJson.sessionId=${sessionFile.sessionId} match=${session.sessionId === sessionFile.sessionId}`);

  const replyText = await waitFor(async () => (await js("document.getElementById('latest').innerText")).trim(), 90000);
  log(`reader reply: ${JSON.stringify(replyText)}`);
  log(`earlier turns shown: ${await js("document.querySelectorAll('.older-turn').length")}`);
  const body = await js(`(() => { const p = document.querySelector('#latest p:not(.headline)'); return p ? getComputedStyle(p).fontFamily : 'no body paragraph'; })()`);
  log(`body font-family: ${body}; check Next=${await js(`document.fonts.check('400 19px "Atkinson Hyperlegible Next"')`)}`);
  log(`reader transcript file: ${path.basename(session.transcript)}`);
  log(`newest jsonl in folder right now: ${newestJsonlIn(path.dirname(session.transcript))}`);

  for (const id of Object.keys(themes)) {
    applyTheme(id, { persist: false });
    await verifiedCapture({ js, capture, log, theme: themes[id], panelOpen: false, name: id });
  }

  await captureSessionsPanel({ js, capture, log, themes, applyTheme, ownSessionId: session.sessionId });

  // Ctrl-D twice exits claude; typing /exit can race the slash-command picker.
  pty.write('\x04');
  await wait(400);
  pty.write('\x04');
  const ended = await waitFor(async () => (await js("document.getElementById('reader-status').innerText")).includes('Session ended'), 20000);
  log(`ended state shown: ${Boolean(ended)}; reply still visible: ${(await js("document.getElementById('latest').innerText")).trim() === replyText}`);
  await capture('ended');
  fs.writeFileSync(path.join(outDir(), 'pty-transcript.log'), transcript);
  app.quit();
}

