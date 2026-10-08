// One subagent's timeline rows: prompt (collapsed), compact steps with their result, its messages, the final report.
// Tool output is only ever set as text, cut short and collapsed; Claude's own text goes through the reader's markdown.
import * as markdown from './markdown';
import { el } from './dom';
import type { TimelineItem } from '../main/agent-steps';

function promptRow(text: string, first: boolean): HTMLLIElement {
  const row = el('li', 'agent-line agent-prompt');
  const details = el('details');
  details.append(el('summary', '', first ? 'Prompt' : 'Follow-up from the caller'), el('p', 'agent-prompt-text', text));
  row.append(details);
  return row;
}

function stepRow(item: Extract<TimelineItem, { kind: 'step' }>): HTMLLIElement {
  const row = el('li', 'agent-line agent-step');
  row.dataset.toolUseId = item.id;
  row.append(el('span', 'agent-step-tool', item.tool), el('span', 'agent-step-summary', item.summary), el('span', 'agent-step-status waiting', '…'));
  return row;
}

// The result lands on its step row: ok or error, and the output preview behind a disclosure.
function attachResult(list: HTMLElement, item: Extract<TimelineItem, { kind: 'result' }>): void {
  const row = list.querySelector<HTMLElement>(`.agent-step[data-tool-use-id="${CSS.escape(item.toolUseId)}"]`);
  if (!row) return; // its step is older than the rows kept
  const status = row.querySelector('.agent-step-status');
  if (status) {
    status.textContent = item.ok ? 'ok' : 'error';
    status.className = `agent-step-status ${item.ok ? 'ok' : 'error'}`;
  }
  if (!item.preview) return;
  const details = el('details', 'agent-step-output');
  details.append(el('summary', '', 'Output'), el('pre', '', item.preview));
  row.append(details);
}

function textRow(text: string, className: string, label?: string): HTMLLIElement {
  const row = el('li', `agent-line ${className}`);
  if (label) row.append(el('p', 'agent-report-label', label));
  row.append(markdown.render(text));
  return row;
}

// Appends rows in arrival order; a result updates its step instead of adding a row.
export function appendItems(list: HTMLElement, items: readonly TimelineItem[]): void {
  for (const item of items) {
    if (item.kind === 'prompt') list.append(promptRow(item.text, !list.querySelector('.agent-prompt')));
    else if (item.kind === 'step') list.append(stepRow(item));
    else if (item.kind === 'result') attachResult(list, item);
    else if (item.kind === 'text') list.append(textRow(item.markdown, 'agent-message'));
    else if (item.markdown.trim()) list.append(textRow(item.markdown, 'agent-report', 'Final report'));
  }
}
