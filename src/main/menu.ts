import { Menu, type MenuItemConstructorOptions } from 'electron';
import themesJson from '../themes.json';
import { LOCAL_CATS } from '../shared/local-cats';
import { READING_CHOICES } from '../shared/reading-choices';
import { ACCEL, readingAccelerator, themeAccelerator } from '../shared/shortcuts';
import type { TextStep } from '../shared/text-size';
import type { Choice, Themes } from '../shared/types';

const themes: Themes = themesJson;

// Art lives in renderer/cat-art.ts; ids here must match its CATS keys. Private local cats follow.
export const CAT_CHOICES: readonly Choice[] = [
  ['mika', 'Mika'], ['miki', 'Miki'], ['kira', 'Kira'], ['hoshi', 'Hoshi'], ['corgi', 'Corgi'],
  ...LOCAL_CATS.map(({ id, pet }): Choice => [id, pet.name]),
];
// Ids match SCENES in renderer/scenes.js; 'none' shows the cat alone.
export const SCENE_CHOICES: readonly Choice[] = [
  ['none', 'No Scene'], ['cherry', 'Cherry Blossom Picnic'], ['beach', 'Seaside Afternoon'], ['night', 'City Lights'], ['starlit', 'Starlit Window'],
  ['planetarium', 'Planetarium'], ['rug', 'Autumn Reading Nook'], ['winter', 'Snowy Hearth'], ['izakaya', 'Izakaya'], ['howl', "Wizard's Loft"],
  ['study', "Wizard's Study"], ['midcentury', 'Vinyl Lounge'], ['tarot', 'Tarot Room'],
];
export { READING_CHOICES, isReadingChoice } from '../shared/reading-choices';

export interface MenuOptions {
  currentTheme: string;
  onThemeSelected: (id: string) => void;
  currentCat: string;
  onCatSelected: (id: string) => void;
  currentScene: string;
  onSceneSelected: (id: string) => void;
  currentReading: string;
  onReadingSelected: (id: string) => void;
  onNewWindow: () => void;
  onNewTab: () => void;
  onCloseTab: () => void;
  onCycleTab: (delta: number) => void;
  onToggleReader: () => void;
  onToggleHistory: () => void;
  onToggleBoard: () => void;
  onToggleFocus: () => void;
  onToggleHeaders: () => void;
  onTextSize: (step: TextStep) => void;
  onStopClaude: () => void;
  onOpenSettings: () => void;
  onOpenWelcome: () => void;
  onOpenGetStarted: () => void;
  onOpenPetGuide: () => void;
  onOpenColourKey: () => void;
  onToggleShortcuts: () => void;
  onOpenRepo: () => void;
  onCheckForUpdates: () => void;
}

// Pure, so the Shortcuts guide's drift test can read every accelerator without Electron.
export function menuTemplate({ currentTheme, onThemeSelected, currentCat, onCatSelected, currentScene, onSceneSelected, currentReading, onReadingSelected, onNewWindow, onNewTab, onCloseTab, onCycleTab, onToggleReader, onToggleHistory, onToggleBoard, onToggleFocus, onToggleHeaders, onTextSize, onStopClaude, onOpenSettings, onOpenWelcome, onOpenGetStarted, onOpenPetGuide, onOpenColourKey, onToggleShortcuts, onOpenRepo, onCheckForUpdates }: MenuOptions): MenuItemConstructorOptions[] {
  const themeItems: MenuItemConstructorOptions[] = Object.entries(themes).map(([id, theme], index) => ({
    label: theme.label,
    type: 'radio',
    checked: id === currentTheme,
    accelerator: themeAccelerator(index),
    click: () => onThemeSelected(id),
  }));

  const catItems: MenuItemConstructorOptions[] = CAT_CHOICES.map(([id, label]) => ({
    label,
    type: 'radio',
    checked: id === currentCat,
    click: () => onCatSelected(id),
  }));

  const sceneItems: MenuItemConstructorOptions[] = SCENE_CHOICES.map(([id, label]) => ({
    label,
    type: 'radio',
    checked: id === currentScene,
    click: () => onSceneSelected(id),
  }));

  const readingItems: MenuItemConstructorOptions[] = READING_CHOICES.map(([id, label], index) => ({
    label,
    type: 'radio',
    checked: id === currentReading,
    accelerator: readingAccelerator(index),
    click: () => onReadingSelected(id),
  }));

  return [
    {
      label: 'Petal', // macOS titles the first menu with the app name either way
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: onCheckForUpdates },
        { type: 'separator' },
        { label: 'Settings…', accelerator: ACCEL.settings, click: onOpenSettings },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Shell',
      submenu: [
        { label: 'New Tab', accelerator: ACCEL.newTab, click: onNewTab },
        { label: 'New Window', accelerator: ACCEL.newWindow, click: onNewWindow },
        { label: 'Open Repo…', accelerator: ACCEL.openRepo, click: onOpenRepo },
        { type: 'separator' },
        { label: 'Stop Claude', accelerator: ACCEL.stopClaude, click: onStopClaude },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: ACCEL.nextTab, click: () => onCycleTab(1) },
        { label: 'Previous Tab', accelerator: ACCEL.previousTab, click: () => onCycleTab(-1) },
        // Ctrl+Tab too, as in Safari and Terminal.
        { label: 'Next Tab', accelerator: ACCEL.nextTabCtrl, click: () => onCycleTab(1), visible: false, acceleratorWorksWhenHidden: true },
        { label: 'Previous Tab', accelerator: ACCEL.previousTabCtrl, click: () => onCycleTab(-1), visible: false, acceleratorWorksWhenHidden: true },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: ACCEL.closeTab, click: onCloseTab },
        { role: 'close', label: 'Close Window', accelerator: ACCEL.closeWindow },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Minimise Terminal', accelerator: ACCEL.minimiseTerminal, click: onToggleReader },
        { label: 'Minimise Headers', accelerator: ACCEL.minimiseHeaders, click: onToggleHeaders },
        { label: 'History', accelerator: ACCEL.history, click: onToggleHistory },
        { label: 'Sessions Board', accelerator: ACCEL.board, click: onToggleBoard },
        { label: 'Focus on Reply', accelerator: ACCEL.focus, click: onToggleFocus },
        { type: 'separator' },
        // Acts on the terminal when it has focus, otherwise the reader (renderer/text-size.ts).
        { label: 'Bigger Text', accelerator: ACCEL.biggerText, click: () => onTextSize(1) },
        { label: 'Bigger Text', accelerator: ACCEL.biggerTextPlus, click: () => onTextSize(1), visible: false, acceleratorWorksWhenHidden: true },
        { label: 'Smaller Text', accelerator: ACCEL.smallerText, click: () => onTextSize(-1) },
        { label: 'Actual Size', accelerator: ACCEL.actualSize, click: () => onTextSize(0) },
        { type: 'separator' },
        ...readingItems,
      ],
    },
    { label: 'Theme', submenu: themeItems },
    { label: 'Pet', submenu: [...catItems, { type: 'separator' }, { label: 'Scene', submenu: sceneItems }] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Welcome', click: onOpenWelcome }, { label: 'Show setup again', click: onOpenPetGuide }, { label: 'Setup checklist', click: onOpenGetStarted }, { label: 'Colour key', click: onOpenColourKey }, { type: 'separator' }, { label: 'Keyboard Shortcuts', accelerator: ACCEL.shortcuts, click: onToggleShortcuts }] },
  ];
}

export function buildMenu(options: MenuOptions): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(options)));
}
