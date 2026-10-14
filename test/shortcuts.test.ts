// The Shortcuts guide can't drift from the menu: every accelerator the menu binds must be a row in the guide.
import { describe, expect, it } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { menuTemplate, type MenuOptions } from '../src/main/menu';
import { ACCEL, GUIDE, guideAccelerators, keyChips } from '../src/shared/shortcuts';
import { isConcludePrompt } from '../src/shared/conclusion';

const noop = (): void => undefined;
const OPTIONS = new Proxy({ currentTheme: '', currentCat: '', currentScene: '', currentReading: '' } as unknown as MenuOptions, {
  get: (target, key) => (key in target ? target[key as keyof MenuOptions] : noop),
});

function accelerators(items: MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [
    ...(typeof item.accelerator === 'string' ? [item.accelerator] : []),
    ...(Array.isArray(item.submenu) ? accelerators(item.submenu) : []),
  ]);
}

describe('Shortcuts guide', () => {
  const menu = accelerators(menuTemplate(OPTIONS));

  it('lists every menu accelerator', () => {
    expect(menu.length).toBeGreaterThan(15);
    const missing = menu.filter((accelerator) => !guideAccelerators().includes(accelerator));
    expect(missing).toEqual([]);
  });

  it('lists nothing the menu does not bind', () => {
    expect(guideAccelerators().filter((accelerator) => !menu.includes(accelerator))).toEqual([]);
  });

  it('opens from ⌘/ in the Help menu', () => {
    const help = menuTemplate(OPTIONS).find((item) => item.role === 'help');
    const item = (help?.submenu as MenuItemConstructorOptions[]).find((entry) => entry.label === 'Keyboard Shortcuts');
    expect(item?.accelerator).toBe(ACCEL.shortcuts);
    expect(menu.filter((accelerator) => accelerator === ACCEL.shortcuts)).toHaveLength(1);
  });

  it('has the five groups and a conclude word Petal really recognises', () => {
    expect(GUIDE.map((group) => group.title)).toEqual(['Views', 'Sessions', 'Reading', 'Layout', 'Words for Claude']);
    const words = GUIDE.flatMap((group) => group.rows.flatMap((row) => (row.word ? [row.word] : [])));
    expect(words.filter((word) => word.startsWith('conclude')).every(isConcludePrompt)).toBe(true);
    expect(words).toContain('/factory');
  });

  it('draws mac glyphs in menu-bar order', () => {
    expect(keyChips('CmdOrCtrl+Shift+O')).toEqual(['⇧', '⌘', 'O']);
    expect(keyChips('CmdOrCtrl+Alt+2')).toEqual(['⌥', '⌘', '2']);
    expect(keyChips('Ctrl+Shift+Tab')).toEqual(['⌃', '⇧', '⇥']);
    expect(keyChips('CmdOrCtrl+/')).toEqual(['⌘', '/']);
    expect(keyChips('Home')).toEqual(['Home']);
  });
});
