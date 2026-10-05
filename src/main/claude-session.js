// Finds the Claude Code process running inside our shell and its session log.
// ~/.claude/sessions/<pid>.json is undocumented, so every read is defensive.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');

// Claude Code names project folders after the cwd with every non-alphanumeric as '-'.
const projectSlug = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

function listProcesses() {
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-Ao', 'pid=,ppid=,comm='], (error, stdout) => {
      if (error) return resolve([]);
      resolve(stdout.split('\n').map((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
        return match && { pid: Number(match[1]), ppid: Number(match[2]), comm: match[3].trim() };
      }).filter(Boolean));
    });
  });
}

// "claude" or ".../bin/claude"; helpers show up as "claude bg-spare" / "claude bg-pty-host".
const isClaudeCli = (comm) => path.basename(comm) === 'claude';

function descendants(rootPid, processes) {
  const found = [];
  const queue = [rootPid];
  while (queue.length) {
    const parent = queue.shift();
    for (const proc of processes) {
      if (proc.ppid === parent) {
        found.push(proc);
        queue.push(proc.pid);
      }
    }
  }
  return found;
}

// Parsed ~/.claude/sessions/<pid>.json, or null when missing or malformed.
function readSessionFile(pid) {
  try {
    const session = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, `${pid}.json`), 'utf8'));
    if (typeof session.sessionId !== 'string' || typeof session.cwd !== 'string') return null;
    return { ...session, pid };
  } catch {
    return null;
  }
}

const transcriptPath = ({ cwd, sessionId }) => path.join(CLAUDE_DIR, 'projects', projectSlug(cwd), `${sessionId}.jsonl`);

// { pid, session } for the claude under shellPid. session is null until its file is readable.
async function findClaudeSession(shellPid) {
  const candidates = descendants(shellPid, await listProcesses()).filter((proc) => isClaudeCli(proc.comm));
  for (const proc of candidates) {
    const session = readSessionFile(proc.pid);
    if (session) return { pid: proc.pid, session: { ...session, transcript: transcriptPath(session) } };
  }
  return candidates.length ? { pid: candidates[0].pid, session: null } : { pid: null, session: null };
}

module.exports = { findClaudeSession, readSessionFile, transcriptPath, SESSIONS_DIR };
