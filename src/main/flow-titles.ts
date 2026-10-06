// State changes per step, written by Claude (Haiku) in one call per flow. Falls back to the audit log on any failure.
import { runClaude } from './claude-cli';
import * as configStore from './config-store';
import type { FlowStep, StateChange } from './flow';

// Fixed in code so an edited prompt can never break parseSteps.
const CONTRACT = 'Answer with JSON only: {"steps":[{"i":<index>,"t":"<title>","changes":[{"what":"","from":"","to":""}]}]}';

interface StepAnswer {
  i?: unknown;
  t?: unknown;
  changes?: { what?: unknown; from?: unknown; to?: unknown }[];
}

export type TitlingResult = { ok: true; count: number } | { ok: false; error: string };

export const promptText = (): string => `${configStore.load().flowTitles.prompt}\n${CONTRACT}`;

// Pulls {"steps":[...]} out of the reply even if the model wraps it in prose or a fence.
function parseSteps(stdout: string): Map<number, StepAnswer> {
  const text = String((JSON.parse(stdout) as { result?: unknown }).result ?? '');
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { steps: StepAnswer[] };
  return new Map(json.steps.map((step) => [Number(step.i), step]));
}

const clean = (value: unknown, max: number): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Without AI, ACTION rows in the audit log are the best record of what changed.
function fallbackChanges(step: FlowStep): StateChange[] {
  return step.audit.filter((row) => row.kind === 'ACTION').map((row) => ({ what: '', from: '', to: clean(row.what, 80) }));
}

export async function writeTitles(steps: FlowStep[]): Promise<TitlingResult> {
  const wanted = steps.filter((s) => !s.quiet);
  for (const step of steps) step.changes = fallbackChanges(step);
  if (!wanted.length) return { ok: true, count: 0 };
  const payload = wanted.map((s) => ({ i: s.index, asked: s.label, reply: s.excerpt }));
  try {
    const answers = parseSteps(await runClaude(`${promptText()}\n\nSteps:\n${JSON.stringify(payload)}`));
    let count = 0;
    for (const step of wanted) {
      const answer = answers.get(step.index);
      if (!answer) continue;
      if (answer.t && String(answer.t).length <= 80) step.title = clean(answer.t, 80);
      if (Array.isArray(answer.changes)) {
        step.changes = answer.changes
          .map((c) => ({ what: clean(c.what, 40), from: clean(c.from, 60), to: clean(c.to, 60) }))
          .filter((c) => c.to);
      }
      count += 1;
    }
    return { ok: true, count };
  } catch (error) {
    return { ok: false, error: (error as Error).message.split('\n')[0] };
  }
}
