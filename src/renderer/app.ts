// Renderer entry: loads every module in page order, then wires main's events to the active tab.
import './styles';
import './motion-clock';
import * as themeKit from './theme';
import * as reader from './reader';
import * as terminal from './terminal';
import * as tabs from './tabs';
import * as layout from './layout';
import * as sessionsPanel from './sessions-panel';
import * as scenes from './scenes';
import * as cat from './cat';
import * as diagrams from './diagrams';
import * as flow from './flow';
import * as history from './history';
import * as composer from './composer';
import * as workflow from './workflow';
import * as customize from './customize';
import * as overlays from './overlays';
import * as promptDock from './prompt-dock';
import * as repos from './repos';
import * as sceneCards from './scene-card';
import * as tarotReading from './tarot-reading';
import * as colourKey from './colour-key';
import './planet-reading';
import * as welcome from './welcome';
import * as getStarted from './get-started';
import * as consent from './consent';
import * as launchScreens from './launch-screens';
import * as notesPanel from './notes-panel';
import * as updatePill from './update-pill';
import * as dockFit from './dock-fit';
import * as headFit from './head-fit';
import * as agentsMenu from './agents-menu';
import * as agentPanel from './agent-panel';
import * as favorites from './favorites';
import * as sessionsBoard from './sessions-board';
import * as focusMode from './focus-mode';
import * as readerBanners from './reader-banners';
import * as headersMin from './headers-min';
import * as shortcuts from './shortcuts';
import * as library from './library';
import * as libraryAdd from './library-add';
import * as testing from './testing';
import * as stopClaude from './stop-claude';
import themes from '../themes.json';
import { byId, isIpcError } from './dom';
import type { Tab } from './tabs';
import type { Guarded } from '../shared/ipc';
import type { ReaderUpdate, Theme } from '../shared/types';

// Debug and test handle: the snapshot run drives the page through window.PastelTerm via executeJavaScript.
const debugHandle = { theme: themeKit, reader, tabs, sessionsPanel, scenes, cat, diagrams, history, composer, workflow, customize, overlays, promptDock, repos, tarotReading, colourKey, updatePill, dockFit, headFit, welcome, getStarted, consent, launchScreens, notesPanel, agentsMenu, agentPanel, favorites, sessionsBoard, focusMode, readerBanners, headersMin, layout, shortcuts, library, libraryAdd, testing, stopClaude };
export type DebugHandle = typeof debugHandle;
window.PastelTerm = debugHandle;

const SCREEN_SETTLE_MS = 80;
const NO_UPDATE: ReaderUpdate = { state: 'none', replies: [], waiting: [], promptCount: 0, busy: false, sessionId: null, cwd: null, repo: null, conclusion: null };

// Startup reads that fail in main fall back to the defaults, and the reader says which ones.
const startupProblems: string[] = [];
function orDefault<T>(result: Guarded<T>, fallback: T, what: string): T {
  if (!isIpcError(result)) return result;
  startupProblems.push(`${what} (${result.error})`);
  return fallback;
}

