import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeTempDirs, useTempUserData } from './helpers';

let dir: string;

beforeEach(() => {
  dir = useTempUserData();
  vi.resetModules();
});
afterEach(removeTempDirs);

const writeSettings = (fields: Record<string, string>) => fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(fields));

describe('scene settings', () => {
  it('a saved bakery scene loads as the izakaya that replaced it', async () => {
    writeSettings({ scene: 'bakery' });
    const look = await import('../src/main/look');
    expect(look.settings().scene).toBe('izakaya');
  });

  it('other saved scenes load unchanged', async () => {
    writeSettings({ scene: 'tarot' });
    const look = await import('../src/main/look');
    expect(look.settings().scene).toBe('tarot');
  });
});

describe('reading style settings', () => {
  it('lists Magazine · Print fourth, so the View menu gives it ⌘⇧4', async () => {
    const { READING_CHOICES } = await import('../src/main/menu');
    expect(READING_CHOICES.map(([id]) => id)).toEqual(['newspaper', 'editorial', 'lifestyle', 'print']);
    expect(READING_CHOICES[3]).toEqual(['print', 'Magazine · Print']);
  });

  it('accepts print and rejects unknown ids', async () => {
    const { isReadingChoice } = await import('../src/main/menu');
    expect(isReadingChoice('print')).toBe(true);
    expect(isReadingChoice('lifestyle')).toBe(true);
    expect(isReadingChoice('broadsheet')).toBe(false);
    expect(isReadingChoice('')).toBe(false);
  });

  it('a saved print choice loads back as print', async () => {
    writeSettings({ reading: 'print' });
    const look = await import('../src/main/look');
    expect(look.settings().reading).toBe('print');
  });

  it('an unknown saved reading style falls back to newspaper', async () => {
    writeSettings({ reading: 'broadsheet' });
    const look = await import('../src/main/look');
    expect(look.settings().reading).toBe('newspaper');
  });
});
