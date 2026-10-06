// Background titling and grouping of recent sessions, kept in <userData>/organizer.json, never under ~/.claude.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { app } = require('electron');
const history = require('./history');
const tagsStore = require('./tags-store');
const { runClaude } = require('./claude-cli');
const configStore = require('./config-store');
const { promptText, commandText } = require('./prompts');
const { assistantText } = require('./replies');

const FIRST_RUN_DELAY_MS = 20_000;
const BUSY_WINDOW_MS = 2 * 60 * 1000; // a Petal session written to this recently is still mid-conversation
const RECENT_TURNS = 6;
const PROMPT_CHARS = 500;
const REPLY_CHARS = 300;
const DIGEST_CHARS = 6000;
const MAX_PROJECT_HINTS = 30;
const MAX_TAG_HINTS = 40;
const MAX_TAGS = 3;
const STATUSES = new Set(['done', 'in progress', 'blocked']);

const storeFile = () => path.join(app.getPath('userData'), 'organizer.json');

let timers = [];
let running = null; // the pass in flight, shared by every caller
let openSessionIds = () => [];
let schedule = null; // { enabled, intervalMinutes } the timers were set for
let lastPass = null; // { at, titled, failed, due } shown on the Customize page
let unsubscribe = null; // stops listening for config edits

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function save(store) {
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 1));
  fs.renameSync(tmp, file); // atomic swap: History never reads a half-written file
}

const squash = (text, max) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Streams the jsonl, keeping the first prompt and only the newest turns in memory.
async function readDigestTurns(file) {
  let first = null;
  let count = 0;
  const recent = [];
  const lines = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) {
    let entry;
    try { entry = line ? JSON.parse(line) : null; } catch { entry = null; }
    if (!entry) continue;
    const prompt = promptText(entry) || commandText(entry);
    if (prompt) {
      count += 1;
      first ??= prompt;
      recent.push({ prompt, reply: '' });
      if (recent.length > RECENT_TURNS) recent.shift();
      continue;
    }
    const reply = recent.at(-1);
    if (reply && reply.reply.length < REPLY_CHARS) reply.reply += ` ${assistantText(entry) ?? ''}`;
  }
  return { first, count, recent };
}

function buildDigest({ first, count, recent }) {
  const parts = [`First request: ${squash(first, PROMPT_CHARS)}`];
  if (count > recent.length) parts.push(`(${count - recent.length} turns omitted)`);
  for (const turn of recent) {
    parts.push(`User: ${squash(turn.prompt, PROMPT_CHARS)}`);
    if (turn.reply.trim()) parts.push(`Claude: ${squash(turn.reply, REPLY_CHARS)}`);
  }
  return parts.join('\n').slice(0, DIGEST_CHARS);
}

const quoted = (names) => (names.length ? names.map((n) => `"${n}"`).join(', ') : '(none yet)');

// Her editable instructions first, then the fixed JSON contract parseLabel relies on.
function promptFor(instructions, digest, cwd, projects, tags) {
  return `${instructions}

Answer with JSON only, no prose:
{"title": "<title>", "project": "<project>", "status": "done" | "in progress" | "blocked", "tags": ["<tag>"]}
Existing projects: ${quoted(projects)}
Existing tags: ${quoted(tags)}

Folder: ${cwd ?? 'unknown'}
Session:
${digest}`;
}

// Pulls the {...} out of the reply even if the model wraps it in prose or a fence.
function parseLabel(stdout) {
  const text = String(JSON.parse(stdout).result ?? '');
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const title = squash(json.title, 80).replace(/\.$/, '');
  if (!title) throw new Error('No title in reply');
  const status = String(json.status ?? '').toLowerCase().trim();
  const tags = (Array.isArray(json.tags) ? json.tags : []).map((t) => squash(t, 24)).filter(Boolean).slice(0, MAX_TAGS);
  return { title, project: squash(json.project, 40) || null, status: STATUSES.has(status) ? status : 'in progress', tags };
}

