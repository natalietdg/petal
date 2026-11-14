// Headless claude -p children: the ppid walk on a fake process tree and sessions dir, the stored link,
// the sdk-cli filter in the live list and in History, and the badge text. Nothing here reads ~/.claude.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowClaudeFolder, removeTempDirs, tempDir, tmpLeftovers, writeJsonl } from './helpers';
import { parentSessionPid, pendingAsk, resolveLinks, type ResolveDeps } from '../src/main/subsessions';
import { projectSlug, type ProcessRow, type SessionFile } from '../src/main/claude-session';
import { agentsBadge, historyRows, type ChildRow } from '../src/shared/subsessions';
import type { SubsessionLink } from '../src/main/subsession-links';
import type { TranscriptEntry } from '../src/main/transcript-entry';

afterEach(() => { removeTempDirs(); vi.unstubAllEnvs(); });

// The tree seen live on 2026-11-14: child claude 37180 -> zsh 16522 -> zsh 16500 -> parent claude 90360.
const TREE: ProcessRow[] = [
  { pid: 37180, ppid: 16522, comm: 'claude' },
  { pid: 16522, ppid: 16500, comm: 'zsh' },
  { pid: 16500, ppid: 90360, comm: '/bin/zsh' },
  { pid: 90360, ppid: 1200, comm: 'claude' },
  { pid: 1200, ppid: 1, comm: 'login' },
];
const PARENT_ID = 'd15f9719-0000-0000-0000-000000000001';
const CHILD_ID = 'c0000000-0000-0000-0000-000000000002';

const session = (pid: number, sessionId: string, extra: Partial<SessionFile> = {}): SessionFile => ({ pid, sessionId, cwd: '/work/petal', kind: 'interactive', status: 'busy', ...extra });

describe('ppid walk', () => {
  it('finds the nearest ancestor with a sessions/<pid>.json, through the shells', () => {
    expect(parentSessionPid(37180, TREE, (pid) => pid === 90360)).toBe(90360);
  });

  it('stops after the hop limit and at pid 1', () => {
    expect(parentSessionPid(37180, TREE, (pid) => pid === 90360, 2)).toBeNull();
    expect(parentSessionPid(37180, TREE, () => false)).toBeNull();
    expect(parentSessionPid(424242, TREE, () => true)).toBeNull(); // not in the listing
  });
});

describe('resolveLinks', () => {
  const files: Record<number, SessionFile> = { 90360: session(90360, PARENT_ID, { entrypoint: 'cli' }) };
  const deps = (stored: SubsessionLink[] = []): ResolveDeps & { saved: SubsessionLink[][]; listed: number } => {
    const d = {
      saved: [] as SubsessionLink[][],
      listed: 0,
      processes: async () => { d.listed += 1; return TREE; },
      readSession: (pid: number) => files[pid] ?? null,
      load: () => stored,
      save: (fresh: readonly SubsessionLink[]) => { d.saved.push([...fresh]); return [...fresh, ...stored]; },
      nameOf: (s: SessionFile) => `Title of ${s.sessionId.slice(0, 4)}`,
    };
    return d;
  };
  const child = session(37180, CHILD_ID, { entrypoint: 'sdk-cli', name: 'Petal · subsessions' });

  it('links a new sdk-cli child to the parent claude above its shells', async () => {
    const d = deps();
    const links = await resolveLinks([files[90360]!, child], d, 1000);
    expect(links).toEqual([{ childId: CHILD_ID, parentId: PARENT_ID, cwd: '/work/petal', name: 'Title of c000', at: 1000 }]);
    expect(d.listed).toBe(1);
  });

  it('runs no ps when every child is already linked, and never links a cli session', async () => {
    const stored = [{ childId: CHILD_ID, parentId: PARENT_ID, cwd: '/work/petal', name: 'x', at: 1 }];
    const d = deps(stored);
    expect(await resolveLinks([files[90360]!, child, session(5, 'plain', { entrypoint: 'cli' })], d)).toBe(stored);
    expect(d.listed).toBe(0);
    expect(d.saved).toEqual([]);
  });
});

describe('subsession link store', () => {
  type Store = typeof import('../src/main/subsession-links');
  let store: Store;
  let dir: string;
  beforeEach(async () => {
    dir = allowClaudeFolder();
    vi.resetModules();
    store = await import('../src/main/subsession-links');
  });

  it('persists across a restart (a fresh module load), first parent wins', async () => {
    store.add([{ childId: CHILD_ID, parentId: PARENT_ID, cwd: '/w', name: 'Run', at: 1 }]);
    store.add([{ childId: CHILD_ID, parentId: 'someone-else', cwd: '/w', name: 'Run', at: 2 }]);
    vi.resetModules();
    const again: Store = await import('../src/main/subsession-links');
    const links = again.load();
    expect(again.parentOf(links, CHILD_ID)).toBe(PARENT_ID);
    expect(again.childrenOf(links, PARENT_ID)).toHaveLength(1);
    expect(tmpLeftovers(dir)).toEqual([]);
  });

  it('ignores a malformed file', () => {
    fs.writeFileSync(path.join(dir, 'subsession-links.json'), '{not json');
    expect(store.load()).toEqual([]);
  });
});

