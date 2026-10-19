// Dev-only render proof: PASTEL_SNAPSHOT=1 drives a real claude in the pty, captures PNGs, quits.
// main.ts imports this file dynamically, only in snapshot runs, so normal launches never load it.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, powerSaveBlocker, screen } from 'electron';
import type { IPty } from 'node-pty';
import * as views from './snapshot-views';
import { promptsCheck, questionPickerCheck } from './snapshot-prompts';
import { builtinMenusCheck } from './snapshot-builtin-menus';
import { stopButtonCheck } from './snapshot-stop';
import { printLookCheck } from './snapshot-print';
import { printAxisCheck } from './snapshot-print-axis';
import { columnAxisCheck } from './snapshot-column-axis';
import { tablesCheck } from './snapshot-tables';
import { headlineLinksCheck } from './snapshot-headline-links';
import { pastedCheck } from './snapshot-pasted';
import { bubbleImagesCheck } from './snapshot-bubble-images';
import { replyImagesCheck } from './snapshot-reply-images';
import { addSessionCheck } from './snapshot-add-session';
import { tabLimitCheck } from './snapshot-tab-limit';
import { updatePillCheck } from './snapshot-update-pill';
import { oldClaudeCheck } from './snapshot-old-claude';
import { headerCheck } from './snapshot-header';
import { dividerCheck } from './snapshot-divider';
import { termContrastCheck } from './snapshot-term-contrast';
import { agentsCheck } from './snapshot-agents';
import { statusStripCheck } from './snapshot-status-strip';
import { notesCheck } from './snapshot-notes';
import { notesSideCheck } from './snapshot-notes-side';
import { historyReplyCheck } from './snapshot-history-reply';
import { repoLineCheck } from './snapshot-repo-line';
import { reposCheck } from './snapshot-repos';
import { latencyCheck } from './snapshot-latency';
import { replyLatencyCheck } from './snapshot-reply-latency';
import { pasteCheck } from './snapshot-paste';
import { tarotCheck } from './snapshot-tarot';
import { colourKeyCheck } from './snapshot-colour-key';
import { shortcutsCheck } from './snapshot-shortcuts';
import { readerCollapseCheck } from './snapshot-reader-collapse';
import { readerStepsCheck } from './snapshot-reader-steps';
import { openThreadsCheck } from './snapshot-open-threads';
import { slashMenuCheck } from './snapshot-slash';
import { libraryCheck } from './snapshot-library';
import { libraryCostCheck } from './snapshot-library-cost';
import { lessonsCheck } from './snapshot-lessons';
import { testingCheck } from './snapshot-testing';
import { testLoopCheck } from './snapshot-test-loop';
import { distillationCheck } from './snapshot-distillation';
import { petalSkillsCheck } from './snapshot-petal-skills';
import { planetCheck } from './snapshot-planet';
import { sceneIdle } from './snapshot-idle';
import { sceneMotionCheck } from './snapshot-scenes';
import { catGallery } from './snapshot-cats';
import { historyLayoutCheck } from './snapshot-history-layout';
import { petSizeCheck } from './snapshot-pet-size';
import { customizeStylesCheck } from './snapshot-customize-styles';
import { factoryCheck } from './snapshot-factory';
import { shapeGuideCheck } from './snapshot-shape-guide';
import { favoritesCheck } from './snapshot-favorites';
import { sessionNamesCheck } from './snapshot-session-names';
import { sessionsBoardCheck } from './snapshot-sessions-board';
import { mentionsCheck } from './snapshot-mentions';
import { clashesCheck } from './snapshot-clashes';
import { prdTasksCheck } from './snapshot-prd-tasks';
import { windowFitCheck } from './snapshot-window-fit';
import { conclusionCheck } from './snapshot-conclusion';
import { minimiseCheck } from './snapshot-minimise';
import { textSizeCheck } from './snapshot-text-size';
import { launchCheck, organizerOffCheck, setupEmptyCheck } from './snapshot-onboarding';
import { getStartedCheck } from './snapshot-get-started';
import { firstRunCheck } from './snapshot-first-run';
import { petOnboardingCheck } from './snapshot-pet-onboarding';
import type { SessionFile } from '../main/claude-session';
import { once } from '../main/ipc';
import { fixtureFile, panelFixture, snapshotOutDir } from '../main/snapshot-mode';
import { onAnyDisplay } from '../main/snapshot-window';
import { harnessLine } from '../main/snapshot-shell';
import { shellGuardCheck } from './snapshot-shell-guard';
import { captureBaseline, keepingStores, type StepIsolation } from './snapshot-baseline';
import type { ReaderFeed } from '../main/reader-feed';
import type { ActiveSession, OpenTab, TabSessions } from '../main/tab-session';
import type { Theme, Themes } from '../shared/types';

