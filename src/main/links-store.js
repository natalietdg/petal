// Handoff log: which session was sent to, resumed or forked from which, kept in <userData>/links.json.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const KINDS = new Set(['send', 'resume', 'fork']);
const MAX_LINKS = 1000; // oldest drop off; the view only reads the last week
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const storeFile = () => path.join(app.getPath('userData'), 'links.json');
const idOrNull = (id) => (SESSION_ID.test(id ?? '') ? id : null); // null = a fresh tab with no session yet

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    return Array.isArray(data) ? data.filter((l) => l && KINDS.has(l.kind)) : [];
  } catch {
    return [];
  }
}

function save(links) {
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(links, null, 1));
  fs.renameSync(tmp, file); // atomic swap: the view never reads a half-written file
}

// Never throws: a failed log write must not break the send or resume it records.
function addLink({ from, to, kind }) {
  if (!KINDS.has(kind) || (!idOrNull(to) && !idOrNull(from))) return null;
  const link = { from: idOrNull(from), to: idOrNull(to), kind, at: new Date().toISOString() };
  try {
    save([...load(), link].slice(-MAX_LINKS));
  } catch (error) {
    console.error('[petal] links log skipped:', error.message);
    return null;
  }
  return link;
}

module.exports = { load, addLink, KINDS };
