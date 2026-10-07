import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { toXterm } from './theme';
import { pathsFromUriList, quotePaths } from '../shared/quote-path';
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

// Ctrl+V makes Claude Code read the clipboard itself, so a pasted image arrives as [Image #n].
const CTRL_V = '\x16';

// A paste that is only an image (a screenshot), with no text to type.
export const isImageOnly = (data: DataTransfer | null): boolean =>
  Boolean(data) && !data?.getData('text/plain') && [...(data?.items ?? [])].some((item) => item.kind === 'file' && item.type.startsWith('image/'));

const carriesFiles = (data: DataTransfer | null): boolean => Boolean(data?.types.includes('Files') || data?.types.includes('text/uri-list'));

// Absolute paths of dropped files; Finder gives Files, other apps may give only file:// URLs.
export function droppedPaths(data: DataTransfer | null): string[] {
  if (!data) return [];
  const fromFiles = [...data.files].map((file) => window.pastel.pathForFile(file)).filter(Boolean);
  return fromFiles.length ? fromFiles : pathsFromUriList(data.getData('text/uri-list'));
}

// Lets a drop land: without preventDefault on dragover, the browser never fires drop.
export function acceptFileDrags(target: HTMLElement): void {
  target.addEventListener('dragover', (event) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
}

// Paste and drop on the terminal: an image becomes Claude's Ctrl+V, files become quoted paths.
function wireFiles(container: HTMLElement, term: Terminal, tabId: TabId): void {
  // Capture phase, so xterm's own paste handler never sees an image-only paste.
  container.addEventListener('paste', (event) => {
    if (!isImageOnly(event.clipboardData)) return;
    event.preventDefault();
    event.stopPropagation();
    window.pastel.write(tabId, CTRL_V);
  }, { capture: true });
  acceptFileDrags(container);
  container.addEventListener('drop', (event) => {
    const paths = droppedPaths(event.dataTransfer);
    if (!paths.length) return;
    event.preventDefault();
    term.paste(`${quotePaths(paths)} `);
    term.focus();
  });
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
  wireFiles(container, term, tabId);

  return { term, renderer, refit };
}