function projectNames(store) {
  const counts = new Map();
  for (const entry of Object.values(store)) if (entry?.project) counts.set(entry.project, (counts.get(entry.project) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, MAX_PROJECT_HINTS).map(([name]) => name);
}

// Organizer-owned and never tagged yet; her manual sessions are never due for tags.
const needsTags = (session, tags) => !tags.sessions[session.sessionId];

function needsLabel(session, store, tags, openIds) {
  const entry = store[session.sessionId];
  if (entry && entry.mtimeMs === session.lastAt && !needsTags(session, tags)) return false;
  return !(openIds.has(session.sessionId) && Date.now() - session.lastAt < BUSY_WINDOW_MS);
}

async function labelOne(session, store, { prompt, model }) {
  const { mtimeMs } = fs.statSync(session.file); // before reading, so later writes count as a change
  const turns = await readDigestTurns(session.file);
  if (!turns.first) throw new Error('No prompts in transcript');
  const hints = tagsStore.names().slice(0, MAX_TAG_HINTS); // deleted names are never in this list
  const { tags: suggested, ...label } = parseLabel(await runClaude(promptFor(prompt, buildDigest(turns), session.cwd, projectNames(store), hints), { model }));
  const previous = store[session.sessionId];
  const unchanged = previous && previous.mtimeMs === mtimeMs; // tag-only backfill keeps the title she already saw
  store[session.sessionId] = unchanged ? previous : { ...label, mtimeMs, at: new Date().toISOString() };
  save(store); // per session, so a crash mid-pass keeps what was already done
  tagsStore.applyOrganizerTags(session.sessionId, suggested); // a no-op once she has edited this session's tags
}

async function pass(limit) {
  if (!require('./claude-cli').claudePath()) return { titled: 0, failed: 0, due: 0, skipped: 'no claude' };
  const settings = configStore.load().organizer; // read per pass, so edits apply to the next one
  const store = load();
  const tags = tagsStore.load();
  const openIds = new Set(openSessionIds());
  const due = history.listSessions().filter((s) => needsLabel(s, store, tags, openIds)).slice(0, limit);
  const result = { titled: 0, failed: 0, due: due.length };
  for (const session of due) { // one at a time: never fan out CLI calls
    try {
      await labelOne(session, store, settings);
      result.titled += 1;
    } catch (error) {
      result.failed += 1; // retried next pass
      console.error(`[petal] organizer skipped ${session.sessionId}:`, String(error.message ?? error).split('\n')[0]);
    }
  }
  return result;
}

function runNow({ limit = configStore.load().organizer.perPass } = {}) {
  running ??= pass(limit)
    .then((result) => { lastPass = { at: new Date().toISOString(), ...result }; return result; })
    .finally(() => { running = null; });
  return running;
}

const isRunning = () => Boolean(running);

function clearTimers() {
  for (const timer of timers) clearTimeout(timer); // clearTimeout clears intervals too
  timers = [];
}

// firstRun: the delayed pass at launch; a reschedule after an edit only resets the interval.
function setTimers({ enabled, intervalMinutes }, { firstRun = false } = {}) {
  clearTimers();
  schedule = { enabled, intervalMinutes };
  if (!enabled) return;
  timers = [setInterval(runNow, intervalMinutes * 60 * 1000)];
  if (firstRun) timers.push(setTimeout(runNow, FIRST_RUN_DELAY_MS));
}

function start({ openSessionIds: getOpenIds } = {}) {
  if (schedule) return;
  if (getOpenIds) openSessionIds = getOpenIds;
  setTimers(configStore.load().organizer, { firstRun: true });
  unsubscribe = configStore.onChange(({ organizer }) => {
    if (schedule && (organizer.enabled !== schedule.enabled || organizer.intervalMinutes !== schedule.intervalMinutes)) setTimers(organizer);
  });
}

function stop() {
  clearTimers();
  unsubscribe?.();
  unsubscribe = null;
  schedule = null;
}

const status = () => ({ lastPass, running: isRunning(), schedule });

module.exports = { start, stop, runNow, load, isRunning, status, promptFor };
