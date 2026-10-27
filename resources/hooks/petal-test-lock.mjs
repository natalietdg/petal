#!/usr/bin/env node
// Petal's test lock: a Claude Code PreToolUse hook, one for every repo. Petal copies it to ~/.petal/test-lock.mjs and
// registers it in ~/.claude/settings.json when she turns a lock on. A repo is locked when ~/.petal/repos/<repoKey>/lock.json
// exists (repoKey: its path with every non-alphanumeric as "-"); nothing is read or written in the repo itself.
// Any session may add to or fix a locked test; deleting, skipping or weakening one is refused.
// No network. A missing or broken manifest lets everything through (fail open) and notes why in that folder's lock.log.
// Each refusal is a line in its lock-refusals.jsonl (last 200 kept): agents' show in their lane, others in the lock bar.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

// Test-looking paths: test folders, *.test.* / *.spec.* files, Go and Python test files, Maestro flows, Petal's own folder.
const TEST_PATH = /(^|\/)(tests?|__tests__|e2e|spec|\.maestro)\/|\.(test|spec)\.[a-z0-9]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$|^\.petal\//;
export const isTestPath = (rel) => TEST_PATH.test(rel);

// Runner setup the testing agent may add: conftest, runner configs and setup files, and the manifests holding test scripts.
// Shared app config, so other sessions may edit them too; their edits are noted in lock.log. package.json and
// pyproject.toml are whole files: JSON and TOML keys can't be locked one by one.
const TEST_CONFIG = /(^|\/)(conftest\.py|pytest\.ini|tox\.ini|setup\.cfg|pyproject\.toml|package\.json|(jest|vitest|playwright|cypress|karma)\.(config|setup|workspace)\.[a-z0-9.]+|karma\.conf\.[a-z]+|setupTests\.[a-z]+|\.mocharc(\.[a-z]+)?)$/;
export const isTestConfig = (rel) => TEST_CONFIG.test(rel);

const REFUSALS_KEPT = 200;

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

const isLocked = (manifest, rel) => (manifest.lockedPaths ?? []).includes(rel);

