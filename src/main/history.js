// Read-only index of recent Claude Code sessions, from bounded head/tail reads cached by mtime.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readHead, readTail } = require('./jsonl-window');
const { promptText, commandText, trimTo } = require('./prompts');
const { ReplyCollector } = require('./replies');
const { liveSessions } = require('./sessions-monitor');

const WINDOW_DAYS = 7;
const HEAD_BYTES = 32 * 1024;
const TAIL_BYTES = 64 * 1024;
// Big tool results can push text replies far from the end, so the preview widens its tail read.
const PREVIEW_WINDOWS = [64 * 1024, 256 * 1024, 1024 * 1024, 4 * 1024 * 1024];
const PREVIEW_REPLIES = 3;
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const cache = new Map(); // file -> { mtimeMs, size, record }

// Top-level session logs only; subagent logs live in <session>/subagents/.
function sessionFiles() {
  let projects = [];
  try {
    projects = fs.readdirSync(PROJECTS_DIR);
  } catch {
    return [];
  }
  return projects.flatMap((project) => {
    const dir = path.join(PROJECTS_DIR, project);
    try {
      return fs.readdirSync(dir)
        .filter((name) => name.endsWith('.jsonl') && SESSION_ID.test(name.slice(0, -6)))
        .map((name) => path.join(dir, name));
    } catch {
      return [];
    }
  });
}

const isMessage = (e) => (e.type === 'user' || e.type === 'assistant') && !e.isSidechain;
const lastAiTitle = (entries) => entries.filter((e) => e.type === 'ai-title' && e.aiTitle).at(-1)?.aiTitle;

function buildRecord(file, stat) {
  const head = readHead(file, HEAD_BYTES);
  const tail = head.covered ? head : readTail(file, TAIL_BYTES);
  const firstPrompt = head.entries.map((e) => promptText(e) || commandText(e)).find(Boolean) ?? '';
  const messages = head.covered
    ? head.entries.filter(isMessage).length
    : head.entries.filter(isMessage).length + tail.entries.filter(isMessage).length;
  return {
    sessionId: path.basename(file, '.jsonl'),
    file,
    cwd: head.entries.find((e) => typeof e.cwd === 'string')?.cwd ?? null,
    title: trimTo(lastAiTitle(tail.entries) ?? lastAiTitle(head.entries) ?? firstPrompt ?? '', 80),
    firstPrompt: trimTo(firstPrompt, 160),
    lastAt: stat.mtimeMs,
    messages,
    messagesExact: head.covered, // big logs are only sampled, so the count is a lower bound
  };
}

function recordFor(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.record;
  const record = buildRecord(file, stat);
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, record });
  return record;
}

const shortCwd = (cwd) => (cwd?.startsWith(os.homedir()) ? `~${cwd.slice(os.homedir().length)}` : cwd ?? '');

function listSessions() {
  const since = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const live = new Set(liveSessions().map((s) => s.sessionId));
  return sessionFiles()
    .map((file) => { try { return { file, mtime: fs.statSync(file).mtimeMs }; } catch { return null; } }) // deleted mid-scan
    .filter((entry) => entry && entry.mtime >= since)
    .map(({ file }) => recordFor(file))
    .filter((record) => record && (record.title || record.messages))
    .map((record) => ({ ...record, shortCwd: shortCwd(record.cwd), live: live.has(record.sessionId) }))
    .sort((a, b) => b.lastAt - a.lastAt);
}

const findRecord = (sessionId) => {
  if (!SESSION_ID.test(sessionId ?? '')) return null;
  const file = sessionFiles().find((f) => path.basename(f, '.jsonl') === sessionId);
  return file ? recordFor(file) : null;
};

// Last three assistant replies, reading at most 4MB from the end, never the whole of a big file.
function preview(sessionId) {
  const record = findRecord(sessionId);
  if (!record) return { replies: [], wholeFile: true, missing: true };
  let replies = [];
  let wholeFile = false;
  for (const bytes of PREVIEW_WINDOWS) {
    const tail = readTail(record.file, bytes);
    const collector = new ReplyCollector(PREVIEW_REPLIES);
    for (const entry of tail.entries) collector.add(entry);
    replies = collector.newestFirst();
    wholeFile = tail.covered;
    if (replies.length >= PREVIEW_REPLIES || wholeFile) break;
  }
  return { replies, wholeFile };
}

const isLive = (sessionId) => liveSessions().some((s) => s.sessionId === sessionId);

module.exports = { WINDOW_DAYS, listSessions, findRecord, preview, isLive, SESSION_ID };