describe('sdk-cli filter in the live list', () => {
  const ask: TranscriptEntry = { type: 'assistant', timestamp: '2026-11-14T05:00:00.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [] } }] } };

  // claudeHome() keeps the first folder it resolves, so the monitor is loaded fresh after the env points at a temp one.
  let snapshot: typeof import('../src/main/sessions-monitor').snapshot;
  async function claudeHome(): Promise<string> {
    allowClaudeFolder();
    const home = tempDir('petal-claude-');
    vi.stubEnv('CLAUDE_CONFIG_DIR', home);
    vi.resetModules();
    ({ snapshot } = await import('../src/main/sessions-monitor'));
    return home;
  }
  const transcript = (home: string, id: string, entries: TranscriptEntry[]) => {
    const dir = path.join(home, 'projects', projectSlug('/work/petal'));
    fs.mkdirSync(dir, { recursive: true });
    writeJsonl(path.join(dir, `${id}.jsonl`), entries);
  };

  it('a headless child is never a row: it sits under its parent, counted as an agent; an unlinked one is an orphan', async () => {
    const home = await claudeHome();
    transcript(home, CHILD_ID, [ask]);
    transcript(home, 'orphan-1', [{ type: 'user', message: { role: 'user', content: 'go' } }]);
    const live = [
      session(90360, PARENT_ID, { entrypoint: 'cli' }),
      session(37180, CHILD_ID, { entrypoint: 'sdk-cli', name: 'Sweep', status: 'idle' }),
      session(555, 'orphan-1', { entrypoint: 'sdk-cli', name: 'Lost run' }),
    ];
    const known = [{ childId: CHILD_ID, parentId: PARENT_ID, cwd: '/work/petal', name: 'Sweep', at: 1 }];
    const result = snapshot({ detailed: true, nameOf: (s) => (s.sessionId === 'orphan-1' ? 'Lost run' : 'Parent') }, live, () => path.join(home, 'none'), known);
    expect(result.rows?.map((r) => r.sessionId)).toEqual([PARENT_ID]);
    expect(result.counts).toMatchObject({ total: 1, agents: 1 });
    expect(result.rows?.[0]?.children).toEqual([expect.objectContaining({ sessionId: CHILD_ID, name: 'Sweep', ask: 'question', status: 'running' })]);
    expect(result.orphans?.map((o) => o.name)).toEqual(['Lost run']);
  });

  it('the collapsed pill counts top sessions only, children as agents', async () => {
    await claudeHome();
    const live = [session(90360, PARENT_ID), session(37180, CHILD_ID, { entrypoint: 'sdk-cli' })];
    const known = [{ childId: CHILD_ID, parentId: PARENT_ID, cwd: '/work/petal', name: 'Sweep', at: 1 }];
    expect(snapshot({}, live, () => '/nowhere', known).counts).toEqual({ total: 1, busy: 1, agents: 1 });
  });
});

describe('pendingAsk', () => {
  const use: TranscriptEntry = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion' }] } };
  it('is a question until a tool_result answers it', () => {
    expect(pendingAsk([use])).toBe('question');
    expect(pendingAsk([use, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'q1' }] } }])).toBeNull();
    expect(pendingAsk([{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'r', name: 'Read' }] } }])).toBeNull();
  });
});

describe('sdk-cli filter in History', () => {
  const rows = [
    { sessionId: 'p', headless: false, parentId: null },
    { sessionId: 'c1', headless: true, parentId: 'p' },
    { sessionId: 'loose', headless: true, parentId: 'gone' },
    { sessionId: 'q', headless: false, parentId: null },
    { sessionId: 'c2', headless: true, parentId: 'p' },
  ];

  it('hides headless runs by default', () => {
    expect(historyRows(rows, false).map((n) => n.session.sessionId)).toEqual(['p', 'q']);
  });

  it('shown, each sits nested under its parent; one whose parent is not listed keeps its place', () => {
    expect(historyRows(rows, true).map((n) => `${n.nested ? '  ' : ''}${n.session.sessionId}`)).toEqual(['p', '  c1', '  c2', 'loose', 'q']);
  });
});

describe('agents badge', () => {
  const c = (extra: Partial<ChildRow>): ChildRow => ({ sessionId: 'x', name: 'x', status: 'running', ask: null, askSince: null, updatedAt: 0, step: '', ...extra });
  it('counts subagents and children together, then what needs a look', () => {
    expect(agentsBadge(2, [c({ ask: 'question' })])).toBe('3 agents · 1 waiting');
    expect(agentsBadge(0, [c({ status: 'stalled' })])).toBe('1 agent · 1 stalled');
    expect(agentsBadge(0, [])).toBe('');
  });
});
