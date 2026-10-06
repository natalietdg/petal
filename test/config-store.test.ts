import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeTempDirs, tmpLeftovers, useTempUserData } from './helpers';

type ConfigStore = typeof import('../src/main/config-store');

let dir: string;
let config: ConfigStore;

beforeEach(async () => {
  dir = useTempUserData();
  vi.resetModules();
  config = await import('../src/main/config-store');
});
afterEach(removeTempDirs);

const configFile = () => path.join(dir, 'config.json');

describe('config-store defaults and load', () => {
  it('has three sections with the documented defaults', () => {
    const d = config.defaults();
    expect(Object.keys(d)).toEqual(['organizer', 'flowTitles', 'responseHook']);
    expect({ ...d.organizer, prompt: undefined }).toEqual({ enabled: true, intervalMinutes: 10, perPass: 12, model: 'haiku', prompt: undefined });
    expect(d.organizer.prompt).toMatch(/^You label a Claude Code work session/);
    expect(d.flowTitles.prompt).toMatch(/^You turn a work log into STATE CHANGES/);
    expect(d.responseHook).toEqual({ command: '', notify: false });
    expect(config.MODELS).toEqual(['haiku', 'sonnet', 'opus']);
  });

  it('defaults() returns a fresh copy each time', () => {
    const a = config.defaults();
    a.organizer.perPass = 99;
    expect(config.defaults().organizer.perPass).toBe(12);
  });

  it('missing file -> defaults', () => {
    expect(fs.existsSync(configFile())).toBe(false);
    expect(config.load()).toEqual(config.defaults());
  });

  it('corrupt file -> defaults', () => {
    fs.writeFileSync(configFile(), '{not json');
    expect(config.load()).toEqual(config.defaults());
  });

  it('a partial file is filled in from defaults and invalid values fall back to defaults', () => {
    fs.writeFileSync(configFile(), JSON.stringify({ organizer: { perPass: 7, model: 'gpt-9' }, responseHook: { notify: 'yes' } }));
    const c = config.load();
    expect(c.organizer.perPass).toBe(7);
    expect(c.organizer.model).toBe('haiku');
    expect(c.organizer.intervalMinutes).toBe(10);
    expect(c.responseHook.notify).toBe(false);
  });
});

