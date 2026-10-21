// A reviewer's proposed prod deployment order for a session's PRs, and how their services depend on each other.
import { prKey } from './pr-links';
import type { PrService, SessionPr } from './session-prs';

export interface DeployStep { url: string; reason: string }
export interface ServiceLink { from: string; to: string; label: string } // service keys; "from" depends on "to"

export interface DeployOrder {
  steps: DeployStep[];
  links: ServiceLink[];
  headsKey: string; // the PR heads it was proposed for
  at: string;
}

const MAX_REASON = 200;
const MAX_LABEL = 40;
export const UNPLACED_REASON = 'The reviewer left this one out; place it yourself.';

// The JSON object in a model's answer, even when it is wrapped in a fence or a sentence.
export function firstJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('The reviewer didn’t answer in the expected format.');
  try { return JSON.parse(text.slice(start, end + 1)); } catch { throw new Error('The reviewer didn’t answer in the expected format.'); }
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []);

function serviceFinder(services: readonly PrService[]): (name: unknown) => string | null {
  return (name) => {
    const wanted = text(name, 200).toLowerCase();
    return services.find((s) => s.repo.toLowerCase() === wanted || s.repoId.toLowerCase() === wanted || s.key === wanted)?.key ?? null;
  };
}

// Keeps only PRs of this session, each once; any the reviewer skipped go last, marked as unplaced.
export function parseDeployOrder(answer: string, prs: readonly SessionPr[], services: readonly PrService[], headsKey: string, at = new Date().toISOString()): DeployOrder {
  const json = firstJsonObject(answer) as { order?: unknown; links?: unknown };
  const byKey = new Map(prs.map((pr) => [prKey(pr), pr]));
  const steps: DeployStep[] = [];
  const placed = new Set<string>();
  for (const item of list(json.order)) {
    const pr = byKey.get(text(item.pr ?? item.url, 500).toLowerCase());
    if (!pr || placed.has(prKey(pr))) continue;
    placed.add(prKey(pr));
    steps.push({ url: pr.url, reason: text(item.reason, MAX_REASON) });
  }
  if (!steps.length) throw new Error('The reviewer didn’t name any of this session’s PRs.');
  for (const pr of prs) if (!placed.has(prKey(pr))) steps.push({ url: pr.url, reason: UNPLACED_REASON });
  const find = serviceFinder(services);
  const links: ServiceLink[] = [];
  for (const item of list(json.links)) {
    const from = find(item.from);
    const to = find(item.to);
    if (!from || !to || from === to || links.some((l) => l.from === from && l.to === to)) continue;
    links.push({ from, to, label: text(item.label, MAX_LABEL) });
  }
  return { steps, links, headsKey, at };
}
