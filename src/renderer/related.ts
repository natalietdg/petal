// Draws the Related page the way a reply reads: a headline with the one thing that matters, then sections.
// Waiting on this (later sessions that share a topic), Overlap (files edited here and elsewhere), Waits on (earlier sessions).
import { el, isIpcError } from './dom';
import { shortFile, type ContextEntry, type RelatedWork, type SessionContext } from '../shared/context-store';
import type { Guarded } from '../shared/ipc';

const KIND_WORD: Record<ContextEntry['kind'], string> = { decided: 'Decided', open: 'Open', next: 'Next' };
const ENTRIES_PER_CARD = 4;

const when = (at: number | null): string => (at ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

// The one-line verdict the page opens with.
function headline(work: RelatedWork): string {
  const needs = work.overlap.length;
  if (needs) return needs === 1 ? 'One file is being changed by another session too' : `${needs} files are being changed by other sessions too`;
  if (work.waitingOnThis.length) return work.waitingOnThis.length === 1 ? 'One later session builds on this one' : `${work.waitingOnThis.length} later sessions build on this one`;
  if (work.waitsOn.length) return 'Nothing waits on this session yet';
  return 'No other session shares a topic with this one';
}

function card(session: SessionContext, shared: string[]): HTMLElement {
  const box = el('article', 'related-card');
  box.append(el('p', 'related-card-title', session.title || session.sessionId.slice(0, 8)));
  const meta = [session.repo, when(session.lastAt), shared.length ? `shares ${shared.join(', ')}` : ''].filter(Boolean).join(' · ');
  box.append(el('p', 'related-card-meta', meta));
  const list = el('ul', 'related-entries');
  for (const entry of session.entries.slice(0, ENTRIES_PER_CARD)) {
    const row = el('li', `related-entry related-${entry.kind}`);
    row.append(el('span', 'related-pill', KIND_WORD[entry.kind]), el('span', 'related-entry-text', entry.text));
    list.append(row);
  }
  if (list.childElementCount) box.append(list);
  return box;
}

function section(title: string, count: number): HTMLElement {
  const head = el('h2', 'related-section-title', title);
  head.append(el('span', 'related-count', String(count)));
  return head;
}

export function render(container: HTMLElement, result: Guarded<{ related: RelatedWork | null }> | null, label: string | null): void {
  container.replaceChildren();
  if (!result) {
    container.append(el('p', 'related-empty', 'Related work shows once this tab has a Claude session.'));
    return;
  }
  if (isIpcError(result)) {
    container.append(el('p', 'related-empty', result.error));
    return;
  }
  const work = result.related;
  if (!work) {
    container.append(el('p', 'related-empty', 'Nothing recorded for this session yet. It fills in as replies arrive.'));
    return;
  }
  const kicker = el('p', 'related-kicker', `Related work${label ? ` · ${label}` : ''} · ${work.waitsOn.length} earlier · ${work.waitingOnThis.length} later · ${work.overlap.length} overlapping files`);
  container.append(kicker, el('h1', 'related-headline', headline(work)));

  if (work.overlap.length) {
    container.append(section('Overlap', work.overlap.length));
    const list = el('ul', 'related-overlap');
    for (const { file, sessions } of work.overlap) {
      const row = el('li', 'related-overlap-row');
      row.append(el('code', 'related-file', shortFile(file)), el('span', 'related-overlap-who', sessions.map((s) => s.title || s.sessionId.slice(0, 8)).join(' · ')));
      list.append(row);
    }
    container.append(list);
  }
  if (work.waitingOnThis.length) {
    container.append(section('Waiting on this', work.waitingOnThis.length));
    for (const s of work.waitingOnThis) container.append(card(s, work.sharedTopics[s.sessionId] ?? []));
  }
  if (work.waitsOn.length) {
    container.append(section('Waits on', work.waitsOn.length));
    for (const s of work.waitsOn) container.append(card(s, work.sharedTopics[s.sessionId] ?? []));
  }
}
