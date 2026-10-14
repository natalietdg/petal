// The Decisions tab shows only for a session whose stored flow logged DECISION ledger rows.
import { describe, expect, it } from 'vitest';
import { hasDecisions, showDecisionsTab } from '../src/renderer/flow-decisions';
import type { FlowView, Guarded } from '../src/shared/ipc';

type FlowResult = Guarded<FlowView | null>;
import type { AuditRow, FlowStep } from '../src/main/flow';

const step = (audit: AuditRow[]): FlowStep => ({ index: 0, label: 'Step 1', title: 't', headline: null, outcomes: [], files: [], audit, replyIds: [], waitingOnYou: false, quiet: false });
const stored = (steps: FlowStep[]) => ({ steps, finalNext: null, stale: false }) as unknown as FlowResult;
const row = (kind: string): AuditRow => ({ n: 1, date: '2026-10-14', kind, actor: 'Claude', what: 'x' });

describe('hasDecisions', () => {
  it('is false for no flow, an empty flow, an error, or only ACTION rows', () => {
    expect(hasDecisions(null)).toBe(false);
    expect(hasDecisions({ empty: true, creating: false } as FlowResult)).toBe(false);
    expect(hasDecisions({ error: 'x' } as unknown as FlowResult)).toBe(false);
    expect(hasDecisions(stored([step([]), step([row('ACTION')])]))).toBe(false);
  });

  it('is true once any step logged a DECISION row', () => {
    expect(hasDecisions(stored([step([row('ACTION')]), step([row('DECISION')])]))).toBe(true);
  });

  it('hides and shows the tab to match', () => {
    const tab = { hidden: false };
    showDecisionsTab(tab, stored([step([])]));
    expect(tab.hidden).toBe(true);
    showDecisionsTab(tab, stored([step([row('DECISION')])]));
    expect(tab.hidden).toBe(false);
    expect(() => showDecisionsTab(null, null)).not.toThrow();
  });
});
