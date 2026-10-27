// One function card: where it is, a compact before/after diff, and the reviewer's "why it's written like this".
import { el } from './dom';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import python from 'highlight.js/lib/languages/python';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import { compactDiff, diffLines, type DiffLine } from '../shared/line-diff';
import { KIND_WORDS, type FunctionCard, type ReasoningExcerpt, type WhyAnswer } from '../shared/code-review';

export interface CardState {
  answer: WhyAnswer | null;
  explained: boolean; // a run finished for this content
  running: boolean;
  onRetry: (() => void) | null;
}

for (const [name, language] of Object.entries({ bash, css, go, javascript, json, kotlin, python, swift, typescript, xml })) hljs.registerLanguage(name, language);

// Each language's aliases cover its extensions (ts, py, kt, sh, html...); anything else stays plain.
export function languageFor(file: string): string | null {
  const ext = /\.([\w]+)$/.exec(file)?.[1]?.toLowerCase();
  return ext && hljs.getLanguage(ext) ? ext : null;
}

// Highlighted HTML per line: open spans are closed at each newline and reopened on the next, so a block comment stays coloured.
function highlightedLines(text: string, language: string): string[] {
  const html = hljs.highlight(text.replace(/\n$/, ''), { language, ignoreIllegals: true }).value;
  const lines: string[] = [];
  const open: string[] = [];
  let line = '';
  for (const part of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (part === '\n') { lines.push(line + '</span>'.repeat(open.length)); line = open.join(''); }
    else if (part.startsWith('<span')) { open.push(part); line += part; }
    else if (part === '</span>') { open.pop(); line += part; }
    else line += part;
  }
  lines.push(line);
  return lines;
}

// Before lines feed '-' and ' ' rows, after lines feed '+' rows, matching diffLines' order.
function highlightRows(lines: readonly DiffLine[], before: string, after: string, language: string): Map<DiffLine, string> {
  const old = highlightedLines(before, language);
  const now = highlightedLines(after, language);
  const html = new Map<DiffLine, string>();
  let i = 0;
  let j = 0;
  for (const line of lines) {
    if (line.op === '+') html.set(line, now[j++] ?? '');
    else if (line.op === '-') html.set(line, old[i++] ?? '');
    else { html.set(line, old[i++] ?? ''); j += 1; }
  }
  return html;
}

export function diffView(before: string, after: string, file = ''): HTMLElement {
  const pre = el('pre', 'cr-diff');
  pre.setAttribute('aria-label', 'Before and after');
  const lines = diffLines(before, after);
  const language = languageFor(file);
  const html = language ? highlightRows(lines, before, after, language) : null;
  for (const row of compactDiff(lines)) {
    if (row.op === 'gap') {
      pre.append(el('span', 'cr-line cr-gap', `${row.count} unchanged line${row.count === 1 ? '' : 's'}`));
      continue;
    }
    const kind = row.op === '+' ? 'cr-add' : row.op === '-' ? 'cr-del' : 'cr-same';
    const line = el('span', `cr-line ${kind}`);
    const code = el('span', 'cr-code');
    const highlighted = html?.get(row);
    // hljs escapes the source text, so its markup is safe to insert.
    if (highlighted) code.innerHTML = highlighted;
    else code.textContent = row.text || ' ';
    line.append(el('span', 'cr-sign', row.op === ' ' ? ' ' : row.op), code);
    pre.append(line);
  }
  return pre;
}

const changeWord = (card: FunctionCard): string => {
  if (card.kind !== 'function') return KIND_WORDS[card.kind];
  return !card.before ? 'New' : !card.after ? 'Removed' : 'Changed';
};

function field(label: string, text: string): HTMLElement {
  const row = el('p', 'cr-why-row');
  row.append(el('span', 'cr-why-label', label), document.createTextNode(text || 'Not said.'));
  return row;
}

function answerView(answer: WhyAnswer): HTMLElement {
  const box = el('div', `cr-why ${answer.basis}`);
  const basis = answer.basis === 'recorded'
    ? el('p', 'cr-basis', 'Recorded · backed by what Claude wrote in the session')
    : el('p', 'cr-basis', 'Inferred · the reviewer’s reading; the session didn’t say');
  box.append(basis, field('Shape', answer.shape), field('Why', answer.driver), field('Instead of', answer.alternatives), field('Risk', answer.risk));
  if (answer.quote) box.append(el('blockquote', 'cr-quote', answer.quote));
  return box;
}

function missingView(state: CardState): HTMLElement {
  const box = el('div', 'cr-why cr-missing');
  box.append(el('span', null, 'No answer for this one.'));
  if (state.onRetry) {
    const retry = el('button', 'session-link cr-retry', 'Retry');
    retry.type = 'button';
    retry.disabled = state.running;
    retry.addEventListener('click', () => state.onRetry?.());
    box.append(retry);
  }
  return box;
}

// heading: false inside the task roll-up, where the file and function already head the group.
export function functionCard(card: FunctionCard, state: CardState, { heading = true }: { heading?: boolean } = {}): HTMLElement {
  const box = el('article', `cr-card ${card.kind}`);
  box.dataset.key = card.key;
  if (heading) {
    const head = el('header', 'cr-card-head');
    head.append(el('code', 'cr-name', card.kind === 'function' ? card.name : KIND_WORDS[card.kind]), el('span', 'cr-file', card.display));
    box.append(head);
  }
  box.append(el('p', 'cr-change', changeWord(card)));
  if (card.note) box.append(el('p', 'cr-note', card.note));
  box.append(diffView(card.before, card.after, card.file));
  if (state.answer) box.append(answerView(state.answer));
  else if (state.explained && !state.running) box.append(missingView(state));
  return box;
}

// The session's own words a card was written after, for reading beside the answers.
export function reasoningList(reasoning: readonly ReasoningExcerpt[]): HTMLElement | null {
  if (!reasoning.length) return null;
  const details = el('details', 'cr-reasoning');
  details.append(el('summary', null, `What Claude wrote while making these changes (${reasoning.length})`));
  for (const r of reasoning) {
    const item = el('p', `cr-excerpt ${r.kind}`);
    item.append(el('span', 'cr-excerpt-label', r.kind === 'thinking' ? 'Thinking' : 'Said'), document.createTextNode(r.text));
    details.append(item);
  }
  return details;
}

export function skippedLine(skipped: readonly string[]): HTMLElement | null {
  if (!skipped.length) return null;
  return el('p', 'cr-skipped', `Left out, as they look like secrets files: ${skipped.map((f) => f.split('/').pop()).join(', ')}. Petal never sends them to the reviewer.`);
}
