import type { ITheme } from '@xterm/xterm';
import type { Theme } from '../shared/types';

const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const;

export function toXterm({ terminal }: Theme): ITheme {
  const xtermTheme: ITheme = {
    background: terminal.background,
    foreground: terminal.foreground,
    cursor: terminal.cursor,
    cursorAccent: terminal.background,
    selectionBackground: terminal.selectionBackground,
  };
  ANSI_KEYS.forEach((key, i) => { xtermTheme[key] = terminal.ansi[i]; });
  return xtermTheme;
}

export function applyCssVars({ terminal, reader, dark }: Theme): void {
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'; // scrollbars and form controls
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'; // lets CSS adjust the pixel art at night
  const vars: Record<string, string> = {
    '--term-bg': terminal.background,
    '--reader-bg': reader.background,
    '--reader-fg': reader.foreground,
    '--muted': reader.muted,
    '--link': reader.link,
    '--code-bg': reader.codeBackground,
    '--highlight': reader.highlight,
    '--highlight-ink': reader.highlightInk,
    '--rule': reader.rule,
  };
  for (const [name, label] of Object.entries(reader.labels)) {
    vars[`--${name}-pill`] = label.pill;
    vars[`--${name}-ink`] = label.ink;
    vars[`--${name}-wash`] = label.wash;
  }
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(vars)) root.setProperty(name, value);
}
