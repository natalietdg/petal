// Code review for subagents: a subagent's own log read as turns, only from a projects subagents folder, and matched
// to the parent turn whose Agent tool_use id its meta.json records.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodeChangeCollector } from '../src/main/code-changes';
import { isSubagentLog, launchedAgents, subagentSession, subagentsByTurn } from '../src/main/code-review-subagents';
import { sessionSummary, turnReview, type ReviewSession } from '../src/main/code-review';
import { codeReviewFixture } from '../src/main/snapshot-mode';
import { sessionEntries } from './fixtures/code-review';
import { removeTempDirs, tempDir, useTempUserData, writeJsonl } from './helpers';
import type { TranscriptEntry } from '../src/main/transcript-entry';

afterEach(removeTempDirs);

const SESSION = 'parent-1';
const AGENT = 'a1b2c3';
const CALL = 'toolu_launch';

const sidechain = (): TranscriptEntry[] => sessionEntries().map((e) => ({ ...e, isSidechain: true }));

// The parent: her prompt, an Agent call (and its result), then Claude's reply.
const parentEntries = (call = CALL): TranscriptEntry[] => {
  const base = { isSidechain: false, cwd: '/repo', sessionId: SESSION };
  return [
    { ...base, type: 'user', uuid: 'p-u', message: { role: 'user', content: 'have an agent fix the cart' } },
    { ...base, type: 'assistant', uuid: 'p-a', message: { role: 'assistant', content: [{ type: 'text', text: 'Sending an agent.' }, { type: 'tool_use', id: call, name: 'Agent', input: { description: 'Fix the cart' } }] } },
    { ...base, type: 'user', uuid: 'p-r', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call, content: 'done' }] } },
    { ...base, type: 'assistant', uuid: 'p-d', message: { role: 'assistant', content: [{ type: 'text', text: 'The agent fixed it.' }] } },
  ] as TranscriptEntry[];
};

// <root>/<project>/<session>.jsonl and its subagents folder, like ~/.claude/projects.
function layout(meta: Record<string, unknown> = { description: 'Fix the cart', toolUseId: CALL }): { root: string; parent: ReviewSession; agentLog: string } {
  const root = tempDir('petal-projects-');
  const project = path.join(root, '-repo');
  const agents = path.join(project, SESSION, 'subagents');
  fs.mkdirSync(agents, { recursive: true });
  const transcript = writeJsonl(path.join(project, `${SESSION}.jsonl`), parentEntries());
  const agentLog = writeJsonl(path.join(agents, `agent-${AGENT}.jsonl`), sidechain());
  fs.writeFileSync(path.join(agents, `agent-${AGENT}.meta.json`), JSON.stringify(meta));
  return { root, parent: { sessionId: SESSION, transcript, cwd: '/repo' }, agentLog };
}

describe('a subagent’s own log', () => {
  it('is read as turns only in sidechain mode, where every entry is a sidechain', () => {
    const plain = new CodeChangeCollector();
    const own = new CodeChangeCollector(() => null, { sidechain: true });
    for (const entry of sidechain()) { plain.add(entry); own.add(entry); }
    expect(plain.changed()).toEqual([]);
    expect(own.changed().map((t) => t.cards.map((c) => c.name))).toEqual([['total'], ['Cart.remove', 'Module level', 'Changed lines']]);
  });

  it('records the Agent calls a parent turn made', () => {
    const c = new CodeChangeCollector();
    for (const entry of parentEntries()) c.add(entry);
    expect(c.changed().map((t) => [t.turnId, t.agentCalls, t.cards.length])).toEqual([['p-u', [CALL], 0]]);
  });
});

