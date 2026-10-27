import type { ITheme } from '@xterm/xterm';
import type { Theme } from '../shared/types';

const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const;

// WCAG AA: xterm darkens or lightens any colour below this, incl. Claude Code's truecolor white on cream.
export const MIN_CONTRAST = 4.5;

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

// Code review syntax colours: one hue per token kind; worst case 4.86:1 on any theme's added, removed or context line.
const SYNTAX_LIGHT = { keyword: '#AD0057', string: '#145A22', number: '#0A4F96', function: '#5B2BA3', type: '#065C64', attr: '#853A00', comment: '#4F5761' };
const SYNTAX_DARK = { keyword: '#FF9088', string: '#8EE59A', number: '#7CC4FF', function: '#D7AEFF', type: '#5FD8E0', attr: '#FFB066', comment: '#A3ACB7' };
const syntaxVars = (dark: boolean): Record<string, string> =>
  Object.fromEntries(Object.entries(dark ? SYNTAX_DARK : SYNTAX_LIGHT).map(([kind, colour]) => [`--syn-${kind}`, colour]));

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
    ...syntaxVars(dark),
  };
  for (const [name, label] of Object.entries(reader.labels)) {
    vars[`--${name}-pill`] = label.pill;
    vars[`--${name}-ink`] = label.ink;
    vars[`--${name}-wash`] = label.wash;
  }
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(vars)) root.setProperty(name, value);
}