async function start(): Promise<void> {
  // Glyph metrics are measured at open(); fonts must be ready first.
  const fonts = [
    `400 16px "${terminal.MONO_FONT}"`, `700 16px "${terminal.MONO_FONT}"`,
    '400 19px "Atkinson Hyperlegible Next"', '700 19px "Atkinson Hyperlegible Next"',
  ];
  await Promise.all(fonts.map((font) => document.fonts.load(font)));
  const fontsLoaded = fonts.every((font) => document.fonts.check(font));

  const fallbackTheme: Theme = themes.paleSky;
  const theme = orDefault(await window.pastel.getTheme(), fallbackTheme, 'the theme');
  themeKit.applyCssVars(theme);
  // A minimised terminal is out of layout; keys go to the reply box, which sends to the active tab.
  // Focus mode hides the terminal, so it never takes the keyboard back there.
  const focusTerminal = () => {
    if (focusMode.isOn()) return;
    if (layout.isTerminalMinimised()) composer.focus();
    else tabs.active()?.term.focus();
  };

  // The reader and the pet always follow the active tab, from its last update.
  promptDock.hooks.askingChanged = (asking) => { reader.setAsking(asking); stopClaude.paintComposer(); };
  const readScreen = (tab: Tab) => promptDock.readScreen(tab.id, tabs.screenLines(tab));
  const showTab = (tab: Tab) => {
    const update = tab.update ?? NO_UPDATE;
    reader.update({ ...update, tabId: tab.id, pending: tab.pending });
    flow.followReaderSession(update.sessionId);
    favorites.followReader(tab.id, update.sessionId);
    libraryAdd.follow(tab.id, update.sessionId);
    cat.setBusy(update.busy);
    readScreen(tab);
    stopClaude.paintComposer();
  };
  // Pickers come and go with pty output; read the active screen once a burst settles.
  let screenTimer: ReturnType<typeof setTimeout> | undefined;
  const onScreen = (tab: Tab) => {
    history.tabScreen(tab.id); // History's reply box may follow a tab in the background
    if (tab !== tabs.active()) return;
    clearTimeout(screenTimer);
    screenTimer = setTimeout(() => { if (tab === tabs.active()) readScreen(tab); }, SCREEN_SETTLE_MS);
  };

  // Esc closes the sessions panel, the open overlay, a scene card or the colour key, or leaves focus, instead of reaching claude, only while one is open.
  const catchEscape = (tab: Tab) => tab.term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown' || event.key !== 'Escape') return true;
    if (sessionsPanel.isOpen()) sessionsPanel.setOpen(false);
    else if (consent.isOpen()) void consent.decline(); // Esc there means Not now
    else if (overlays.current()) overlays.hideCurrent();
    else if (sceneCards.anyOpen()) sceneCards.closeAll();
    else if (colourKey.isOpen()) colourKey.close();
    else if (focusMode.isOn()) focusMode.set(false);
    else return true;
    return false;
  });

  // ⌘T and + open a tab meant for Claude, so her session limit applies.
  const newSessionTab = async () => { if (await sessionsPanel.roomForSession()) tabs.create({ startClaude: true }); };
  const onCreated = (tab: Tab) => { catchEscape(tab); getStarted.refresh(); };
  tabs.init({ theme, onNewTab: newSessionTab, onActivate: showTab, onCreated, onScreen });

  window.pastel.onTheme((next) => {
    themeKit.applyCssVars(next);
    tabs.applyTheme(next);
    reader.rerender();
    history.rerender();
    if (reader.currentView() === 'flow') reader.refreshFlow();
  });
  const setReading = (id: string) => { document.documentElement.dataset.reading = id; };
  setReading(orDefault(await window.pastel.getReading(), 'newspaper', 'the reading style'));
  const claudeFound = orDefault(await window.pastel.claudeInstalled(), true, 'whether Claude Code is installed');
  reader.setClaudeMissing(!claudeFound);
  const startup = orDefault(await window.pastel.config.get(), null, 'your settings');
  const folderAllowed = startup?.config.claudeFolder.choice === 'allowed';
  reader.setFolderAllowed(folderAllowed);
  history.setFolderAllowed(folderAllowed);
  sessionsBoard.setFolderAllowed(folderAllowed);
  library.setFolderAllowed(folderAllowed);
  libraryAdd.setFolderAllowed(folderAllowed);
  testing.setFolderAllowed(folderAllowed);
  window.pastel.onClaudeFolder((allowed) => { reader.setFolderAllowed(allowed); history.setFolderAllowed(allowed); sessionsBoard.setFolderAllowed(allowed); library.setFolderAllowed(allowed); libraryAdd.setFolderAllowed(allowed); testing.setFolderAllowed(allowed); history.rerender(); });
  window.addEventListener('petal:allow-folder', () => void consent.setChoice('allowed'));
  window.addEventListener('petal:get-started', () => void getStarted.open());
  window.pastel.onReading(setReading);
  cat.setCat(orDefault(await window.pastel.getCat(), 'mika', 'the pet'));
  window.pastel.onCat((id) => cat.setCat(id));
  cat.setScene(orDefault(await window.pastel.getScene(), 'none', 'the scene'));
  if (startupProblems.length) reader.showNotice(`Couldn’t read ${startupProblems.join(', ')}; using the defaults.`);
  window.pastel.onScene((id) => cat.setScene(id));
  window.pastel.onReplies((update) => {
    tabs.setUpdate(update.tabId, update);
    const active = tabs.active();
    if (active && update.tabId === active.id) showTab(active);
    history.tabUpdated(update.tabId);
    getStarted.refresh();
  });
  window.pastel.onTabLabel(({ tabId, label }) => {
    tabs.setLabel(tabId, label);
    const active = tabs.active();
    if (active && tabId === active.id) showTab(active); // the reader header names it too
  });
  window.pastel.onTabClosed(({ tabId }) => {
    tabs.remove(tabId);
    history.tabClosed(tabId);
    getStarted.refresh();
  });
  window.pastel.onTabCommand((command) => {
    if (command.kind === 'new' && command.background) history.adoptTab(tabs.create({ background: true, id: command.tabId }).id);
    else if (command.kind === 'new') tabs.create({ id: command.tabId });
    else if (command.kind === 'new-session') newSessionTab();
    else if (command.kind === 'close-active') tabs.requestClose(tabs.active()?.id);
    else if (command.kind === 'cycle') tabs.cycle(command.delta);
    else if (command.kind === 'activate') tabs.activate(command.tabId);
  });
  // Leaving focus: the terminal pane is back at its old size.
  focusMode.onChange((on) => {
    if (on) return;
    tabs.active()?.refit();
    focusTerminal();
  });
  layout.onTerminalMinimised(() => {
    tabs.active()?.refit();
    focusTerminal();
  });
  window.pastel.onToggleLayout(layout.toggleTerminalMinimised);
  window.pastel.onToggleHeaders(headersMin.toggle);
  // Clicking the reader must not steal keystrokes from the shell (unless selecting text).
  byId('reader').addEventListener('mouseup', () => {
    if (!window.getSelection()?.toString()) focusTerminal();
  });

  window.addEventListener('petal:focus-terminal', focusTerminal);
  // A Stop click or its 3s limit: repaint the reader's and reply box's Stop.
  window.addEventListener(stopClaude.CHANGED_EVENT, () => { const active = tabs.active(); if (active) showTab(active); });
  window.pastel.onStopClaude(() => void stopClaude.stopActive());
  // The reply box added or took back a pending message.
  window.addEventListener('petal:reader-refresh', (event) => {
    const tabId = (event as CustomEvent<string>).detail;
    const active = tabs.active();
    if (active && tabId === active.id) showTab(active);
    history.tabUpdated(tabId);
  });
  window.pastel.onOpenRepoPalette(() => repos.toggle());
  // Help > Colour key: back to the reader first, since an open overlay hides the header the key hangs from.
  window.pastel.onOpenColourKey(() => {
    overlays.hideCurrent();
    colourKey.open();
  });
  dockFit.init();
  headFit.init();
  updatePill.init();

  // The first tab starts Claude too, once she has allowed the reader to follow it (a new install answers that first).
  const { term, renderer } = tabs.create({ startClaude: claudeFound && folderAllowed });
  await getStarted.load();
  const firstRun = await launchScreens.show(); // over the first tab: the folder question, the welcome, then Get started until done
  window.pastel.reportReady({ fontsLoaded, renderer, cols: term.cols, rows: term.rows, firstRun });
}

start();
