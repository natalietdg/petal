import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { toXterm } from './theme';
import type { TabId, Theme } from '../shared/types';

export const MONO_FONT = 'Atkinson Hyperlegible Mono';

export type RendererKind = 'webgl' | 'dom';

export interface TermView {
  term: Terminal;
  renderer: RendererKind;
  refit: () => void;
}

function loadRenderer(term: Terminal): RendererKind {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose()); // falls back to the DOM renderer
    term.loadAddon(webgl);
    return 'webgl';
  } catch {
    return 'dom';
  }
}

// One xterm per tab; its pty output is routed in by tabs.ts.
export function create(container: HTMLElement, theme: Theme, tabId: TabId): TermView {
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
    theme: toXterm(theme),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon((_event, url) => window.pastel.openLink(url)));
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
