#!/usr/bin/env node
// Petal's test lock: a Claude Code PreToolUse hook. Petal copies it to <repo>/.petal/test-lock.mjs when the lock is on.
// Reads <repo>/.petal/lock.json and refuses edits to a task's tests and suite from any session but that task's testing agent.
// No network. A missing or broken manifest lets everything through (fail open) and notes why in .petal/lock.log.
// Each refusal is a line in .petal/lock-refusals.jsonl (last 200 kept): agents' show in their lane, others in the lock bar.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const DEFAULT_NAMES = { tester: 'Testing agent', fixer: 'Bug fix agent' };

// Test-looking paths: test folders, *.test.* / *.spec.* files, Go and Python test files, Maestro flows, Petal's own folder.
const TEST_PATH = /(^|\/)(tests?|__tests__|e2e|spec|\.maestro)\/|\.(test|spec)\.[a-z0-9]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$|^\.petal\//;
export const isTestPath = (rel) => TEST_PATH.test(rel);

// Runner setup the testing agent may add: conftest, runner configs and setup files, and the manifests holding test scripts.
// Shared app config, so other sessions may edit them too; their edits are noted in .petal/lock.log. package.json and
// pyproject.toml are whole files: JSON and TOML keys can't be locked one by one.
const TEST_CONFIG = /(^|\/)(conftest\.py|pytest\.ini|tox\.ini|setup\.cfg|pyproject\.toml|package\.json|(jest|vitest|playwright|cypress|karma)\.(config|setup|workspace)\.[a-z0-9.]+|karma\.conf\.[a-z]+|setupTests\.[a-z]+|\.mocharc(\.[a-z]+)?)$/;
export const isTestConfig = (rel) => TEST_CONFIG.test(rel);

const REFUSALS_KEPT = 200;

const nameOf = (manifest, role) => {
  const name = manifest?.names?.[role];
  return typeof name === 'string' && name.trim() ? name.trim() : DEFAULT_NAMES[role];
};

// Repo-relative with forward slashes; null when outside the repo.
// Links resolved (macOS /var is /private/var), so the repo and a path into it compare alike; a missing tail is kept as written.
function real(p) {
  try { return fs.realpathSync(p); } catch { const up = path.dirname(p); return up === p ? p : path.join(real(up), path.basename(p)); }
}

export function relPath(file, root, cwd = root) {
  if (typeof file !== 'string' || !file) return null;
  const rel = path.relative(real(root), real(path.resolve(cwd, file))).split(path.sep).join('/');
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel;
}

const SUITE = /^\.petal\/suites\/([\w-]+)\.json$/;
const isLocked = (manifest, rel) => rel.startsWith('.petal/suites/') || (manifest.lockedPaths ?? []).includes(rel);

// The task a locked file belongs to: a suite file's name, else the manifest's owner; null for a file no task owns yet.
const ownerOf = (manifest, rel) => SUITE.exec(rel)?.[1] ?? manifest.owners?.[rel] ?? null;

// Shell steps, split on && || ; | and newlines.
const steps = (command) => command.split(/&&|\|\||;|\||\n/).map((s) => s.trim()).filter(Boolean);

