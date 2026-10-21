// What the reader's PRs tab shows for one Claude session: its PRs, the repos they touch, and her checks on them.
import type { PrHost, PrRef } from './pr-links';
import type { MainSafe } from './main-safe';
import type { DeployOrder } from './deploy-order';

export interface SessionPr extends PrRef {
  title: string; // the create command's --title, else the words beside the link, else ''
  branch: string | null;
  localPath: string | null; // the repo's folder on this Mac, where the PR was made
  at: string | null; // when the session first showed it
  created: boolean; // made by gh pr create / az repos pr create in this session, not only mentioned
}

// A repo the session's PRs touch; "service" in her words.
export interface PrService {
  key: string;
  host: PrHost;
  repoId: string;
  repo: string;
  localPath: string | null;
  prUrls: string[];
}

export const PR_NOTE_FIELDS = ['risks', 'env', 'checks'] as const;
export type PrNoteField = (typeof PR_NOTE_FIELDS)[number];
export type PrNotes = Record<PrNoteField, string>;
export const PR_NOTE_LABELS: Record<PrNoteField, string> = { risks: 'Risks', env: 'Env/config', checks: 'Post-deploy checks' };
export const emptyNotes = (): PrNotes => ({ risks: '', env: '', checks: '' });

export interface SessionPrsView {
  sessionId: string;
  prs: SessionPr[];
  services: PrService[];
  mainSafe: Record<string, MainSafe>; // by service key, only for its main as it is now
  order: DeployOrder | null; // only while the PRs' heads are the ones it was proposed for
  notes: Record<string, PrNotes>; // by PR url
}

export const serviceKey = (pr: Pick<PrRef, 'host' | 'repoId'>): string => `${pr.host}:${pr.repoId.toLowerCase()}`;

const baseName = (dir: string): string => dir.replace(/\/+$/, '').split('/').pop()?.toLowerCase() ?? '';

// One entry per repo, in the order the session first showed it. A PR only mentioned borrows the folder another PR
// of the same repo was made in, else the session's own folder when its name is the repo's.
export function groupServices(prs: readonly SessionPr[], sessionCwd: string | null): PrService[] {
  const services = new Map<string, PrService>();
  for (const pr of prs) {
    const key = serviceKey(pr);
    const service = services.get(key) ?? { key, host: pr.host, repoId: pr.repoId, repo: pr.repo, localPath: null, prUrls: [] };
    service.prUrls.push(pr.url);
    service.localPath ??= pr.localPath;
    services.set(key, service);
  }
  for (const service of services.values()) {
    if (!service.localPath && sessionCwd && baseName(sessionCwd) === service.repo.toLowerCase()) service.localPath = sessionCwd;
  }
  return [...services.values()];
}

export const prsTabText = (count: number): string => `PRs (${count})`;