// Weakening, the same rules as src/shared/test-lock.ts: a skip marker added, or fewer tests or assertions than before.
const SKIP = /\b(?:it|test|describe|context)\.(?:skip|todo)\b|\b(?:xit|xtest|xdescribe|xcontext)\s*\(|@pytest\.mark\.(?:skip|xfail)\b|\bpytest\.skip\s*\(|\bt\.Skip(?:Now|f)?\s*\(|@(?:Disabled|Ignore)\b|\bskip\s*:\s*true\b/g;
const TESTS = /(?<![.\w$])(?:it|test|describe)(?:\.(?:only|each\([^)]*\)))?\s*\(|\bdef\s+test_\w*|\bfunc\s+Test\w*|@Test\b|-\s+(?:tapOn|assertVisible|launchApp)\b/g;
const ASSERTS = /\bexpect\s*\(|\bassert(?:\w*\s*\(|\.\w+\s*\(|\s)|\.should\b|\bt\.(?:Error|Fatal)f?\s*\(|\brequire\.\w+\s*\(|\bXCTAssert\w*|-\s+assert\w+\b/g;
const count = (text, pattern) => text.match(pattern)?.length ?? 0;

export function weakens(before, after) {
  if (after === null) return 'deleted';
  if (count(after, SKIP) > count(before, SKIP)) return 'skipped';
  if (count(after, TESTS) < count(before, TESTS)) return 'removed a test';
  if (count(after, ASSERTS) < count(before, ASSERTS)) return 'removed an assertion';
  return null;
}

// The file's text after this edit; null when it can't be worked out (the edit is then let through for the integrity check).
export function textAfter(tool, toolInput, before) {
  if (tool === 'Write') return typeof toolInput.content === 'string' ? toolInput.content : null;
  const edits = tool === 'MultiEdit' ? toolInput.edits : [toolInput];
  if (!Array.isArray(edits)) return null;
  let text = before;
  for (const e of edits) {
    if (typeof e?.old_string !== 'string' || typeof e?.new_string !== 'string' || !text.includes(e.old_string)) return null;
    text = e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, () => e.new_string);
  }
  return text;
}

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

// The decision for one PreToolUse call: null lets it through, a string is the reason it is refused. The same rule for
// every session: a locked test may change, never be deleted, skipped or weakened.
export function decide(input, manifest, root) {
  if (!manifest || typeof manifest !== 'object' || !input || typeof input !== 'object') return null;
  const tool = input.tool_name;
  const toolInput = input.tool_input ?? {};
  const refuse = (rel, why) => `${rel} is a locked test: this change ${why === 'deleted' ? 'deletes it' : why === 'skipped' ? 'skips it' : `weakens it (${why})`}. Ask the user before deleting, skipping or weakening a test.`;
  if (EDIT_TOOLS.has(tool)) {
    const rel = relPath(toolInput.file_path, root, input.cwd ?? root);
    if (rel === null || !isLocked(manifest, rel)) return null;
    let before;
    try { before = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } // a new file weakens nothing
    const after = textAfter(tool, toolInput, before);
    const why = after === null ? null : weakens(before, after);
    return why ? refuse(rel, why) : null;
  }
  if (tool === 'Bash' && typeof toolInput.command === 'string') {
    const hit = (manifest.lockedPaths ?? []).find((t) => bashWrites(toolInput.command, t, root));
    if (hit) return `${hit} is a locked test. Change it with the Edit tool so the lock can check it; deleting or overwriting it from the shell isn't allowed.`;
  }
  return null;
}

// A test-config edit: let through, worth a line in the lock log.
export function configNote(input, manifest, root) {
  if (!manifest || typeof manifest !== 'object' || !input || !EDIT_TOOLS.has(input.tool_name)) return null;
  const rel = relPath(input.tool_input?.file_path, root, input.cwd ?? root);
  return rel !== null && isTestConfig(rel) ? `${input.session_id ?? 'a session'} edited test config ${rel}` : null;
}

// Appends one refusal and keeps the newest REFUSALS_KEPT lines.
export function logRefusal(file, entry) {
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  if (lines.length > REFUSALS_KEPT) fs.writeFileSync(file, `${lines.slice(-REFUSALS_KEPT).join('\n')}\n`);
}

export const repoKey = (dir) => path.resolve(dir).replace(/[^A-Za-z0-9]/g, '-');

// The locked repo the call is in: Claude Code's project folder, else the call's folder, walked up until a folder has a
// lock.json in reposDir. { root, store }, or null when no repo up the tree is locked.
export function findLocked(input, reposDir) {
  const start = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    for (const candidate of new Set([dir, real(dir)])) {
      const store = path.join(reposDir, repoKey(candidate));
      if (fs.existsSync(path.join(store, 'lock.json'))) return { root: candidate, store };
    }
    if (path.dirname(dir) === dir) return null;
  }
}

function note(store, text) {
  try { fs.appendFileSync(path.join(store, 'lock.log'), `${new Date().toISOString()} ${text}\n`); } catch { /* nowhere to note it */ }
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { raw += chunk; });
  process.stdin.on('end', () => {
    let input;
    try { input = JSON.parse(raw); } catch { process.exit(0); }
    const found = findLocked(input, path.join(path.dirname(fileURLToPath(import.meta.url)), 'repos'));
    if (!found) process.exit(0);
    const { root, store } = found;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(store, 'lock.json'), 'utf8'));
    } catch (error) {
      note(store, `lock.json unreadable, letting the call through: ${error.message}`);
      process.exit(0);
    }
    if (manifest?.enabled !== true) process.exit(0); // one hook serves every repo: only a lock she turned on counts
    const reason = decide(input, manifest, root);
    if (!reason) {
      const noted = configNote(input, manifest, root);
      if (noted) note(store, noted);
      process.exit(0);
    }
    const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? input.tool_input?.command ?? '';
    try { logRefusal(path.join(store, 'lock-refusals.jsonl'), { at: Date.now(), session: input.session_id, tool: input.tool_name, target: String(target).slice(0, 300), reason }); } catch { /* the refusal still stands */ }
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
    process.exit(0);
  });
}

if (process.argv[1] && real(path.resolve(process.argv[1])) === real(fileURLToPath(import.meta.url))) main(); // run as the hook, not imported
