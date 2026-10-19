// Flow shows each DECISION ledger row on the step that logged it.
import { describe, expect, it } from 'vitest';
import { decisionsByStep, hasDecision } from '../src/renderer/flow-decisions';
import type { AuditRow, FlowStep } from '../src/main/flow';

const step = (audit: AuditRow[]): FlowStep => ({ index: 0, label: 'Step 1', title: 't', headline: null, outcomes: [], files: [], audit, replyIds: [], waitingOnYou: false, quiet: false });
const row = (kind: string, n = 1, actor = 'Claude', what = 'x'): AuditRow => ({ n, date: '2026-10-14', kind, actor, what });

describe('hasDecision', () => {
  it('is true only for a step that logged a DECISION row', () => {
    expect(hasDecision(step([]))).toBe(false);
    expect(hasDecision(step([row('ACTION')]))).toBe(false);
    expect(hasDecision(step([row('ACTION'), row('DECISION')]))).toBe(true);
  });
});

describe('decisionsByStep', () => {
  it('leaves out steps with no decisions and keeps ACTION rows off', () => {
    const quiet = step([row('ACTION')]);
    const decided = step([row('ACTION', 1), row('DECISION', 2, 'Natalie', 'Ship it')]);
    const byStep = decisionsByStep([quiet, decided]);
    expect(byStep.has(quiet)).toBe(false);
    expect(byStep.get(decided)?.map((d) => [d.n, d.who, d.what])).toEqual([[2, 'you', 'Ship it']]);
  });

  it('marks a row a later one supersedes, across steps', () => {
    const first = step([row('DECISION', 3, 'Natalie', 'Use Redis')]);
    const later = step([row('DECISION', 7, 'Natalie', 'Use Postgres (supersedes #3)')]);
    const byStep = decisionsByStep([first, later]);
    expect(byStep.get(first)?.[0].superseded).toBe(true);
    expect(byStep.get(later)?.[0].superseded).toBe(false);
  });

  it('notes a Claude recommendation and drops it from the text', () => {
    const s = step([row('DECISION', 4, 'Natalie', 'Keep the flag (Claude recommended, she approved)')]);
    expect(decisionsByStep([s]).get(s)?.[0]).toMatchObject({ who: 'you', recommended: true, what: 'Keep the flag' });
  });
});
