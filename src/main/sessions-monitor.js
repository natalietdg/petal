// Read-only overview of every live Claude Code session on this Mac.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSessionFile, transcriptPath, SESSIONS_DIR } = require('./claude-session');
const { recentActivity } = require('./activity');

const SHOWN_KINDS = new Set(['interactive', 'bg']);
const SUBAGENT_WINDOW_MS = 2 * 60 * 1000;
const RECENT_COUNT = 5;

// Session files outlive their process; signal 0 only checks it exists.
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function liveSessions() {
  let names = [];
  try {
    names = fs.readdirSync(SESSIONS_DIR).filter((name) => /^\d+\.json$/.test(name));
  } catch {
    return [];
  }
  return names
    .map((name) => readSessionFile(Number(name.slice(0, -5))))
    .filter((s) => s && SHOWN_KINDS.has(s.kind) && isAlive(s.pid))
    .sort((a, b) => (b.status === 'busy') - (a.status === 'busy') || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

const shortCwd = (cwd) => (cwd.startsWith(os.homedir()) ? `~${cwd.slice(os.homedir().length)}` : cwd);

function activeSubagents(session) {
  const dir = path.join(path.dirname(transcriptPath(session)), session.sessionId, 'subagents');
  try {
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => ({ name, file: path.join(dir, name), mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
      .filter(({ mtime }) => Date.now() - mtime < SUBAGENT_WINDOW_MS)
      .map(({ name, file, mtime }) => ({
        id: name.replace(/^agent-|\.jsonl$/g, ''),
        updatedAt: mtime,
        activity: recentActivity(file, 1)[0]?.text ?? 'Working',
      }));
  } catch {
    return [];
  }
}

// Collapsed pill needs counts only; the open panel reads jsonl tails.
function snapshot({ detailed, expandedIds = [], ownSessionId = null }) {
  const sessions = liveSessions();
  const counts = { total: sessions.length, busy: sessions.filter((s) => s.status === 'busy').length };
  if (!detailed) return { counts };

  const expanded = new Set(expandedIds);
  const rows = sessions.map((s) => {
    const recent = recentActivity(transcriptPath(s), RECENT_COUNT);
    return {
      sessionId: s.sessionId,
      name: s.name || shortCwd(s.cwd),
      cwd: shortCwd(s.cwd),
      kind: s.kind,
      status: s.status === 'busy' ? 'busy' : 'idle',
      updatedAt: s.updatedAt ?? null,
      isOwn: s.sessionId === ownSessionId,
      activity: recent.at(-1)?.text ?? '',
      recent: expanded.has(s.sessionId) ? recent.map((a) => a.text).reverse() : [],
      subagents: expanded.has(s.sessionId) ? activeSubagents(s) : [],
    };
  });
  return { counts, rows };
}

module.exports = { snapshot, liveSessions };
