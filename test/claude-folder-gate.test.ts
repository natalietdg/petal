// Petal reads nothing under ~/.claude until she allows it: one gate (main/claude-folder.ts), and every reader goes through it.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';

const MAIN = path.join(__dirname, '..', 'src', 'main');
const source = (file: string) => fs.readFileSync(path.join(MAIN, file), 'utf8');
const mainFiles = () => fs.readdirSync(MAIN).filter((f) => f.endsWith('.ts'));
const GATE = /\b(claudeFolderAllowed|allowedClaudeHome)\(/;

// The modules that read under ~/.claude; each asks the gate itself.
const READERS = ['claude-session.ts', 'claude-fallback.ts', 'sessions-monitor.ts', 'history.ts', 'reader-feed.ts', 'conclusions-store.ts', 'agents-ipc.ts', 'workflow-ipc.ts', 'customize-ipc.ts', 'factory-ipc.ts', 'slash-ipc.ts', 'library-ipc.ts', 'library-extract.ts', 'library-backfill.ts', 'testing-ipc.ts'];
// claudeHome() without the gate: a path only, never read. claude-cli checks an install spot exists; claude-session names a log's path.
const UNGATED_PATH_USERS = ['claude-cli.ts', 'claude-session.ts', 'claude-folder.ts', 'reply-image-ipc.ts'];
// reply-image-ipc asks the gate per request and names the folder only to refuse pictures in it; reply-image.ts is handed that answer.
const GATE_PASSED_IN = { file: 'reply-image.ts', field: /\bclaudeAllowed\b/ };

// The one allowed exception: the repo-level project skill (<repo>/.claude/skills/...), not ~/.claude.
// Only this exact string, only in factory-store.ts; any other mention of .claude there still counts.
const REPO_SKILL_EXCEPTION = { file: 'factory-store.ts', text: "'.claude/skills/factory/SKILL.md'" };
const NAMES_CLAUDE_FOLDER = /['"`]\.claude['"`/]/;

function namesClaudeFolder(file: string, text: string): boolean {
  const code = text.replace(/^\s*\/\/.*$/gm, '');
  const allowed = file === REPO_SKILL_EXCEPTION.file ? code.split(REPO_SKILL_EXCEPTION.text).join('') : code;
  return NAMES_CLAUDE_FOLDER.test(allowed);
}

describe('the ~/.claude gate, by source', () => {
  it('only claude-folder.ts names the folder', () => {
    const naming = mainFiles().filter((f) => namesClaudeFolder(f, source(f)));
    expect(naming).toEqual(['claude-folder.ts']);
  });

  it('the repo-skill exception is that exact path in factory-store.ts only', () => {
    expect(source(REPO_SKILL_EXCEPTION.file)).toContain(REPO_SKILL_EXCEPTION.text);
    expect(namesClaudeFolder('factory-store.ts', `const p = ${REPO_SKILL_EXCEPTION.text};`)).toBe(false);
    expect(namesClaudeFolder('factory-store.ts', "path.join(os.homedir(), '.claude')")).toBe(true);
    expect(namesClaudeFolder('factory-store.ts', "'.claude/settings.json'")).toBe(true);
    expect(namesClaudeFolder('history.ts', `const p = ${REPO_SKILL_EXCEPTION.text};`)).toBe(true);
  });

  it('nothing outside main builds a path to it', () => {
    for (const dir of ['renderer', 'shared']) {
      const root = path.join(MAIN, '..', dir);
      const files = fs.readdirSync(root).filter((f) => f.endsWith('.ts'));
      for (const f of files) expect(fs.readFileSync(path.join(root, f), 'utf8')).not.toMatch(/os\.homedir\(\)|['"]\.claude['"]/);
    }
  });

  it('every reader asks the gate', () => {
    for (const file of READERS) expect(source(file), file).toMatch(GATE);
  });

  it('every module that takes a path into the folder also asks the gate, except the path-only ones', () => {
    const takesPath = /\b(claudeHome|allowedClaudeHome|sessionsDir|transcriptPath|subagentsDir)\b/;
    const offenders = mainFiles()
      .filter((f) => !UNGATED_PATH_USERS.includes(f) && f !== GATE_PASSED_IN.file && takesPath.test(source(f)) && !GATE.test(source(f)));
    expect(offenders).toEqual([]);
    expect(source(GATE_PASSED_IN.file)).toMatch(GATE_PASSED_IN.field);
    expect(source('reply-image-ipc.ts')).toMatch(GATE);
  });

  it('claudeHome() is used bare only where the path is never read', () => {
    const bare = mainFiles().filter((f) => /\bclaudeHome\(\)/.test(source(f)));
    expect(bare.sort()).toEqual([...UNGATED_PATH_USERS].sort());
  });
});

describe('the ~/.claude gate, by behaviour', () => {
  let home: string;
  let userData: string;

  beforeEach(async () => {
    vi.resetModules();
    process.env.PASTEL_SNAPSHOT = '1'; // lets the stand-in folder replace ~/.claude
    userData = useTempUserData();
    home = tempDir('petal-fake-claude-');
    fs.mkdirSync(path.join(home, 'sessions'));
    fs.writeFileSync(path.join(home, 'sessions', '4242.json'), JSON.stringify({ sessionId: 'aaaaaaaa-0000-4000-8000-000000000001', cwd: '/tmp/x', kind: 'interactive', status: 'idle' }));
    fs.mkdirSync(path.join(home, 'projects', '-tmp-x'), { recursive: true });
    fs.writeFileSync(path.join(home, 'projects', '-tmp-x', 'aaaaaaaa-0000-4000-8000-000000000001.jsonl'), `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } })}\n`);
    const mode = await import('../src/main/snapshot-mode');
    mode.folderFixture.home = home;
  });

  afterEach(() => {
    delete process.env.PASTEL_SNAPSHOT;
    vi.restoreAllMocks();
    removeTempDirs();
  });

  const choose = (choice: string) => fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ claudeFolder: { choice } }));

  // Every fs call whose path is inside the stand-in folder.
  function watchReads(): string[] {
    const seen: string[] = [];
    for (const name of ['readFileSync', 'readdirSync', 'statSync', 'existsSync', 'openSync'] as const) {
      const real = fs[name] as (...args: unknown[]) => unknown;
      vi.spyOn(fs, name).mockImplementation(((...args: unknown[]) => {
        if (String(args[0]).startsWith(home)) seen.push(`${name} ${String(args[0])}`);
        return real.apply(fs, args);
      }) as never);
    }
    return seen;
  }

  it('unasked and declined read nothing there; the readers come back empty', async () => {
    for (const choice of ['unasked', 'declined']) {
      vi.resetModules();
      const mode = await import('../src/main/snapshot-mode');
      mode.folderFixture.home = home;
      choose(choice);
      const seen = watchReads();
      const session = await import('../src/main/claude-session');
      const monitor = await import('../src/main/sessions-monitor');
      const history = await import('../src/main/history');
      const gate = await import('../src/main/claude-folder');
      expect(gate.claudeFolderAllowed()).toBe(false);
      expect(gate.allowedClaudeHome()).toBeNull();
      expect(session.readSessionFile(4242)).toBeNull();
      expect(monitor.liveSessions()).toEqual([]);
      expect(history.listSessions()).toEqual([]);
      expect(history.findRecord('aaaaaaaa-0000-4000-8000-000000000001')).toBeNull();
      expect(seen).toEqual([]);
      vi.restoreAllMocks();
    }
  });

  it('allowed reads the folder, and a later save turns it off again at once', async () => {
    choose('allowed');
    const seen = watchReads();
    const session = await import('../src/main/claude-session');
    const history = await import('../src/main/history');
    const config = await import('../src/main/config-store');
    expect(session.readSessionFile(4242)?.cwd).toBe('/tmp/x');
    expect(history.findRecord('aaaaaaaa-0000-4000-8000-000000000001')?.firstPrompt).toBe('hi');
    expect(seen.length).toBeGreaterThan(0); // the probe sees reads when they happen

    config.save({ claudeFolder: { choice: 'declined' } });
    seen.length = 0;
    expect(session.readSessionFile(4242)).toBeNull();
    expect(history.findRecord('aaaaaaaa-0000-4000-8000-000000000001')).toBeNull();
    expect(seen).toEqual([]);
  });

  it('History lists only the folder it is given, and only once she allowed reading', async () => {
    const other = tempDir('petal-other-claude-');
    fs.mkdirSync(path.join(other, 'projects', '-tmp-y'), { recursive: true });
    fs.writeFileSync(path.join(other, 'projects', '-tmp-y', 'bbbbbbbb-0000-4000-8000-000000000002.jsonl'), `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'other' } })}\n`);
    choose('allowed');
    const history = await import('../src/main/history');
    expect(history.listSessions(new Set(), other).map((s) => s.sessionId)).toEqual(['bbbbbbbb-0000-4000-8000-000000000002']);
    expect(history.listSessions().map((s) => s.sessionId)).toEqual(['aaaaaaaa-0000-4000-8000-000000000001']);
    const config = await import('../src/main/config-store');
    config.save({ claudeFolder: { choice: 'declined' } });
    expect(history.listSessions(new Set(), other)).toEqual([]);
  });

  it('an unreadable config counts as not allowed', async () => {
    globalThis.__electronStub.userData = null; // app.getPath throws
    const gate = await import('../src/main/claude-folder');
    expect(gate.claudeFolderAllowed()).toBe(false);
  });
});
