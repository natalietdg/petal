// Her customisations in <userData>/config.json: organizer, flow titles, response hook. Look stays in settings.json.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const MODELS = ['haiku', 'sonnet', 'opus'];

// The editable halves of the prompts; the JSON output contracts live in session-organizer.js and flow-titles.js.
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

const DEFAULTS = Object.freeze({
  organizer: { enabled: true, intervalMinutes: 10, perPass: 12, model: 'haiku', prompt: ORGANIZER_PROMPT },
  flowTitles: { prompt: FLOW_TITLES_PROMPT },
  responseHook: { command: '', notify: false },
});

const configFile = () => path.join(app.getPath('userData'), 'config.json');
const listeners = new Set();

const defaults = () => structuredClone(DEFAULTS);

const intIn = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && value !== '' && value !== null ? Math.min(max, Math.max(min, n)) : fallback;
};
const promptOr = (value, fallback) => (typeof value === 'string' && value.trim() ? value.replace(/\s+$/, '') : fallback);
const boolOr = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

// Numbers are clamped; anything unusable falls back to base (the saved value), an empty prompt to the default.
function validate(raw = {}, base = DEFAULTS) {
  const d = DEFAULTS;
  const b = base;
  const o = raw.organizer ?? {};
  const f = raw.flowTitles ?? {};
  const h = raw.responseHook ?? {};
  return {
    organizer: {
      enabled: boolOr(o.enabled, b.organizer.enabled),
      intervalMinutes: intIn(o.intervalMinutes, 1, 240, b.organizer.intervalMinutes),
      perPass: intIn(o.perPass, 1, 50, b.organizer.perPass),
      model: MODELS.includes(o.model) ? o.model : b.organizer.model,
      prompt: promptOr(o.prompt, d.organizer.prompt),
    },
    flowTitles: { prompt: promptOr(f.prompt, d.flowTitles.prompt) },
    responseHook: {
      command: typeof h.command === 'string' ? h.command.trim() : b.responseHook.command,
      notify: boolOr(h.notify, b.responseHook.notify),
    },
  };
}

function load() {
  try {
    return validate(JSON.parse(fs.readFileSync(configFile(), 'utf8')));
  } catch {
    return defaults();
  }
}

function write(config) {
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, file); // atomic swap: a reader never sees half a file
  for (const listener of listeners) listener(config);
  return config;
}

// patch: { organizer: { intervalMinutes: 5 } } merges into that section only.
function save(patch = {}) {
  const current = load();
  const merged = {};
  for (const section of Object.keys(DEFAULTS)) merged[section] = { ...current[section], ...(patch[section] ?? {}) };
  return write(validate(merged, current));
}

// keyPath: 'organizer.prompt' resets one value, 'organizer' a whole section.
function reset(keyPath) {
  const [section, key] = String(keyPath).split('.');
  if (!DEFAULTS[section] || (key && !(key in DEFAULTS[section]))) throw new Error(`Unknown setting: ${keyPath}`);
  const fresh = defaults()[section];
  return save({ [section]: key ? { [key]: fresh[key] } : fresh });
}

// Called with the new config after every save.
function onChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

module.exports = { load, save, reset, defaults, onChange, MODELS };