// Does this shell line write to `target` (repo-relative)? sed -i, a redirect onto it, tee, rm, mv, truncate, cp onto it, git checkout/restore.
export function bashWrites(command, target, root) {
  const names = [target, path.join(root, target)];
  const mentions = (text) => names.some((n) => text.includes(n));
  for (const step of steps(command)) {
    if (!mentions(step)) continue;
    const words = step.split(/\s+/).filter((w) => !/^\w+=/.test(w));
    const program = words[0] === 'sudo' ? words[1] : words[0];
    if (program === 'sed' && words.some((w) => /^-[a-zA-Z]*i/.test(w) || w === '--in-place')) return true;
    if (/>>?\s*['"]?([^\s'"]+)/.test(step) && [...step.matchAll(/>>?\s*['"]?([^\s'"]+)/g)].some((m) => mentions(m[1]))) return true;
    if (program === 'tee' || ['rm', 'mv', 'truncate', 'unlink'].includes(program)) return true;
    if (program === 'cp' && mentions(words[words.length - 1] ?? '')) return true;
    if (program === 'git' && ['checkout', 'restore', 'rm', 'mv'].includes(words[1])) return true;
  }
  return false;
}

// The decision for one PreToolUse call: null lets it through, a string is the reason it is refused.
// A testing agent edits unowned tests and its own task's; another task's are refused.
export function decide(input, manifest, root) {
  if (!manifest || typeof manifest !== 'object' || !input || typeof input !== 'object') return null;
  const session = manifest.sessions?.[input.session_id];
  const role = session?.role ?? null;
  const tester = nameOf(manifest, 'tester');
  const fixer = nameOf(manifest, 'fixer');
  const testsBelong = `Tests belong to ${tester}. Ask it to change them.`;
  const otherTask = (rel) => `${rel} belongs to another task's ${tester}. Ask that one to change it.`;
  const othersFile = (rel) => role === 'tester' && ownerOf(manifest, rel) !== null && ownerOf(manifest, rel) !== session.taskId;
  const tool = input.tool_name;
  const toolInput = input.tool_input ?? {};
  if (EDIT_TOOLS.has(tool)) {
    const rel = relPath(toolInput.file_path ?? toolInput.notebook_path, root, input.cwd ?? root);
    if (rel === null) return null;
    const locked = isLocked(manifest, rel);
    if (role === 'tester') {
      if (othersFile(rel)) return otherTask(rel);
      return locked || isTestPath(rel) || isTestConfig(rel) ? null : `${tester} only changes tests and the suite. App code belongs to ${fixer}.`;
    }
    if (role === 'fixer') return locked || isTestPath(rel) ? testsBelong : null;
    return locked ? testsBelong : null;
  }
  if (tool === 'Bash' && typeof toolInput.command === 'string') {
    const targets = [...(manifest.lockedPaths ?? [])];
    if (toolInput.command.includes('.petal/suites/')) targets.push(...[...toolInput.command.matchAll(/\.petal\/suites\/[\w-]+\.json/g)].map((m) => m[0]));
    const guarded = role === 'tester' ? targets.filter(othersFile) : targets;
    const hit = guarded.find((t) => bashWrites(toolInput.command, t, root));
    if (hit) return role === 'tester' ? otherTask(hit) : testsBelong;
  }
  return null;
}

// A test-config edit by a session that isn't a testing agent: let through, worth a line in the lock log.
export function configNote(input, manifest, root) {
  if (!manifest || typeof manifest !== 'object' || !input || !EDIT_TOOLS.has(input.tool_name)) return null;
  if (manifest.sessions?.[input.session_id]?.role === 'tester') return null;
  const rel = relPath(input.tool_input?.file_path ?? input.tool_input?.notebook_path, root, input.cwd ?? root);
  return rel !== null && isTestConfig(rel) ? `${input.session_id ?? 'a session'} edited test config ${rel}` : null;
}

// Appends one refusal and keeps the newest REFUSALS_KEPT lines.
export function logRefusal(file, entry) {
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  if (lines.length > REFUSALS_KEPT) fs.writeFileSync(file, `${lines.slice(-REFUSALS_KEPT).join('\n')}\n`);
}

// The repo holding .petal/lock.json: the one this script sits in (<repo>/.petal/), else Claude Code's project folder,
// else the call's folder walked up.
function findRoot(input) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (path.basename(here) === '.petal' && fs.existsSync(path.join(here, 'lock.json'))) return path.dirname(here);
  const start = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.petal', 'lock.json'))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

function note(root, text) {
  try { fs.appendFileSync(path.join(root, '.petal', 'lock.log'), `${new Date().toISOString()} ${text}\n`); } catch { /* nowhere to note it */ }
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { raw += chunk; });
  process.stdin.on('end', () => {
    let input;
    try { input = JSON.parse(raw); } catch { process.exit(0); }
    const root = findRoot(input);
    if (!root) process.exit(0);
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(root, '.petal', 'lock.json'), 'utf8'));
    } catch (error) {
      note(root, `lock.json unreadable, letting the call through: ${error.message}`);
      process.exit(0);
    }
    const reason = decide(input, manifest, root);
    if (!reason) {
      const noted = configNote(input, manifest, root);
      if (noted) note(root, noted);
      process.exit(0);
    }
    const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? input.tool_input?.command ?? '';
    try { logRefusal(path.join(root, '.petal', 'lock-refusals.jsonl'), { at: Date.now(), session: input.session_id, tool: input.tool_name, target: String(target).slice(0, 300), reason }); } catch { /* the refusal still stands */ }
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
    process.exit(0);
  });
}

if (process.argv[1] && real(path.resolve(process.argv[1])) === real(fileURLToPath(import.meta.url))) main(); // run as the hook, not imported
