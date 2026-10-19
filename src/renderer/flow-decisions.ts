// The DECISION ledger rows a flow's steps logged, grouped by step; kept free of the DOM so the suites can run it.
// Rows come only from audit-ledger lines ("#n | date | DECISION | actor | what"), so most sessions have none.
import { whoOf, type Who } from './ledger-actor';
import type { AuditRow, FlowStep } from '../main/flow';

export interface StepDecision extends AuditRow {
  who: Who;
  recommended: boolean; // "(Claude recommended …)" in the row: her decision, Claude's suggestion
  superseded: boolean; // a later row says "supersedes #n"
}

const SUPERSEDES = /supersedes\s+#(\d+)/i;
const RECOMMENDED = /\(Claude (?:recommended|proposed|suggested|chose|scoped)[^)]*\)/i;

export const hasDecision = (step: FlowStep): boolean => step.audit.some((row) => row.kind === 'DECISION');

// Each step's decisions, in ledger order; a step with none is left out.
export function decisionsByStep(steps: readonly FlowStep[]): Map<FlowStep, StepDecision[]> {
  const rows = steps.flatMap((step) => step.audit.filter((row) => row.kind === 'DECISION').map((row) => ({ step, row })));
  const superseded = new Set(rows.flatMap(({ row }) => SUPERSEDES.exec(row.what)?.[1] ?? []).map(Number));
  const byStep = new Map<FlowStep, StepDecision[]>();
  for (const { step, row } of rows) {
    const decision = { ...row, what: row.what.replace(RECOMMENDED, '').trim(), who: whoOf(row.actor), recommended: RECOMMENDED.test(row.what), superseded: superseded.has(row.n) };
    byStep.set(step, [...(byStep.get(step) ?? []), decision]);
  }
  return byStep;
}