export type Log = (line: string) => void;
// any: executeJavaScript returns whatever the page script builds; each caller knows the shape it asked for.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

interface StepCount {
  done: number;
  total: number;
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

// The panel's fixture sessions, her own first when the run has one; never her real Claudes.
function panelSessionsFixture(ownSessionId: string | null): SessionFile[] {
  const minutesAgo = (m: number) => Date.now() - m * 60_000;
  const fake = (n: number) => `e2e2e2e2-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return [
    ...(ownSessionId ? [{ pid: 0, sessionId: ownSessionId, cwd: '/tmp/petal-fixture/own', kind: 'interactive', status: 'busy', name: 'This tab', updatedAt: minutesAgo(0) }] : []),
    { pid: 0, sessionId: fake(1), cwd: '/tmp/petal-fixture/reader', kind: 'interactive', status: 'busy', name: 'Reader polish', updatedAt: minutesAgo(2) },
    { pid: 0, sessionId: fake(2), cwd: '/tmp/petal-fixture/notes', kind: 'interactive', status: 'idle', name: 'Release notes', updatedAt: minutesAgo(40) },
  ];
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
  const sessions = panelSessionsFixture(ownSessionId);
  panelFixture.sessions = sessions;
  await js('PastelTerm.sessionsPanel.setOpen(true)');
  await wait(1500);
  const pill = (await js("document.getElementById('sessions-pill').innerText")).trim();
  const busy = sessions.filter((s) => s.status === 'busy').length;
  const want = `Sessions · ${busy ? `${busy} busy · ` : ''}${sessions.length} open`;
  log(`${pill.startsWith(want) ? 'ok' : 'FAIL'} sessions pill counts the fixture sessions only: "${pill}", want "${want}"`);
  log(`own row marked: ${await js("document.querySelector('.session-row.own .session-own')?.innerText ?? 'none'")}`);

  const expandId = (sessions.find((s) => s.status === 'busy' && s.sessionId !== ownSessionId) ?? sessions[0]).sessionId;
  log(`expanding row: ${sessions.find((s) => s.sessionId === expandId)?.name}`);

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
  panelFixture.sessions = null;
  applyTheme('paleSky', { persist: false });
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
    edits: ['/Users/you/Code/petal/package.json', '/Users/you/Code/petal/src/main/menu.js'],
    reply: [
      '**The Petal build is ready in dist.**',
      '',
      '**Done:** renamed the app to Petal and moved the saved theme across',
      '**Watch out:** the old Pastel Term window keeps running until you quit it',
      '**Decide:** swap it into /Applications now, or after your session ends?',
      '',
      '```',
      '#21 | 2026-09-28 | ACTION | Claude | Renamed the app to Petal | package.json',
      '#22 | 2026-09-28 | DECISION | Alex | Keep the project folder name | ~/Code/petal',
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

const BASELINE_AFTER = 'launch'; // Get started is up from the fresh launch until this step closes it

// Runs every fixture check in order; returns how many finished, so a cut-short run shows in the marker.
async function runFixture({ js, win, capture, log, pty, feed, themes, applyTheme, tabs }: StepDeps & { pty: IPty; feed: ReaderFeed; tabs: TabsDeps }): Promise<StepCount> {
  const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
  const steps: [string, () => Promise<unknown>][] = [
    ['reply', () => fixtureReply({ js, log, pty })], // first: the feed must read the fixture it writes, not an older copy
    ['launch', async () => { organizerOffCheck(kit, 'start'); await launchCheck(kit); }], // Get started still open from the fresh launch
    ['diagrams', () => captureDiagrams({ js, capture, log, themes, applyTheme })],
    ['cat frames', () => catFrames({ js, win, capture, log, feed, themes, applyTheme })],
    ['cat gallery', () => catGallery(kit, win)],
    ['scene motion', () => sceneMotionCheck(kit, { feed, win })],
    ['sessions panel', () => captureSessionsPanel({ js, capture, log, themes, applyTheme, ownSessionId: null })],
    ['tabs', () => views.tabsCheck(kit, { win, feed, ...tabs })], // before the flow steps, which can hang on their own
    ['composer', () => views.composerCheck(kit, { win, ...tabs })],
    ['paste', () => pasteCheck(kit, { win, ...tabs })],
    ['prompts', () => promptsCheck(kit, { win, ...tabs })],
    ['builtin menus', () => builtinMenusCheck(kit, { win, ...tabs })],
    ['sessions close', () => views.sessionsCloseCheck(kit)],
    ['sessions agents', () => views.sessionsAgentsCheck(kit)],
    ['agents dropdown', () => agentsCheck(kit, win)],
    ['add session', () => addSessionCheck(kit)],
    ['tab limit', () => tabLimitCheck(kit)],
    ['update pill', () => updatePillCheck(kit)],
    ['old claude', () => oldClaudeCheck(kit)],
    ['fixture flow', () => views.fixtureFlow(kit)],
    ['real session flow', () => views.realSessionFlow(kit, process.env.PETAL_SNAPSHOT_REAL_SESSION)],
    ['history', () => views.historyScreens(kit)],
    ['notes', () => notesCheck(kit)],
    ['notes side', () => notesSideCheck(kit, win)],
    ['history reply', () => historyReplyCheck(kit)],
    ['favorites', () => favoritesCheck(kit, win)],
    ['session names', () => sessionNamesCheck(kit, { win, openTab: tabs.openTab })],
    ['sessions board', () => sessionsBoardCheck(kit, { win, openTab: tabs.openTab, sessions: tabs.sessions })],
    ['clashes', () => clashesCheck(kit, { win, openTab: tabs.openTab })],
    ['customize', () => views.customizeScreens(kit)],
    ['customize styles', () => customizeStylesCheck(kit, win)],
    ['factory', () => factoryCheck(kit, win)],
    ['shape guide', () => shapeGuideCheck(kit, win)],
    ['overlays', () => views.overlaysCheck(kit)],
    ['setup empty state', () => setupEmptyCheck(kit)],
    ['tarot', () => tarotCheck(kit, win)],
    ['planet', () => planetCheck(kit, win)],
    ['error replies', () => views.errorRepliesCheck(kit)],
    ['repos', () => reposCheck(kit, { win, ...tabs })],
    ['repo line', () => repoLineCheck(kit, { feed })], // before the print steps, which replace the fixture's replies
    ['print look', () => printLookCheck(kit, win)], // replaces the reader's reply with its own long sample
    ['print axis', () => printAxisCheck(kit, win)],
    ['fixed header', () => headerCheck(kit, win)],
    ['column axis', () => columnAxisCheck(kit, win)],
    ['divider', () => dividerCheck(kit, win)],
    ['tables', () => tablesCheck(kit, win)],
    ['headline links', () => headlineLinksCheck(kit, win)],
    ['pasted', () => pastedCheck(kit, win)],
    ['bubble images', () => bubbleImagesCheck(kit, win)],
    ['colour key', () => colourKeyCheck(kit, win)],
    ['reader collapse', () => readerCollapseCheck(kit, win)],
    ['reader steps', () => readerStepsCheck(kit, win)],
    ['open threads', () => openThreadsCheck(kit, win)], // sends one card's question to the fixture tab
    ['slash menu', () => slashMenuCheck(kit, win)], // sends one picked command to the fixture tab
    ['library', keepingStores(['library', 'cost', 'activity'], () => libraryCheck(kit, win), kit.outDir)], // a stubbed extractor only; never a real claude
    ['library cost', keepingStores(['library', 'cost', 'activity'], () => libraryCostCheck(kit, win), kit.outDir)], // stubbed usage numbers only; never a real claude
    ['lessons', keepingStores(['library', 'cost', 'activity'], () => lessonsCheck(kit, win), kit.outDir)], // a stubbed extractor and a stand-in CLAUDE.md only; puts back what it changes
    ['testing', keepingStores(['testing', 'activity'], () => testingCheck(kit, win), kit.outDir)], // records the pipeline line, never runs it; appends a Claude run to the fixture
    ['petal skills', keepingStores(['testing', 'activity'], () => petalSkillsCheck(kit, win), kit.outDir)], // stand-in ~/.claude and project only; never runs a command
    ['test loop', keepingStores(['testing', 'activity'], () => testLoopCheck(kit, win, feed), kit.outDir)], // records the brief paste and Esc, never a real claude; appends Loop lines
    ['distillation', keepingStores(['testing', 'activity'], () => distillationCheck(kit, win), kit.outDir)], // appends two loop rounds; records the thread, answer and brief pastes, never a real claude
    ['prd tasks', keepingStores(['testing', 'activity'], () => prdTasksCheck(kit, { win, openTab: tabs.openTab }), kit.outDir)], // seeds runs for a fixture repo's tasks; never runs a command
    ['latency', () => latencyCheck(kit, { feed, file: fakeTranscript() ?? '' })], // appends turns to the fixture
    ['reply latency', () => replyLatencyCheck(kit, { win, feed, file: fakeTranscript() ?? '', ...tabs })], // appends long turns and a 60MB second session
    ['status strip', () => statusStripCheck(kit, win, fakeTranscript() ?? '')], // appends its own replies too
    ['conclusion', keepingStores(['library', 'cost', 'testing', 'activity'], () => conclusionCheck(kit, win, fakeTranscript() ?? '', feed), kit.outDir)], // appends conclude turns; after the steps that measure the reader
    ['minimise', () => minimiseCheck(kit, win, tabs)], // headers and terminal folded and restored; leaves both shown
    ['window fit', () => windowFitCheck(kit, win)], // appends wide replies to the fixture
    ['get started', () => getStartedCheck(kit, { win, activeSession: tabs.activeSession })], // near the end: it swaps the first tab's log and puts it back
    ['organizer off', async () => organizerOffCheck(kit, 'end')], // last: the whole run has passed the first-pass delay
  ];
  const count: StepCount = { done: 0, total: steps.length };
  log(`SNAPSHOT START steps=${count.total}`);
  let isolation: StepIsolation | null = null; // set once the launch screen is closed: the run's resting state
  for (const [name, step] of steps) {
    log(`step ${count.done + 1}/${count.total} ${name}`);
    try {
      await step();
      if (isolation) await isolation.check(name);
      else if (name === BASELINE_AFTER) isolation = await captureBaseline(kit, win);
    } catch (error) {
      log(`FAIL step ${name}: ${(error as Error).stack}`); // a failing step logs and stops instead of hanging
      return count;
    }
    count.done++;
  }
  return count;
}

async function fixtureReply({ js, log, pty }: Pick<StepDeps, 'js' | 'log'> & { pty: IPty }): Promise<void> {
  log(`mermaid loaded before any diagram: ${await js("typeof window.mermaid !== 'undefined'")}`);
  writeFixture(fakeTranscript() ?? '');
  const samplePath = path.join(outDir(), 'terminal-sample.txt');
  fs.writeFileSync(samplePath, terminalSample());
  await wait(2500); // login shell rc files
  pty.write(harnessLine(`clear; cat '${samplePath}'; command -v claude >/dev/null && claude --version`));
  const reply = await waitFor(async () => (await js("document.getElementById('latest').innerText")).trim(), 10000);
  log(`reader headline: ${JSON.stringify(await js("document.querySelector('#latest .headline')?.innerText ?? 'none'"))}`);
  log(`standfirst: ${Boolean(await js("document.querySelector('#latest .headline + p')"))}; callouts: ${JSON.stringify(await js("[...document.querySelectorAll('#latest .callout')].map((el) => el.className)"))}`);
  log(`reply rendered: ${Boolean(reply)}`);
  const fonts = await js(`['400 19px "Atkinson Hyperlegible Next"', '400 16px "Atkinson Hyperlegible Mono"'].map((f) => f + '=' + document.fonts.check(f))`);
  log(`fonts: ${fonts.join(', ')}; headline family: ${await js("getComputedStyle(document.querySelector('#latest .headline')).fontFamily")}`);
}

const WATCH_INTERVAL_MS = 2000;

// Samples the window all run long into window-watch.log; it must never be visible on a display or focused.
function watchWindow(win: BrowserWindow, log: Log): () => void {
  const file = path.join(outDir(), 'window-watch.log');
  fs.writeFileSync(file, `displays ${JSON.stringify(screen.getAllDisplays().map((d) => d.bounds))}\n`);
  let samples = 0;
  let seen = 0;
  let focused = 0;
  const sample = () => {
    const bounds = win.getBounds();
    const visible = onAnyDisplay(bounds) && win.getOpacity() > 0;
    const hasFocus = BrowserWindow.getFocusedWindow() !== null;
    samples++;
    if (visible) seen++;
    if (hasFocus) focused++;
    fs.appendFileSync(file, `${new Date().toISOString()} bounds=${JSON.stringify(bounds)} opacity=${win.getOpacity()} visible=${visible} focused=${hasFocus}\n`);
  };
  sample();
  const timer = setInterval(sample, WATCH_INTERVAL_MS);
  return () => {
    clearInterval(timer);
    sample();
    log(`${seen || focused ? 'FAIL' : 'ok'} window stayed off every display and unfocused: ${samples} samples, ${seen} visible, ${focused} focused`);
  };
}

export async function run({ win, sessions, activeSession, openTab, themes, applyTheme }: RunDeps): Promise<void> {
  powerSaveBlocker.start('prevent-app-suspension'); // App Nap slows a windowless run's timers many times over; every wait then times out
  fs.mkdirSync(outDir(), { recursive: true });
  const logFile = path.join(outDir(), 'snapshot.log');
  fs.writeFileSync(logFile, '');
  let ok = 0;
  let fail = 0;
  const log: Log = (line) => {
    if (/^ok\b/.test(line)) ok++;
    else if (/^FAIL\b/.test(line)) fail++;
    fs.appendFileSync(logFile, `${line}\n`);
  };
  const stopWatch = watchWindow(win, log);
  // Every finished run ends on this line; a log without it was cut short and counts as failed.
  const finish = async (steps?: StepCount): Promise<void> => {
    await shellGuardCheck(js, log).catch((error: Error) => log(`FAIL shell guard: ${error.stack}`));
    stopWatch();
    const short = steps && steps.done < steps.total;
    log(`SNAPSHOT ${short ? 'INCOMPLETE' : 'COMPLETE'} ok=${ok} fail=${fail}${steps ? ` steps=${steps.done}/${steps.total}` : ''}`);
    app.quit();
  };
  const js: Js = (code) => win.webContents.executeJavaScript(code);
  const capture: Capture = async (name) => {
    await wait(800);
    const file = path.join(outDir(), `snapshot-${name}.png`);
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    log(`captured ${name}: ${file}`);
  };

  log(`renderer: ${JSON.stringify(await new Promise((r) => once('renderer:ready', (_e, info) => r(info))))}`);
  const first = activeSession(win.webContents.id); // the window's first tab
  if (!first) throw new Error('snapshot: the first tab never started');
  const { pty, feed } = first;
  let transcript = '';
  pty.onData((data) => { transcript += data; });

  if (process.env.PASTEL_SNAPSHOT_MODE === 'flow-relaunch') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await views.flowRelaunch(kit, { fixtureFile: fakeTranscript() ?? '', realSessionId: process.env.PETAL_SNAPSHOT_REAL_SESSION ?? '' });
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'open') {
    await wait(2500); // login shell rc files
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await views.openFromHistory(kit, { pty, feed, transcript: () => transcript, sessions, win });
    fs.writeFileSync(path.join(outDir(), 'pty-transcript.log'), transcript);
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'resume') {
    await wait(2500); // login shell rc files
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await views.resumeRoundTrip(kit, { pty, feed, transcript: () => transcript });
    fs.writeFileSync(path.join(outDir(), 'pty-transcript.log'), transcript);
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'scenes') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await sceneMotionCheck(kit, { feed, win }).catch((error: Error) => log(`FAIL ${error.stack}`));
    return app.quit();
  }

