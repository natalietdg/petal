// Renderer entry: loads every module in page order, then wires main's events to the active tab.
import './styles';
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
import { byId } from './dom';
import type { Tab } from './tabs';
import type { ReaderUpdate } from '../shared/types';

// Debug and test handle: the snapshot run drives the page through window.PastelTerm via executeJavaScript.
const debugHandle = { theme: themeKit, reader, tabs, sessionsPanel, scenes, cat, diagrams, history, composer, workflow, customize };
export type DebugHandle = typeof debugHandle;
window.PastelTerm = debugHandle;

const NO_UPDATE: ReaderUpdate = { state: 'none', replies: [], busy: false, sessionId: null, cwd: null };

async function start(): Promise<void> {
  // Glyph metrics are measured at open(); fonts must be ready first.
  const fonts = [
    `400 16px "${terminal.MONO_FONT}"`, `700 16px "${terminal.MONO_FONT}"`,
    '400 19px "Atkinson Hyperlegible Next"', '700 19px "Atkinson Hyperlegible Next"',
  ];
  await Promise.all(fonts.map((font) => document.fonts.load(font)));
  const fontsLoaded = fonts.every((font) => document.fonts.check(font));

  const theme = await window.pastel.getTheme();
  themeKit.applyCssVars(theme);
  const focusTerminal = () => tabs.active()?.term.focus();

  // The reader and the pet always follow the active tab, from its last update.
  const showTab = (tab: Tab) => {
    const update = tab.update ?? NO_UPDATE;
    reader.update(update);
    cat.setBusy(update.busy);
  };

  // Esc closes the sessions panel instead of reaching claude, only while it is open.
  const catchEscape = (tab: Tab) => tab.term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown' || event.key !== 'Escape') return true;
    if (sessionsPanel.isOpen()) sessionsPanel.setOpen(false);
    else if (history.isOpen()) history.close();
    else if (customize.isOpen()) customize.close();
    else return true;
    return false;
  });

  tabs.init({ theme, onActivate: showTab, onCreated: catchEscape });

  window.pastel.onTheme((next) => {
    themeKit.applyCssVars(next);
    tabs.applyTheme(next);
    reader.rerender();
    history.rerender();
    if (reader.currentView() === 'flow') reader.refreshFlow();
  });
  const setReading = (id: string) => { document.documentElement.dataset.reading = id; };
  setReading(await window.pastel.getReading());
  reader.setClaudeMissing(!(await window.pastel.claudeInstalled()));
  window.pastel.onReading(setReading);
  cat.setCat(await window.pastel.getCat());
  window.pastel.onCat((id) => cat.setCat(id));
  cat.setScene(await window.pastel.getScene());
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

  const { term, renderer } = tabs.create();
  window.pastel.reportReady({ fontsLoaded, renderer, cols: term.cols, rows: term.rows });
}

start();
