// A loop's distillation in the Testing tab: one collapsible section, a block per round with Claude's questions,
// its answers, the course it took, then that round's Open threads as the reader's cards, each with its fate
// across later rounds (open, settled, carried, dropped). What only she can answer is marked "needs you".
import { el } from './dom';
import { threadButton } from './open-threads';
import { COURSE_WORDS, statusWord, threadStatus, type DistillRecord } from '../shared/distillation';

const opened = new Set<string>(); // sections she opened; the 1.5s loop refresh rebuilds them
const roundLabel = (r: DistillRecord, i: number): string => (r.round ? `Round ${r.round}${r.total ? ` of ${r.total}` : ''}` : `Review ${i + 1}`);

// One round's Open threads, headed "Questions to follow up": the reader's cards, a status under each; a click asks it in the session.
function threadsBlock(records: readonly DistillRecord[], i: number, ask: (prompt: string) => void): HTMLElement | null {
  const record = records[i];
  if (!record.threads.length) return null;
  const box = el('div', 'tst-distill-threads');
  box.append(el('h6', 'tst-distill-threads-title', 'Questions to follow up')); // "Open threads" names the reader's own cards
  const list = el('ul', 'threads');
  for (const thread of record.threads) {
    const status = threadStatus(records, i, thread);
    const item = el('li', `thread tst-thread is-${status.kind}${thread.needsYou ? ' is-needs-you' : ''}`);
    const meta = el('p', 'tst-thread-status');
    meta.append(el('span', `tst-thread-word is-${status.kind}`, statusWord(status)), ...(thread.needsYou ? [el('span', 'tst-needs-you', 'needs you')] : []),
      ...('note' in status && status.note ? [el('span', 'tst-thread-note', status.note)] : []));
    item.append(threadButton(thread, ask), meta);
    list.append(item);
  }
  box.append(list);
  return box;
}

function roundBlock(records: readonly DistillRecord[], i: number, ask: (prompt: string) => void): HTMLElement {
  const record = records[i];
  const box = el('section', 'tst-distill-round');
  box.dataset.record = record.id;
  const head = el('div', 'tst-distill-head');
  head.append(el('h5', 'tst-distill-round-title', roundLabel(record, i)), el('span', `tst-course is-${record.course}`, COURSE_WORDS[record.course]));
  box.append(head);
  if (record.reason) box.append(el('p', 'tst-distill-reason', record.reason));
  if (record.questions.length) {
    const list = el('ul', 'tst-distill-qs');
    for (const q of record.questions) {
      const item = el('li', `tst-distill-q${q.needsYou ? ' is-needs-you' : ''}`);
      const question = el('p', 'tst-distill-ask');
      question.append(el('span', 'tst-distill-mark', 'Q'), el('span', null, q.q));
      const answer = el('p', 'tst-distill-answer');
      answer.append(el('span', 'tst-distill-mark', 'A'), ...(q.needsYou ? [el('span', 'tst-needs-you', 'needs you')] : []), el('span', null, q.a || 'Waiting on your answer.'));
      item.append(question, answer);
      list.append(item);
    }
    box.append(list);
  }
  const threads = threadsBlock(records, i, ask);
  if (threads) box.append(threads);
  return box;
}

// Rounds oldest first; the summary names the latest course and how many questions wait on her.
export function distillSection(records: readonly DistillRecord[], key: string, ask: (prompt: string) => void, label = 'Distillation'): HTMLElement | null {
  if (!records.length) return null;
  const details = el('details', 'tst-distill');
  details.dataset.key = key;
  details.open = opened.has(key);
  details.addEventListener('toggle', () => { if (details.open) opened.add(key); else opened.delete(key); });
  const latest = records.at(-1) as DistillRecord;
  const waiting = latest.questions.filter((q) => q.needsYou).length + latest.threads.filter((t) => t.needsYou).length;
  const open = records.reduce((n, r, i) => n + r.threads.filter((t) => threadStatus(records, i, t).kind === 'open').length, 0);
  const summary = el('summary', 'tst-distill-summary');
  summary.append(
    el('span', 'tst-distill-title', label),
    el('span', 'tst-distill-count', `${records.length} round${records.length === 1 ? '' : 's'} · last course: ${COURSE_WORDS[latest.course].toLowerCase()}${open ? ` · ${open} open thread${open === 1 ? '' : 's'}` : ''}`),
    ...(waiting ? [el('span', 'tst-needs-you', `${waiting} need${waiting === 1 ? 's' : ''} you`)] : []),
  );
  const body = el('div', 'tst-distill-body');
  body.append(...records.map((_, i) => roundBlock(records, i, ask)));
  details.append(summary, body);
  return details;
}
