const { Menu } = require('electron');
const themes = require('../themes.json');

// Art lives in renderer/cat.js; ids here must match its CATS keys.
const CAT_CHOICES = [['mika', 'Mika'], ['miki', 'Miki'], ['kira', 'Kira'], ['corgi', 'Corgi']];
// Ids match SCENES in renderer/scenes.js; 'none' shows the cat alone.
const SCENE_CHOICES = [
  ['none', 'No Scene'], ['cherry', 'Sakura Picnic'], ['beach', 'Seaside Afternoon'], ['night', 'Starlit Window'],
  ['rug', 'Autumn Reading Nook'], ['winter', 'Snowy Hearth'], ['bakery', 'Corner Bakery'], ['howl', "Wizard's Loft"], ['study', "Wizard's Study"],
  ['midcentury', 'Vinyl Lounge'],
];
// Ids match the data-reading values styled in renderer/magazine.css.
const READING_CHOICES = [['newspaper', 'Newspaper'], ['editorial', 'Magazine · Editorial'], ['lifestyle', 'Magazine · Lifestyle']];

function buildMenu({ currentTheme, onThemeSelected, currentCat, onCatSelected, currentScene, onSceneSelected, currentReading, onReadingSelected, onNewWindow, onNewTab, onCloseTab, onCycleTab, onToggleReader, onToggleHistory, onOpenSettings }) {
  const themeItems = Object.entries(themes).map(([id, theme], index) => ({
    label: theme.label,
    type: 'radio',
    checked: id === currentTheme,
    accelerator: `CmdOrCtrl+${index + 1}`,
    click: () => onThemeSelected(id),
  }));

  const catItems = CAT_CHOICES.map(([id, label]) => ({
    label,
    type: 'radio',
    checked: id === currentCat,
    click: () => onCatSelected(id),
  }));

  const sceneItems = SCENE_CHOICES.map(([id, label]) => ({
    label,
    type: 'radio',
    checked: id === currentScene,
    click: () => onSceneSelected(id),
  }));

  const readingItems = READING_CHOICES.map(([id, label], index) => ({
    label,
    type: 'radio',
    checked: id === currentReading,
    accelerator: `CmdOrCtrl+Shift+${index + 1}`,
    click: () => onReadingSelected(id),
  }));

  const template = [
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

module.exports = { buildMenu, CAT_CHOICES, SCENE_CHOICES, READING_CHOICES };
