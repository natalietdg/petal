(async () => {
  const { theme: themeKit, reader, terminal, layout, tabs } = PastelTerm;
  const NO_UPDATE = { state: 'none', replies: [], busy: false };

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
  const showTab = (tab) => {
    const update = tab.update ?? NO_UPDATE;
    reader.update(update);
    PastelTerm.cat.setBusy(update.busy);
  };

  // Esc closes the sessions panel instead of reaching claude, only while it is open.
  const catchEscape = (tab) => tab.term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown' || event.key !== 'Escape') return true;
    if (PastelTerm.sessionsPanel.isOpen()) PastelTerm.sessionsPanel.setOpen(false);
    else if (PastelTerm.history.isOpen()) PastelTerm.history.close();
    else return true;
    return false;
  });

  tabs.init({ theme, onActivate: showTab, onCreated: catchEscape });

  window.pastel.onTheme((next) => {
    themeKit.applyCssVars(next);
    tabs.applyTheme(next);
    reader.rerender();
    PastelTerm.history.rerender();
    if (reader.currentView() === 'flow') reader.refreshFlow();
  });
  const setReading = (id) => { document.documentElement.dataset.reading = id; };
  setReading(await window.pastel.getReading());
  reader.setClaudeMissing(!(await window.pastel.claudeInstalled()));
  window.pastel.onReading(setReading);
  PastelTerm.cat.setCat(await window.pastel.getCat());
  window.pastel.onCat((id) => PastelTerm.cat.setCat(id));
  PastelTerm.cat.setScene(await window.pastel.getScene());
  window.pastel.onScene((id) => PastelTerm.cat.setScene(id));
  window.pastel.onReplies((update) => {
    tabs.setUpdate(update.tabId, update);
    if (update.tabId === tabs.active()?.id) showTab(tabs.active());
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
  document.getElementById('reader').addEventListener('mouseup', () => {
    if (!window.getSelection().toString()) focusTerminal();
  });

  window.addEventListener('petal:focus-terminal', focusTerminal);

  const { term, renderer } = tabs.create();
  window.pastel.reportReady({ fontsLoaded, renderer, cols: term.cols, rows: term.rows });
})();
