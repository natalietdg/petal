import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { MIN_CONTRAST, toXterm } from './theme';
import { noteTerminalRows } from './layout';
import { pathsFromUriList, quotePaths } from '../shared/quote-path';
import { TERMINAL_FONT } from '../shared/text-size';
import type { TabId, Theme } from '../shared/types';

export const MONO_FONT = 'Atkinson Hyperlegible Mono';

export type RendererKind = 'webgl' | 'dom';

let fontSize = TERMINAL_FONT.initial; // new tabs open at the saved size (renderer/text-size.ts)

// ⌘= ⌘+ ⌘- ⌘0 belong to View › Bigger / Smaller Text / Actual Size, never to the shell.
const TEXT_SIZE_KEYS = new Set(['=', '+', '-', '0']);
const isTextSizeKey = (event: KeyboardEvent): boolean => event.metaKey && !event.ctrlKey && !event.altKey && TEXT_SIZE_KEYS.has(event.key);

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

// Now and after xterm's viewport catches up with the new size: its scroll sync can pull the view back up a line.
export function pinToBottom(term: Terminal): void {
  term.scrollToBottom();
  requestAnimationFrame(() => term.scrollToBottom());
}

// One xterm per tab; its pty output is routed in by tabs.ts.
export function create(container: HTMLElement, theme: Theme, tabId: TabId): TermView {
  const term = new Terminal({
    fontFamily: `"${MONO_FONT}", monospace`,
    fontSize,
    lineHeight: 1.5,
    letterSpacing: 1,
    fontWeight: 400,
    fontWeightBold: 700,
    cursorStyle: 'bar',
    cursorBlink: false,
    macOptionIsMeta: true,
    theme: toXterm(theme),
    minimumContrastRatio: MIN_CONTRAST,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon((_event, url) => window.pastel.openLink(url)));
  term.open(container);
  const renderer = loadRenderer(term);

  // Hidden pane (reader-only) has no size; fitting it would collapse the grid.
  const refit = () => {
    if (container.offsetHeight <= 0) return;
    const buffer = term.buffer.active;
    const atBottom = buffer.viewportY >= buffer.baseY;
    fit.fit();
    if (atBottom) pinToBottom(term); // reflowing a long scrollback can leave the view short of the bottom
    const screen = container.querySelector<HTMLElement>('.xterm-screen');
    if (screen && term.rows > 0) noteTerminalRows(term.rows, screen.offsetHeight / term.rows);
  };
  new ResizeObserver(refit).observe(container);
  refit();

  term.attachCustomKeyEventHandler((event) => !isTextSizeKey(event));
  term.onResize(({ cols, rows }) => window.pastel.resize(tabId, { cols, rows }));
  term.onData((data) => window.pastel.write(tabId, data));
  wireFiles(container, term, tabId);

  return { term, renderer, refit };
}

export const setNewTabFontSize = (px: number): void => { fontSize = px; };

// The new size refits the grid, so the pty resizes and Claude Code redraws; a view at the bottom stays there.
export function setFontSize({ term, refit }: Pick<TermView, 'term' | 'refit'>, px: number): void {
  if (term.options.fontSize === px) return;
  const buffer = term.buffer.active;
  const atBottom = buffer.viewportY >= buffer.baseY;
  term.options.fontSize = px;
  refit(); // a hidden tab refits when it is activated
  if (atBottom) pinToBottom(term);
}
