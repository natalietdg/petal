// The Shortcuts guide: every key, word and gesture Petal answers to. The menu (main/menu.ts) takes its keys from ACCEL,
// and test/shortcuts.test.ts fails when a menu accelerator is missing here.
import themesJson from '../themes.json';
import { READING_CHOICES } from './reading-choices';

export const ACCEL = {
  settings: 'CmdOrCtrl+,',
  newTab: 'CmdOrCtrl+T',
  newWindow: 'CmdOrCtrl+N',
  openRepo: 'CmdOrCtrl+O',
  nextTab: 'CmdOrCtrl+Shift+]',
  previousTab: 'CmdOrCtrl+Shift+[',
  nextTabCtrl: 'Ctrl+Tab',
  previousTabCtrl: 'Ctrl+Shift+Tab',
  closeTab: 'CmdOrCtrl+W',
  closeWindow: 'CmdOrCtrl+Shift+W',
  minimiseTerminal: 'CmdOrCtrl+R',
  minimiseHeaders: 'CmdOrCtrl+Shift+H',
  history: 'CmdOrCtrl+Y',
  board: 'CmdOrCtrl+Shift+O',
  focus: 'CmdOrCtrl+Shift+F',
  shortcuts: 'CmdOrCtrl+/',
  stopClaude: 'CmdOrCtrl+.',
  biggerText: 'CmdOrCtrl+=',
  biggerTextPlus: 'CmdOrCtrl+Plus',
  smallerText: 'CmdOrCtrl+-',
  actualSize: 'CmdOrCtrl+0',
} as const;

export const themeAccelerator = (index: number): string => `CmdOrCtrl+${index + 1}`;
export const readingAccelerator = (index: number): string => `CmdOrCtrl+Alt+${index + 1}`; // ⇧⌘3 and ⇧⌘4 belong to macOS screenshots

const GLYPHS: Record<string, string> = {
  CmdOrCtrl: '⌘', Cmd: '⌘', Command: '⌘', Ctrl: '⌃', Control: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧',
  Plus: '+', Tab: '⇥', Enter: '↩', Return: '↩', Escape: 'Esc', Up: '↑', Down: '↓', Left: '←', Right: '→', PageUp: 'PgUp', PageDown: 'PgDn',
};
const MODIFIER_ORDER = ['⌃', '⌥', '⇧', '⌘']; // the order the macOS menu bar draws them

// 'CmdOrCtrl+Shift+O' -> ['⇧', '⌘', 'O']
export function keyChips(accelerator: string): string[] {
  const parts = accelerator.split(/\+(?!$)/).map((part) => GLYPHS[part] ?? (part.length === 1 ? part.toUpperCase() : part));
  const modifiers = parts.filter((part) => MODIFIER_ORDER.includes(part)).sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  return [...modifiers, ...parts.filter((part) => !MODIFIER_ORDER.includes(part))];
}

export type GuideGroupTitle = 'Views' | 'Sessions' | 'Reading' | 'Layout' | 'Words for Claude';

// One row: key combos (each a run of chips; several mean "or"), a word to type, or a mouse gesture.
export interface GuideRow {
  keys?: readonly (readonly string[])[];
  word?: string;
  gesture?: string;
  does: string;
  accelerators?: readonly string[]; // menu accelerators the row stands for
}

export interface GuideGroup {
  title: GuideGroupTitle;
  rows: readonly GuideRow[];
}

const menuRow = (does: string, ...accelerators: string[]): GuideRow => ({ keys: accelerators.map(keyChips), does, accelerators });
const keyRow = (does: string, ...combos: string[]): GuideRow => ({ keys: combos.map(keyChips), does });

const THEME_LABELS = Object.values(themesJson).map((theme) => theme.label);
const themeAccelerators = THEME_LABELS.map((_, index) => themeAccelerator(index));

export const GUIDE: readonly GuideGroup[] = [
  {
    title: 'Views',
    rows: [
      menuRow('This guide', ACCEL.shortcuts),
      menuRow('History', ACCEL.history),
      menuRow('Sessions board', ACCEL.board),
      menuRow('Focus: only the reply', ACCEL.focus),
      menuRow('Settings (Customize)', ACCEL.settings),
      menuRow('Open a repo', ACCEL.openRepo),
      keyRow('Fold History’s list (History open)', 'CmdOrCtrl+\\'),
      keyRow('Close the open view or Focus', 'Escape'),
    ],
  },
  {
    title: 'Sessions',
    rows: [
      menuRow('New Claude tab', ACCEL.newTab),
      menuRow('New window', ACCEL.newWindow),
      menuRow('Next tab', ACCEL.nextTab, ACCEL.nextTabCtrl),
      menuRow('Previous tab', ACCEL.previousTab, ACCEL.previousTabCtrl),
      menuRow('Close tab', ACCEL.closeTab),
      menuRow('Close window', ACCEL.closeWindow),
      menuRow('Stop Claude while it works (Esc in the terminal)', ACCEL.stopClaude),
      keyRow('Send from the reply box', 'Enter'),
      keyRow('New line in the reply box', 'Shift+Enter'),
      keyRow('Move between Board cards', 'Up', 'Down', 'Left', 'Right'),
      { word: 'cd repo-name', does: 'In the reply box with no Claude running: finds that repo' },
      { gesture: 'Drop files on the terminal or reply box', does: 'Types their paths, quoted' },
      { gesture: 'Paste an image', does: 'Attaches it for Claude' },
    ],
  },
  {
    title: 'Reading',
    rows: [
      ...READING_CHOICES.map(([, label], index) => menuRow(label, readingAccelerator(index))),
      { keys: [[...keyChips(themeAccelerator(0)).slice(0, -1), `1–${THEME_LABELS.length}`]], does: `Theme: ${THEME_LABELS.join(', ')}`, accelerators: themeAccelerators },
      menuRow('Bigger text: the terminal when it has focus, else the reader', ACCEL.biggerText, ACCEL.biggerTextPlus),
      menuRow('Smaller text', ACCEL.smallerText),
      menuRow('Actual size', ACCEL.actualSize),
      { gesture: 'Click the bar above the status lines', does: 'Folds the status lines and conclusion' },
    ],
  },
  {
    title: 'Layout',
    rows: [
      menuRow('Minimise the terminal', ACCEL.minimiseTerminal),
      menuRow('Minimise the headers', ACCEL.minimiseHeaders),
      { gesture: 'Drag the divider', does: 'Resizes; to the bottom minimises the terminal' },
      { gesture: 'Double-click the divider', does: 'Resets the split' },
      keyRow('Move the focused divider', 'Up', 'Down', 'PageUp', 'PageDown', 'Home', 'End'),
    ],
  },
  {
    title: 'Words for Claude',
    rows: [
      { word: 'conclude', does: 'Pins the Conclusion / Result / Impact banner, then ends the session after the reply' },
      { word: 'conclude: note', does: 'Pins the banner with your note; the session stays open' },
      { word: '/factory', does: 'Follows the stations you set in Workflow › Factory' },
      { word: 'Doing: · Recommend: · Next:', does: 'Lines Claude starts this way show in the status strip' },
    ],
  },
];

// Every accelerator the guide covers, for the drift test and the snapshot.
export const guideAccelerators = (): string[] => GUIDE.flatMap((group) => group.rows.flatMap((row) => row.accelerators ?? []));