describe('config-store save validation', () => {
  it('clamps to 1 and 50, rejects an unknown model, empty prompt -> default', () => {
    const c = config.save({ organizer: { intervalMinutes: 0, perPass: 999, model: 'gpt', prompt: '   ' } });
    expect(c.organizer.intervalMinutes).toBe(1);
    expect(c.organizer.perPass).toBe(50);
    expect(c.organizer.model).toBe('haiku');
    expect(c.organizer.prompt).toBe(config.defaults().organizer.prompt);
  });

  it('interval max is 240, a non-number keeps the saved value', () => {
    config.save({ organizer: { perPass: 20 } });
    const c = config.save({ organizer: { intervalMinutes: 500, perPass: 'abc' } });
    expect(c.organizer.intervalMinutes).toBe(240);
    expect(c.organizer.perPass).toBe(20);
  });

  it('null and empty string numbers keep the saved value', () => {
    config.save({ organizer: { intervalMinutes: 30 } });
    expect(config.save({ organizer: { intervalMinutes: null } }).organizer.intervalMinutes).toBe(30);
    expect(config.save({ organizer: { intervalMinutes: '' } }).organizer.intervalMinutes).toBe(30);
  });

  it('rounds numbers, accepts every whitelisted model', () => {
    expect(config.save({ organizer: { intervalMinutes: 7.4 } }).organizer.intervalMinutes).toBe(7);
    expect(config.save({ organizer: { intervalMinutes: '12.6' } }).organizer.intervalMinutes).toBe(13);
    for (const model of config.MODELS) expect(config.save({ organizer: { model } }).organizer.model).toBe(model);
  });

  it('a bad model keeps the saved model, not the default', () => {
    config.save({ organizer: { model: 'opus' } });
    expect(config.save({ organizer: { model: 'gpt-4' } }).organizer.model).toBe('opus');
    expect(config.save({ organizer: { model: 42 } }).organizer.model).toBe('opus');
  });

  it('trims the command, non-bool notify keeps the saved value', () => {
    config.save({ responseHook: { notify: true } });
    const c = config.save({ responseHook: { command: '  echo hi  ', notify: 'yes' } });
    expect(c.responseHook.command).toBe('echo hi');
    expect(c.responseHook.notify).toBe(true);
    expect(config.save({ responseHook: { notify: false } }).responseHook.notify).toBe(false);
  });

  it('a non-string command keeps the saved command', () => {
    config.save({ responseHook: { command: 'say hi' } });
    expect(config.save({ responseHook: { command: 7 } }).responseHook.command).toBe('say hi');
  });

  it('strips trailing whitespace from prompts but keeps leading text', () => {
    const c = config.save({ organizer: { prompt: 'Be brief.\n\n  ' }, flowTitles: { prompt: '  Terse.  ' } });
    expect(c.organizer.prompt).toBe('Be brief.');
    expect(c.flowTitles.prompt).toBe('  Terse.');
  });

  it('merges into one section only and persists to disk', () => {
    config.save({ organizer: { perPass: 33 }, responseHook: { command: 'true' } });
    config.save({ organizer: { intervalMinutes: 5 } });
    const onDisk = JSON.parse(fs.readFileSync(configFile(), 'utf8')) as ReturnType<ConfigStore['load']>;
    expect(onDisk.organizer.perPass).toBe(33);
    expect(onDisk.organizer.intervalMinutes).toBe(5);
    expect(onDisk.responseHook.command).toBe('true');
    expect(config.load()).toEqual(onDisk);
  });

  it('ignores unknown sections and keys', () => {
    const c = config.save({ organizer: { perPass: 3 }, ...({ bogus: { x: 1 } } as object) });
    expect(Object.keys(c)).toEqual(['organizer', 'flowTitles', 'responseHook']);
    expect(Object.keys(c.organizer)).toEqual(['enabled', 'intervalMinutes', 'perPass', 'model', 'prompt']);
  });

  it('atomic write leaves no .tmp', () => {
    config.save({ organizer: { perPass: 4 } });
    config.save({ organizer: { perPass: 5 } });
    expect(tmpLeftovers(dir)).toEqual([]);
  });

  it('notifies onChange listeners with the saved config until unsubscribed', () => {
    const seen: number[] = [];
    const off = config.onChange((c) => seen.push(c.organizer.perPass));
    config.save({ organizer: { perPass: 8 } });
    expect(off()).toBe(true);
    config.save({ organizer: { perPass: 9 } });
    expect(seen).toEqual([8]);
  });
});

describe('config-store reset', () => {
  it('reset one key keeps the rest', () => {
    config.save({ organizer: { prompt: 'Custom style: titles in Title Case.', intervalMinutes: 45 } });
    const c = config.reset('organizer.intervalMinutes');
    expect(c.organizer.intervalMinutes).toBe(10);
    expect(c.organizer.prompt).toBe('Custom style: titles in Title Case.');
  });

  it('reset a whole section restores its defaults and leaves other sections', () => {
    config.save({ organizer: { perPass: 40, model: 'opus' }, responseHook: { command: 'echo x' } });
    const c = config.reset('organizer');
    expect(c.organizer).toEqual(config.defaults().organizer);
    expect(c.responseHook.command).toBe('echo x');
  });

  it('rejects unknown paths', () => {
    expect(() => config.reset('organizer.nope')).toThrow('Unknown setting: organizer.nope');
    expect(() => config.reset('bogus')).toThrow(/Unknown setting/);
    expect(() => config.reset('')).toThrow(/Unknown setting/);
    expect(() => config.reset('constructor')).toThrow(/Unknown setting/);
  });
});
