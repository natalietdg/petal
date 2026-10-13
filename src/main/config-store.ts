// Her customisations in <userData>/config.json: organizer, flow titles, response hook, sessions, tarot birthday, first run. Look stays in settings.json.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { writeJsonAtomic } from './atomic-file';
import { clampSplit } from '../shared/reader-split';
import { isPetSize, type PetSize } from '../shared/pet-size';
import { MAX_FAVORITES } from '../shared/favorites';
import { SESSION_ID } from './session-id';
import { cleanDone, type StepId } from '../shared/get-started';
import { isFolderChoice, type FolderChoice } from '../shared/claude-folder';

// Organizer schedule bounds; Customize shows the same ranges.
const INTERVAL_MINUTES = { min: 1, max: 240 };
const PER_PASS = { min: 1, max: 50 };
export const MAX_OPEN = { min: 1, max: 50 };

export const MODELS = ['haiku', 'sonnet', 'opus'];

// Notes side panel: 'auto' opens it for sessions that already have notes, until she toggles it herself.
export const NOTES_OPEN = ['auto', 'open', 'closed'] as const;
export const NOTES_WIDTH = { min: 260, max: 520 };

export interface Config {
  organizer: { enabled: boolean; intervalMinutes: number; perPass: number; model: string; prompt: string };
  flowTitles: { prompt: string };
  responseHook: { command: string; notify: boolean };
  sessions: { maxOpen: number };
  // YYYY-MM-DD or '' when unset; never leaves this file.
  tarot: { birthdate: string };
  // The first-run screen; true once it has been shown.
  welcome: { seen: boolean };
  notesPanel: { open: (typeof NOTES_OPEN)[number]; width: number };
  // Reader share of each window, keyed by window slot (main/layout-ipc.ts).
  layout: { splits: Record<string, number> };
  // History's session list folded to a slim rail; favorites are starred session ids, oldest star first.
  history: { listCollapsed: boolean; favorites: string[] };
  // The reader's Doing / Recommend / Next strip and pinned conclusion, folded to one bar.
  reader: { bannersCollapsed: boolean };
  // The reader cat's size; the reader may shrink her below it to keep text clear.
  pet: { size: PetSize };
  // Get started steps done, by hand or seen by Petal.
  getStarted: { done: StepId[] };
  // Whether Petal may read ~/.claude; nothing there is read until 'allowed'.
  claudeFolder: { choice: FolderChoice };
}

type Section = keyof Config;

// Anything the renderer sends; validate() turns it into a Config.
export type ConfigPatch = { [S in Section]?: Partial<Record<keyof Config[S], unknown>> };

// The editable halves of the prompts; the JSON output contracts live in session-organizer.ts and flow-titles.ts.
const ORGANIZER_PROMPT = `You label a Claude Code work session so it can be found later.
Title: 3-7 words, outcome-focused, sentence case, no trailing period.
Project: a short project or area name. Reuse one of the existing names when it fits.
Status: done, in progress, or blocked.
Tags: 1-3 short topic tags, 1-2 words each. Reuse an existing tag whenever one fits; invent a new one only when none does.`;

const FLOW_TITLES_PROMPT = `You turn a work log into STATE CHANGES. For each step you get what the user asked and the reply.
List what is now different in the world: a setting, a file, an app, a design, a rule, a decision. Each change is
{"what": the thing that changed (2-4 words), "from": its old state or "" if new, "to": its new state (max 6 words)}.
A step that only answered a question, explained, or asked back changed nothing: give it "changes": [].
Also give a 3-6 word outcome title. Plain words, sentence case, no trailing periods. Never restate the request.`;

const DEFAULTS: Readonly<Config> = Object.freeze({
  organizer: { enabled: false, intervalMinutes: 10, perPass: 12, model: 'haiku', prompt: ORGANIZER_PROMPT },
  flowTitles: { prompt: FLOW_TITLES_PROMPT },
  responseHook: { command: '', notify: false },
  sessions: { maxOpen: 8 },
  tarot: { birthdate: '' },
  welcome: { seen: false },
  notesPanel: { open: 'auto' as const, width: 320 },
  layout: { splits: {} },
  history: { listCollapsed: false, favorites: [] },
  reader: { bannersCollapsed: false },
  pet: { size: 'normal' as const },
  getStarted: { done: [] as StepId[] },
  claudeFolder: { choice: 'unasked' as FolderChoice },
});

const configFile = () => path.join(app.getPath('userData'), 'config.json');
const userDataFile = (name: string) => path.join(app.getPath('userData'), name);
const listeners = new Set<(config: Config) => void>();

export const defaults = (): Config => structuredClone(DEFAULTS);

