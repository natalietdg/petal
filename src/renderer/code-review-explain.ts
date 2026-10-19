// The Explain button: the local token estimate first, then a run of the separate reviewer Claude, with Cancel and a plain outcome.
import { el, isIpcError } from './dom';
import { roundTokens } from '../shared/library-cost';
import type { ExplainResult, ExplainTarget } from '../shared/code-review';

const outcomes = new Map<string, string>(); // view key -> what the last run said, kept across repaints

function outcomeText(result: ExplainResult | { error: string }): string {
  if ('error' in result) return `Couldn’t explain: ${result.error}`;
  if ('canceled' in result) return 'Canceled. Answers that came back before are kept.';
  if (result.missing) return `${result.missing} function${result.missing === 1 ? '' : 's'} got no answer. Retry them below.`;
  return '';
}

export async function run(key: string, targets: ExplainTarget[]): Promise<void> {
  outcomes.delete(key);
  const result = await window.pastel.codeReview.explain(targets);
  outcomes.set(key, outcomeText(isIpcError(result) ? { error: result.error } : result));
}

// key: which view this bar belongs to, so its outcome line survives a repaint.
export function explainBar(key: string, { estimate, running, targets, repaint }: { estimate: number; running: boolean; targets: ExplainTarget[]; repaint: () => void }): HTMLElement {
  const bar = el('div', 'cr-explain');
  if (running) {
    const cancel = el('button', 'session-link cr-cancel', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => { cancel.disabled = true; void window.pastel.codeReview.cancel(); });
    bar.append(el('span', 'cr-running', 'Explaining every function…'), cancel);
  } else if (targets.length && estimate > 0) {
    const button = el('button', 'flow-button cr-explain-button', `Explain every function · ~${roundTokens(estimate)} tokens`);
    button.type = 'button';
    button.title = 'A separate reviewer Claude reads the changes with read-only tools. Your session isn’t interrupted. The estimate is counted here, before any call.';
    button.addEventListener('click', () => {
      button.disabled = true;
      void run(key, targets).then(repaint);
    });
    bar.append(button);
  }
  const said = outcomes.get(key);
  if (said) bar.append(el('p', 'cr-outcome', said));
  return bar;
}
