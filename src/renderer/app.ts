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
import * as history from './history';
import * as composer from './composer';
import * as workflow from './workflow';
import * as customize from './customize';
import * as overlays from './overlays';
import * as promptDock from './prompt-dock';
import * as repos from './repos';
import * as tarotReading from './tarot-reading';
import themes from '../themes.json';
import { byId, isIpcError } from './dom';
import type { Tab } from './tabs';
import type { Guarded } from '../shared/ipc';
import type { ReaderUpdate, Theme } from '../shared/types';

// Debug and test handle: the snapshot run drives the page through window.PastelTerm via executeJavaScript.
const debugHandle = { theme: themeKit, reader, tabs, sessionsPanel, scenes, cat, diagrams, history, composer, workflow, customize, overlays, promptDock, repos, tarotReading };
export type DebugHandle = typeof debugHandle;
window.PastelTerm = debugHandle;

const SCREEN_SETTLE_MS = 80;
const NO_UPDATE: ReaderUpdate = { state: 'none', replies: [], waiting: [], promptCount: 0, busy: false, sessionId: null, cwd: null, repo: null, question: null };

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
  const focusTerminal = () => tabs.active()?.term.focus();

  // The reader and the pet always follow the active tab, from its last update.
  const readScreen = (tab: Tab) => promptDock.readScreen(tab.id, tabs.screenLines(tab));
  const showTab = (tab: Tab) => {
    const update = tab.update ?? NO_UPDATE;
    reader.update({ ...update, pending: tab.pending });
    cat.setBusy(update.busy);
    promptDock.showQuestion(tab.id, update.question);
    readScreen(tab);
  };
  // Pickers come and go with pty output; read the active screen once a burst settles.
  let screenTimer: ReturnType<typeof setTimeout> | undefined;
  const onScreen = (tab: Tab) => {
    if (tab !== tabs.active()) return;
    clearTimeout(screenTimer);
    screenTimer = setTimeout(() => { if (tab === tabs.active()) readScreen(tab); }, SCREEN_SETTLE_MS);
  };

  // Esc closes the sessions panel, the open overlay or the tarot reading instead of reaching claude, only while one is open.
  const catchEscape = (tab: Tab) => tab.term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown' || event.key !== 'Escape') return true;
    if (sessionsPanel.isOpen()) sessionsPanel.setOpen(false);
    else if (overlays.current()) overlays.hideCurrent();
    else if (tarotReading.isOpen()) tarotReading.close();
    else return true;
    return false;
  });

  tabs.init({ theme, onActivate: showTab, onCreated: catchEscape, onScreen });

  window.pastel.onTheme((next) => {
    themeKit.applyCssVars(next);
    tabs.applyTheme(next);
    reader.rerender();
    history.rerender();
    if (reader.currentView() === 'flow') reader.refreshFlow();
  });
  const setReading = (id: string) => { document.documentElement.dataset.reading = id; };
  setReading(orDefault(await window.pastel.getReading(), 'newspaper', 'the reading style'));
  reader.setClaudeMissing(!orDefault(await window.pastel.claudeInstalled(), true, 'whether Claude Code is installed'));
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
  });
  window.pastel.onTabClosed(({ tabId }) => tabs.remove(tabId));
  window.pastel.onTabCommand((command) => {
    if (command.kind === 'new') tabs.create();
    else if (command.kind === 'close-active') tabs.requestClose(tabs.active()?.id);
    else if (command.kind === 'cycle') tabs.cycle(command.delta);
    else if (command.kind === 'activate') tabs.activate(command.tabId);
  });
  window.pastel.onToggleLayout(() => {
    layout.toggleReaderOnly();
    tabs.active()?.refit();
    focusTerminal();
  });
  // Clicking the reader must not steal keystrokes from the shell (unless selecting text).
  byId('reader').addEventListener('mouseup', () => {
    if (!window.getSelection()?.toString()) focusTerminal();
  });

  window.addEventListener('petal:focus-terminal', focusTerminal);
  // The reply box added or took back a pending message.
  window.addEventListener('petal:reader-refresh', (event) => {
    const active = tabs.active();
    if (active && (event as CustomEvent<string>).detail === active.id) showTab(active);
  });
  window.pastel.onOpenRepoPalette(() => repos.toggle());

  const { term, renderer } = tabs.create();
  window.pastel.reportReady({ fontsLoaded, renderer, cols: term.cols, rows: term.rows });
}

start();