// Only a real number (or a numeric string from a form field) counts; blanks and booleans keep the saved value.
const intIn = (value: unknown, min: number, max: number, fallback: number): number => {
  const usable = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  const n = usable ? Math.round(Number(value)) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
// A missing or non-text prompt keeps the saved one; an empty one goes back to the default.
const promptOr = (value: unknown, saved: string, fallback: string): string => {
  if (typeof value !== 'string') return saved;
  return value.trim() ? value.replace(/\s+$/, '') : fallback;
};
// Slot numbers to clamped fractions; anything else in the map is dropped, a non-map keeps the saved one.
const MAX_SLOTS = 32;
const splitsOr = (value: unknown, fallback: Record<string, number>): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const usable = Object.entries(value).filter(([slot, f]) => /^\d+$/.test(slot) && Number(slot) < MAX_SLOTS && typeof f === 'number' && Number.isFinite(f));
  return Object.fromEntries(usable.map(([slot, f]) => [slot, clampSplit(f as number)]));
};
// Session ids only, each once, newest MAX_FAVORITES kept; a non-list keeps the saved one.
const favoritesOr = (value: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(value)) return fallback;
  const ids = value.filter((id): id is string => typeof id === 'string' && SESSION_ID.test(id));
  return [...new Set(ids)].slice(-MAX_FAVORITES);
};
const boolOr = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
// '' clears it; anything but a real calendar date keeps the saved one.
const birthdateOr = (value: unknown, fallback: string): string => {
  if (value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? value : fallback;
};

// Numbers are clamped; anything unusable falls back to base (the saved value), an empty prompt to the default.
function validate(raw: ConfigPatch = {}, base: Config = DEFAULTS): Config {
  const d = DEFAULTS;
  const b = base;
  const o = raw.organizer ?? {};
  const f = raw.flowTitles ?? {};
  const h = raw.responseHook ?? {};
  const s = raw.sessions ?? {};
  const t = raw.tarot ?? {};
  const w = raw.welcome ?? {};
  const n = raw.notesPanel ?? {};
  const l = raw.layout ?? {};
  const hi = raw.history ?? {};
  const rd = raw.reader ?? {};
  const pe = raw.pet ?? {};
  const gs = raw.getStarted ?? {};
  const cf = raw.claudeFolder ?? {};
  return {
    organizer: {
      enabled: boolOr(o.enabled, b.organizer.enabled),
      intervalMinutes: intIn(o.intervalMinutes, INTERVAL_MINUTES.min, INTERVAL_MINUTES.max, b.organizer.intervalMinutes),
      perPass: intIn(o.perPass, PER_PASS.min, PER_PASS.max, b.organizer.perPass),
      model: typeof o.model === 'string' && MODELS.includes(o.model) ? o.model : b.organizer.model,
      prompt: promptOr(o.prompt, b.organizer.prompt, d.organizer.prompt),
    },
    flowTitles: { prompt: promptOr(f.prompt, b.flowTitles.prompt, d.flowTitles.prompt) },
    responseHook: {
      command: typeof h.command === 'string' ? h.command.trim() : b.responseHook.command,
      notify: boolOr(h.notify, b.responseHook.notify),
    },
    sessions: { maxOpen: intIn(s.maxOpen, MAX_OPEN.min, MAX_OPEN.max, b.sessions.maxOpen) },
    tarot: { birthdate: birthdateOr(t.birthdate, b.tarot.birthdate) },
    welcome: { seen: boolOr(w.seen, b.welcome.seen) },
    notesPanel: {
      open: NOTES_OPEN.find((v) => v === n.open) ?? b.notesPanel.open,
      width: intIn(n.width, NOTES_WIDTH.min, NOTES_WIDTH.max, b.notesPanel.width),
    },
    layout: { splits: splitsOr(l.splits, b.layout.splits) },
    history: { listCollapsed: boolOr(hi.listCollapsed, b.history.listCollapsed), favorites: favoritesOr(hi.favorites, b.history.favorites) },
    reader: { bannersCollapsed: boolOr(rd.bannersCollapsed, b.reader.bannersCollapsed) },
    pet: { size: isPetSize(pe.size) ? pe.size : b.pet.size },
    getStarted: { done: Array.isArray(gs.done) ? cleanDone(gs.done) : b.getStarted.done },
    claudeFolder: { choice: isFolderChoice(cf.choice) ? cf.choice : b.claudeFolder.choice },
  };
}

// Values a saved file doesn't record yet: people who used Petal before keep the organizer on and skip the welcome.
// The folder question and Get started are new to everyone, so they start unasked and open.
function migratedBase(): Config {
  const base = defaults();
  const organized = fs.existsSync(userDataFile('organizer.json'));
  base.organizer.enabled = organized;
  base.welcome.seen = organized || ['config.json', 'settings.json'].some((name) => fs.existsSync(userDataFile(name)));
  return base;
}

function readSaved(): ConfigPatch {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as ConfigPatch) : {};
  } catch {
    return {};
  }
}

export function load(): Config {
  return validate(readSaved(), migratedBase());
}

function write(config: Config): Config {
  writeJsonAtomic(configFile(), config, 2);
  for (const listener of listeners) listener(config);
  return config;
}

const SECTIONS = Object.keys(DEFAULTS) as Section[];

// patch: { organizer: { intervalMinutes: 5 } } merges into that section only.
export function save(patch: ConfigPatch = {}): Config {
  const current = load();
  const merged: ConfigPatch = {};
  for (const section of SECTIONS) merged[section] = { ...current[section], ...(patch[section] ?? {}) };
  return write(validate(merged, current));
}

const isSection = (name: string): name is Section => Object.hasOwn(DEFAULTS, name);

// keyPath: 'organizer.prompt' resets one value, 'organizer' a whole section.
export function reset(keyPath: string): Config {
  const [section = '', key] = String(keyPath).split('.');
  if (!isSection(section) || (key && !(key in DEFAULTS[section]))) throw new Error(`Unknown setting: ${keyPath}`);
  const fresh: Record<string, unknown> = { ...defaults()[section] };
  return save({ [section]: key ? { [key]: fresh[key] } : fresh });
}

// Called with the new config after every save.
export function onChange(listener: (config: Config) => void): () => boolean {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
