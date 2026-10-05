PastelTerm.terminal = (() => {
  const MONO_FONT = 'Atkinson Hyperlegible Mono';

  function loadRenderer(term) {
    try {
      const webgl = new WebglAddon.WebglAddon();
      webgl.onContextLoss(() => webgl.dispose()); // falls back to the DOM renderer
      term.loadAddon(webgl);
      return 'webgl';
    } catch {
      return 'dom';
    }
  }

  // One xterm per tab; its pty output is routed in by tabs.js.
  function create(container, theme, tabId) {
    const term = new Terminal({
      fontFamily: `"${MONO_FONT}", monospace`,
      fontSize: 16,
      lineHeight: 1.5,
      letterSpacing: 1,
      fontWeight: 400,
      fontWeightBold: 700,
      cursorStyle: 'bar',
      cursorBlink: false,
      macOptionIsMeta: true,
      theme: PastelTerm.theme.toXterm(theme),
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon.WebLinksAddon((_event, url) => window.pastel.openLink(url)));
    term.open(container);
    const renderer = loadRenderer(term);

    // Hidden pane (reader-only) has no size; fitting it would collapse the grid.
    const refit = () => { if (container.offsetHeight > 0) fit.fit(); };
    new ResizeObserver(refit).observe(container);
    refit();

    term.onResize(({ cols, rows }) => window.pastel.resize(tabId, { cols, rows }));
    term.onData((data) => window.pastel.write(tabId, data));

    return { term, renderer, refit };
  }

  return { create, MONO_FONT };
})();
