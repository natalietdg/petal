// Whether a stored flow logged any decisions; kept free of the DOM so the suites can run it.
// Rows come only from audit-ledger lines ("#n | date | DECISION | actor | what"), so most sessions have none.
import type { FlowView, Guarded } from '../shared/ipc';

export const hasDecisions = (flow: Guarded<FlowView | null>): boolean =>
  Boolean(flow && !('error' in flow) && !('empty' in flow) && flow.steps.some((step) => step.audit.some((row) => row.kind === 'DECISION')));

// The Decisions tab shows only when there is something to list.
export function showDecisionsTab(tab: { hidden: boolean } | null, flow: Guarded<FlowView | null>): void {
  if (tab) tab.hidden = !hasDecisions(flow);
}
