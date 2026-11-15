// Every repo's factory jobs as main last reported them, re-read when a job moves. The Board's roll-up, the cat and
// Factory › Jobs read from here; nothing in the renderer touches job files.
import * as cat from './cat';
import { isIpcError } from './dom';
import { jobsBadge, type JobView, type JobsView } from '../shared/factory-jobs';

let view: JobsView | null = null;
const listeners = new Set<() => void>();
const doneSeen = new Set<string>(); // job ids already done when first seen, so an old merge never shows a check

export const current = (): JobsView | null => view;
export const allJobs = (): JobView[] => view?.repos.flatMap((r) => r.jobs) ?? [];

// "2 jobs · 1 waiting" for the session that started them.
export const badgeFor = (sessionId: string): string => jobsBadge(allJobs().filter((j) => j.parentSessionId === sessionId));

export function onChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function apply(next: JobsView): void {
  const first = view === null;
  view = next;
  const jobs = allJobs();
  cat.setJobsAsking(jobs.some((j) => j.waitReason !== null));
  for (const job of jobs.filter((j) => j.state === 'done' && !doneSeen.has(j.id))) {
    doneSeen.add(job.id);
    if (!first) cat.jobDone();
  }
  for (const listener of listeners) listener();
}

export async function refresh(): Promise<JobsView | null> {
  const result = await window.pastel.factory.jobs();
  if (isIpcError(result)) { console.warn('[petal] factory jobs:', result.error); return view; }
  apply(result);
  return result;
}

// After a button or setting: main answers with the fresh view.
export const set = (next: JobsView): void => apply(next);

window.pastel.factory.onJobsChanged(() => { void refresh(); });
void refresh();
