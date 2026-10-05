// Stored Outcome Flows: made on demand, kept in <userData>/flows/<sessionId>.json, never under ~/.claude.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { flowFor } = require('./flow');
const { toMermaid } = require('./flow-mermaid');
const { writeTitles } = require('./flow-titles');

// Bump when the extracted shape changes; older files then read as stale, not broken.
const FLOW_VERSION = 6; // 6: flow is a list of state changes
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

const flowsDir = () => path.join(app.getPath('userData'), 'flows');
const fileFor = (sessionId) => (SAFE_ID.test(sessionId) ? path.join(flowsDir(), `${sessionId}.json`) : null);

function load(sessionId) {
  const file = fileFor(sessionId);
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const has = (sessionId) => Boolean(fileFor(sessionId) && fs.existsSync(fileFor(sessionId)));

// Stale when the log has grown or changed since the flow was made, or the format moved on.
function isStale(stored, transcriptFile) {
  if (stored.version !== FLOW_VERSION) return true;
  try {
    const { size, mtimeMs } = fs.statSync(transcriptFile);
    return size > stored.source.size || mtimeMs > stored.source.mtimeMs;
  } catch {
    return false; // log gone: keep showing what was stored
  }
}

async function createNow({ sessionId, title, cwd, transcriptFile, theme }) {
  const file = fileFor(sessionId);
  if (!file) throw new Error('Unsafe session id');
  const { size, mtimeMs } = fs.statSync(transcriptFile); // before parsing, so later writes read as stale
  const flow = structuredClone(await flowFor(transcriptFile)); // titles are written onto a copy, not the parse cache
  const titling = await writeTitles(flow.steps);
  for (const step of flow.steps) delete step.excerpt;
  const stored = {
    version: FLOW_VERSION,
    sessionId,
    title,
    cwd,
    createdAt: new Date().toISOString(),
    source: { path: transcriptFile, size, mtimeMs },
    steps: flow.steps,
    finalNext: flow.finalNext,
    titledBy: titling.ok ? 'claude-haiku' : 'rules',
    mermaid: { latest: toMermaid(flow, theme), all: toMermaid(flow, theme, { all: true }) },
  };
  fs.mkdirSync(flowsDir(), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(stored));
  fs.renameSync(tmp, file); // atomic swap: readers never see a half-written flow
  return stored;
}

// One create per session at a time: a second click (or a refresh) joins the running one.
const pending = new Map(); // sessionId -> promise
function create(args) {
  if (!pending.has(args.sessionId)) {
    pending.set(args.sessionId, createNow(args).finally(() => pending.delete(args.sessionId)));
  }
  return pending.get(args.sessionId);
}
const isCreating = (sessionId) => pending.has(sessionId);

module.exports = { FLOW_VERSION, load, has, isStale, create, isCreating, fileFor };
