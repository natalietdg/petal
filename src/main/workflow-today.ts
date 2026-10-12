// Workflow, Today tab: today's sessions grouped by tag or project, Petal's open tabs, and recently tidied sessions.
import { bucket, cap, groupsFor, startOfDay, titleOf, type DashboardInputs, type GroupKey } from './workflow-common';
import { NO_SESSION_LABEL, sessionTitle } from '../shared/session-label';

const RECENT_TIDIED = 6;
const OPEN_TAB_TITLE_CHARS = 80;
const STATUSES = ['in progress', 'blocked', 'done'] as const;
type Status = (typeof STATUSES)[number];

export interface OpenTab {
  sessionId: string | null;
  title?: string;
  busy?: boolean;
}

export interface TodayRow {
  sessionId: string;
  title: string;
  status: Status | null;
  lastAt: number;
  live: boolean;
  open: boolean;
  busy: boolean;
}

export interface TodayData {
  groupedBy: 'tag' | 'project';
  total: number;
  counts: Record<Status | 'unlabeled', number>;
  groups: (GroupKey & { items: TodayRow[] })[];
  openTabs: { sessionId: string | null; title: string; busy: boolean }[];
  recentlyTidied: { sessionId: string; title: string; project: string | null; status: string | null; at: string }[];
}

const isStatus = (value: unknown): value is Status => STATUSES.includes(value as Status);

export function todayData({ sessions, labels, tags, openTabs = [], now = Date.now() }: DashboardInputs & { openTabs?: (OpenTab | null)[] }): TodayData {
  const todays = sessions.filter((s) => s.lastAt >= startOfDay(now));
  const tabs = new Map(openTabs.flatMap((t) => (t?.sessionId ? [[t.sessionId, t] as const] : [])));
  const counts = { 'in progress': 0, blocked: 0, done: 0, unlabeled: 0 };
  const groups = new Map<string, GroupKey & { items: TodayRow[] }>();
  for (const session of todays) {
    const status = labels[session.sessionId]?.status ?? null;
    counts[isStatus(status) ? status : 'unlabeled'] += 1;
    const row: TodayRow = {
      sessionId: session.sessionId,
      title: titleOf(session, labels),
      status: isStatus(status) ? status : null,
      lastAt: session.lastAt,
      live: Boolean(session.live),
      open: tabs.has(session.sessionId),
      busy: Boolean(tabs.get(session.sessionId)?.busy),
    };
    for (const group of groupsFor(session, labels, tags)) bucket(groups, group, () => ({ items: [] as TodayRow[] })).items.push(row);
  }
  const recentlyTidied = Object.entries(labels)
    .filter(([, entry]) => typeof entry?.at === 'string')
    .sort((a, b) => b[1].at.localeCompare(a[1].at))
    .slice(0, RECENT_TIDIED)
    .map(([sessionId, entry]) => ({ sessionId, title: entry.title, project: entry.project ?? null, status: entry.status ?? null, at: entry.at }));
  return {
    groupedBy: tags ? 'tag' : 'project',
    total: todays.length,
    counts,
    groups: [...groups.values()].sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name)),
    openTabs: openTabs.map((t) => ({
      sessionId: t?.sessionId ?? null,
      title: cap(t?.title || (t?.sessionId ? sessionTitle({ organizerTitle: labels[t.sessionId]?.title }) : NO_SESSION_LABEL), OPEN_TAB_TITLE_CHARS),
      busy: Boolean(t?.busy),
    })),
    recentlyTidied,
  };
}