  // Holds one scene idle and logs its CPU per process type; quits after PASTEL_SNAPSHOT_IDLE_S.
  if (process.env.PASTEL_SNAPSHOT_MODE === 'scene-idle') {
    await sceneIdle({ win, js, log });
    return app.quit();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'print-axis') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await printAxisCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'column-axis') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await columnAxisCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'colour-key') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await colourKeyCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'first-run') {
    await wait(2500); // the stand-in shell's rc files
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await firstRunCheck(kit, { win, activeSession }).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  // The pet's setup guide on a brand-new install; needs a fresh PASTEL_SNAPSHOT_DIR and no fixture log.
  if (process.env.PASTEL_SNAPSHOT_MODE === 'pet-onboarding') {
    await wait(2500); // the stand-in shell's rc files
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await petOnboardingCheck(kit, { win, activeSession }).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'shortcuts') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await shortcutsCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'reader-collapse') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await readerCollapseCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'reader-steps') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await readerStepsCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'open-threads') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await openThreadsCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'slash-menu') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await slashMenuCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'testing') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await testingCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'petal-skills') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await petalSkillsCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'test-loop') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await testLoopCheck(kit, win, feed).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'lessons') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await lessonsCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'distillation') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await distillationCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'library-cost') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await keepingStores(['library', 'cost', 'activity'], () => libraryCostCheck(kit, win), kit.outDir)().catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'library') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await libraryCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'reply-latency' && fakeTranscript()) {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await replyLatencyCheck(kit, { win, feed, file: fakeTranscript() ?? '', sessions, openTab }).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'agents' && fakeTranscript()) {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await fixtureReply({ js, log, pty });
    await agentsCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'history-layout' && fakeTranscript()) {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await fixtureReply({ js, log, pty });
    await historyLayoutCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'conclusion' && fakeTranscript()) {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await fixtureReply({ js, log, pty });
    await conclusionCheck(kit, win, fakeTranscript() ?? '', feed).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'favorites' && fakeTranscript()) {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await fixtureReply({ js, log, pty });
    await favoritesCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'session-names' && fakeTranscript()) {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await fixtureReply({ js, log, pty });
    await sessionNamesCheck(kit, { win, openTab }).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'sessions-board' && fakeTranscript()) {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await fixtureReply({ js, log, pty });
    await sessionsBoardCheck(kit, { win, openTab, sessions }).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  // Messages between sessions: "@" picker, To line, wrapped pastes per tab, Board's Message…, a reply's Send to.
  if (process.env.PASTEL_SNAPSHOT_MODE === 'mentions' && fakeTranscript()) {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await fixtureReply({ js, log, pty });
    await mentionsCheck(kit, { win, openTab, sessions, fixtureFile: fakeTranscript() ?? '' }).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'prd-tasks' && fakeTranscript()) {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await fixtureReply({ js, log, pty });
    await keepingStores(['testing', 'activity'], () => prdTasksCheck(kit, { win, openTab }), kit.outDir)().catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'clashes' && fakeTranscript()) {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await fixtureReply({ js, log, pty });
    await clashesCheck(kit, { win, openTab }).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'window-fit' && fakeTranscript()) {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await fixtureReply({ js, log, pty });
    await windowFitCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'pet-size' && fakeTranscript()) {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await petSizeCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'customize-styles' && fakeTranscript()) {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await customizeStylesCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'text-size' && fakeTranscript()) {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await fixtureReply({ js, log, pty });
    await textSizeCheck(kit, win, { activeSession }).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'factory') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await factoryCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'shape-guide' && fakeTranscript()) {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await fixtureReply({ js, log, pty });
    await shapeGuideCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'term-contrast') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await termContrastCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  // Claude Code's own menus in the dock, and the fallback when no card reads the screen.
  if (process.env.PASTEL_SNAPSHOT_MODE === 'builtin-menus' && fakeTranscript()) {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await fixtureReply({ js, log, pty });
    await js('PastelTerm.getStarted.close()');
    await builtinMenusCheck(kit, { win, activeSession }).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  // Stop: reply box, streaming reply and Board card on a busy fixture; ⌘.; hidden when idle, waiting or asking.
  if (process.env.PASTEL_SNAPSHOT_MODE === 'stop-button' && fakeTranscript()) {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await fixtureReply({ js, log, pty });
    await js('PastelTerm.getStarted.close()');
    await stopButtonCheck(kit, { win, feed, activeSession }).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'question-picker' && fakeTranscript()) {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await fixtureReply({ js, log, pty });
    await questionPickerCheck(kit, { win, activeSession, file: fakeTranscript() ?? '' }).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  // Get started and the folder question on fixture state, without reading her ~/.claude. Needs a fresh PASTEL_SNAPSHOT_DIR.
  if (process.env.PASTEL_SNAPSHOT_MODE === 'get-started' && fakeTranscript()) {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await fixtureReply({ js, log, pty });
    await getStartedCheck(kit, { win, activeSession }).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'bubble-images') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await bubbleImagesCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  // Pictures in replies; needs HOME inside PASTEL_SNAPSHOT_DIR, where it writes the fixture PNGs.
  if (process.env.PASTEL_SNAPSHOT_MODE === 'reply-images') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await replyImagesCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (process.env.PASTEL_SNAPSHOT_MODE === 'divider') {
    const kit: Kit = { js, capture, log, wait, waitFor, verifiedCapture, themes, applyTheme, outDir: outDir() };
    await dividerCheck(kit, win).catch((error: Error) => log(`FAIL ${error.stack}`));
    return finish();
  }

  if (fakeTranscript()) {
    // A failing step logs and quits instead of leaving the run hanging.
    const steps = await runFixture({ js, win, capture, log, pty, feed, themes, applyTheme, tabs: { sessions, activeSession, openTab } });
    fs.writeFileSync(path.join(outDir(), 'pty-transcript.log'), transcript);
    return finish(steps);
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
    return finish();
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
  await finish();
}