describe('path validation', () => {
  const root = '/home/me/.claude/projects';
  it('takes only <root>/<project>/<session>/subagents/agent-<id>.jsonl', () => {
    expect(isSubagentLog(`${root}/-repo/s1/subagents/agent-abc.jsonl`, [root])).toBe(true);
    expect(isSubagentLog(`${root}/-repo/s1/subagents/../../s1.jsonl`, [root])).toBe(false);
    expect(isSubagentLog(`${root}/-repo/s1/other/agent-abc.jsonl`, [root])).toBe(false);
    expect(isSubagentLog(`${root}/-repo/s1/subagents/agent-abc.meta.json`, [root])).toBe(false);
    expect(isSubagentLog(`${root}/-repo/subagents/agent-abc.jsonl`, [root])).toBe(false);
    expect(isSubagentLog('/etc/x/s1/subagents/agent-abc.jsonl', [root])).toBe(false);
    expect(isSubagentLog(`${root}/../x/s1/subagents/agent-abc.jsonl`, [root])).toBe(false);
  });

  it('opens a subagent only by a plain id, inside the roots, not through a symlink out', () => {
    const { root, parent, agentLog } = layout();
    expect(subagentSession(parent, AGENT, [root])).toMatchObject({ sessionId: `${SESSION}--${AGENT}`, transcript: fs.realpathSync(agentLog), subagent: true });
    expect(subagentSession(parent, '../../x', [root])).toBeNull();
    expect(subagentSession(parent, AGENT, [tempDir()])).toBeNull();
    const outside = writeJsonl(path.join(tempDir(), 'secret.jsonl'), sidechain());
    fs.symlinkSync(outside, path.join(path.dirname(agentLog), 'agent-linked.jsonl'));
    expect(subagentSession(parent, 'linked', [root])).toBeNull();
  });
});

describe('matching a subagent to the turn that launched it', () => {
  it('maps the meta.json toolUseId to the agent id', () => {
    const { agentLog } = layout();
    expect([...launchedAgents(path.dirname(agentLog))]).toEqual([[CALL, AGENT]]);
  });

  it('lists the subagent and its changes under the launching turn', async () => {
    const { root, parent } = layout();
    const byTurn = await subagentsByTurn(parent, [{ turnId: 'p-u', agentCalls: [CALL] }, { turnId: 'other', agentCalls: ['toolu_else'] }], [root]);
    expect([...byTurn.keys()]).toEqual(['p-u']);
    expect(byTurn.get('p-u')).toEqual([{ agentId: AGENT, description: 'Fix the cart', turnIds: ['u1', 'u2'], functions: 4 }]);
  });

  it('leaves out an agent whose meta names another call', async () => {
    const { root, parent } = layout({ description: 'Fix the cart', toolUseId: 'toolu_other' });
    expect((await subagentsByTurn(parent, [{ turnId: 'p-u', agentCalls: [CALL] }], [root])).size).toBe(0);
  });

  it('carries through the session summary, and the agent’s turns open from its own source', async () => {
    useTempUserData();
    const { root, parent } = layout();
    const before = process.env.PASTEL_SNAPSHOT;
    process.env.PASTEL_SNAPSHOT = '1'; // the snapshot roots stand in for ~/.claude/projects
    codeReviewFixture.projectsRoots = [root];
    try {
      const summary = await sessionSummary(parent);
      expect(summary.turns.map((t) => [t.turnId, t.functions, t.agents.map((a) => a.agentId)])).toEqual([['p-u', 0, [AGENT]]]);
      const agent = subagentSession(parent, AGENT);
      expect(agent).not.toBeNull();
      const review = await turnReview(agent as ReviewSession, 'u1');
      expect(review.sessionId).toBe(`${SESSION}--${AGENT}`);
      expect(review.cards.map((c) => c.name)).toEqual(['total']);
    } finally {
      codeReviewFixture.projectsRoots = [];
      if (before === undefined) delete process.env.PASTEL_SNAPSHOT;
      else process.env.PASTEL_SNAPSHOT = before;
    }
  });
});

describe('the reply view’s groups', () => {
  it('puts each launched subagent under its own heading after the reply’s own turns', async () => {
    const { reviewGroups } = await import('../src/renderer/code-review-groups');
    const summary = { sessionId: SESSION, turns: [
      { turnId: 't1', replyId: 'r1', historyIndex: 0, at: null, functions: 2, agents: [{ agentId: AGENT, description: 'Fix the cart', turnIds: ['u1'], functions: 3 }] },
      { turnId: 't2', replyId: 'r2', historyIndex: 1, at: null, functions: 1, agents: [] },
    ] };
    expect(reviewGroups({ tabId: '7' }, summary, { replyId: 'r1' })).toEqual([
      { source: { tabId: '7' }, heading: null, turnIds: ['t1'], functions: 2 },
      { source: { sessionId: SESSION, agentId: AGENT }, heading: 'By subagent: Fix the cart', turnIds: ['u1'], functions: 3 },
    ]);
    expect(reviewGroups({ tabId: '7' }, summary, { historyIndex: 1 })).toEqual([{ source: { tabId: '7' }, heading: null, turnIds: ['t2'], functions: 1 }]);
  });
});
