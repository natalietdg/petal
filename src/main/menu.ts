import { Menu, type MenuItemConstructorOptions } from 'electron';
import themesJson from '../themes.json';
import type { Choice, Themes } from '../shared/types';

const themes: Themes = themesJson;

// Art lives in renderer/cat-art.ts; ids here must match its CATS keys.
export const CAT_CHOICES: readonly Choice[] = [['mika', 'Mika'], ['miki', 'Miki'], ['kira', 'Kira'], ['corgi', 'Corgi']];
// Ids match SCENES in renderer/scenes.js; 'none' shows the cat alone.
export const SCENE_CHOICES: readonly Choice[] = [
  ['none', 'No Scene'], ['cherry', 'Sakura Picnic'], ['beach', 'Seaside Afternoon'], ['night', 'City Lights'], ['starlit', 'Starlit Window'],
  ['planetarium', 'Planetarium'], ['rug', 'Autumn Reading Nook'], ['winter', 'Snowy Hearth'], ['bakery', 'Corner Bakery'], ['howl', "Wizard's Loft"],
  ['study', "Wizard's Study"], ['midcentury', 'Vinyl Lounge'],
];
// Ids match the data-reading values styled in renderer/magazine.css and print.css; order sets ⌥⌘1–4.
export const READING_CHOICES: readonly Choice[] = [
  ['newspaper', 'Newspaper'], ['editorial', 'Magazine · Editorial'], ['lifestyle', 'Magazine · Lifestyle'], ['print', 'Magazine · Print'],
];
export const isReadingChoice = (id: string): boolean => READING_CHOICES.some(([choice]) => choice === id);

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
  onOpenSettings: () => void;
  onOpenRepo: () => void;
}

export function buildMenu({ currentTheme, onThemeSelected, currentCat, onCatSelected, currentScene, onSceneSelected, currentReading, onReadingSelected, onNewWindow, onNewTab, onCloseTab, onCycleTab, onToggleReader, onToggleHistory, onOpenSettings, onOpenRepo }: MenuOptions): void {
  const themeItems: MenuItemConstructorOptions[] = Object.entries(themes).map(([id, theme], index) => ({
    label: theme.label,
    type: 'radio',
    checked: id === currentTheme,
    accelerator: `CmdOrCtrl+${index + 1}`,
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
    accelerator: `CmdOrCtrl+Alt+${index + 1}`, // ⇧⌘3 and ⇧⌘4 belong to macOS screenshots
    click: () => onReadingSelected(id),
  }));

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Petal', // macOS titles the first menu with the app name either way
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: onOpenSettings },
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
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: onNewTab },
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: onNewWindow },
        { label: 'Open Repo…', accelerator: 'CmdOrCtrl+O', click: onOpenRepo },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'CmdOrCtrl+Shift+]', click: () => onCycleTab(1) },
        { label: 'Previous Tab', accelerator: 'CmdOrCtrl+Shift+[', click: () => onCycleTab(-1) },
        // Ctrl+Tab too, as in Safari and Terminal.
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => onCycleTab(1), visible: false, acceleratorWorksWhenHidden: true },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => onCycleTab(-1), visible: false, acceleratorWorksWhenHidden: true },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: onCloseTab },
        { role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Reader Only / Split', accelerator: 'CmdOrCtrl+R', click: onToggleReader },
        { label: 'History', accelerator: 'CmdOrCtrl+Y', click: onToggleHistory },
        { type: 'separator' },
        ...readingItems,
      ],
    },
    { label: 'Theme', submenu: themeItems },
    { label: 'Pet', submenu: [...catItems, { type: 'separator' }, { label: 'Scene', submenu: sceneItems }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
