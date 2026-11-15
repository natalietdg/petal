// Sessions Petal did not start: what waits on her, from their session file and transcript only.
import { describe, expect, it } from 'vitest';
import { outsideSignal, tailFacts } from '../src/main/outside-sessions';
import { laneFrom } from '../src/main/needs-you-hub';
import { needsYou, type SessionSignals } from '../src/shared/needs-you';
import { OUTSIDE_REASONS, outsidePlace } from '../src/shared/outside-sessions';
import type { SessionFile } from '../src/main/claude-session';
import type { TranscriptEntry } from '../src/main/transcript-entry';
import { assistantEntry, userEntry } from './helpers';

const session = (extra: Record<string, unknown> = {}): SessionFile => ({ pid: 1, sessionId: 'out-1', cwd: '/tmp/app', ...extra }) as SessionFile;
const ask: TranscriptEntry = { type: 'assistant', uuid: 'q', timestamp: '2026-11-15T10:00:00.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'AskUserQuestion', input: { questions: [] } }] } };

describe('what an outside session waits on', () => {
  it('an unanswered AskUserQuestion is a question, with words that say to answer where it runs', () => {
    const facts = tailFacts([userEntry('go'), ask], 'out-1');
    const need = needsYou(outsideSignal(session(), 'App', facts));
    expect(need).toMatchObject({ kind: 'question', reason: OUTSIDE_REASONS.question, outside: true, tabId: null, since: Date.parse('2026-11-15T10:00:00.000Z') });
  });

  it('Claude Code’s own "waiting" status with no cause in the transcript names no cause', () => {
    const need = needsYou(outsideSignal(session({ status: 'waiting', waitingFor: 'input needed', statusUpdatedAt: 5 }), 'App', tailFacts([userEntry('go')], 'out-1')));
    expect(need).toMatchObject({ kind: 'question', reason: OUTSIDE_REASONS.unknown, since: 5 });
  });

  it('an open Decide line in the newest reply is a decision; answered, it is nothing', () => {
    const open = tailFacts([userEntry('which?'), assistantEntry('**Abstract.** Two ways.\n\n**Decide:** Redis or Postgres?')], 'out-1');
    expect(needsYou(outsideSignal(session(), 'App', open))).toMatchObject({ kind: 'decide', reason: OUTSIDE_REASONS.decide, text: expect.stringContaining('Redis or Postgres') });
    const answered = tailFacts([userEntry('which?'), assistantEntry('**Decide:** Redis or Postgres?'), userEntry('Redis')], 'out-1');
    expect(needsYou(outsideSignal(session(), 'App', answered))).toBeNull();
  });

  it('idle or busy with nothing open is never waiting', () => {
    expect(needsYou(outsideSignal(session({ status: 'idle' }), 'App', tailFacts([userEntry('hi'), assistantEntry('Done.')], 'out-1')))).toBeNull();
    expect(needsYou(outsideSignal(session({ status: 'busy' }), 'App', null))).toBeNull();
  });
});

describe('the lane with outside sessions', () => {
  const outside: SessionSignals = { sessionId: 'out-1', tabId: null, windowId: null, title: 'App', ask: 'question', askSince: 1, decide: null, children: [], outside: true, reason: OUTSIDE_REASONS.unknown };

  it('adds them beside the windows’ own rows', () => {
    const lane = laneFrom({ reports: new Map(), children: new Map(), orphans: [], outside: [outside] });
    expect(lane.map((n) => [n.sessionId, n.reason, n.outside])).toEqual([['out-1', OUTSIDE_REASONS.unknown, true]]);
  });

  it('a session a Petal window reports is that window’s row, never also an outside one', () => {
    const own: SessionSignals = { ...outside, tabId: 't1', windowId: 3, outside: undefined, reason: undefined, ask: null, askSince: null };
    expect(laneFrom({ reports: new Map([[3, [own]]]), children: new Map(), orphans: [], outside: [outside] })).toEqual([]);
  });

  it('marks the card’s place line', () => {
    expect(outsidePlace('shop · main')).toBe('shop · main · outside Petal');
  });
});
