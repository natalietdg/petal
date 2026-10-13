// The Sessions board's card model: one card per open Claude session, its status, digest, order and filter.
import { newestStatus, type StatusLines } from './status-lines';
import { conclusionGist, type Conclusion } from './conclusion';

export type BoardStatus = 'waiting' | 'working' | 'idle' | 'concluded';
export type BoardFilter = 'all' | 'waiting' | 'working' | 'idle';
export const BOARD_FILTERS: readonly BoardFilter[] = ['all', 'waiting', 'working', 'idle'];

export const STATUS_WORDS: Record<BoardStatus, string> = { waiting: 'Waiting on you', working: 'Working', idle: 'Idle', concluded: 'Concluded' };
export const FILTER_WORDS: Record<BoardFilter, string> = { all: 'All', waiting: 'Waiting', working: 'Working', idle: 'Idle' };

// What a card needs from the newest replies: the headline and the newest Doing / Recommend / Next lines.
export interface ReplyDigest {
  headline: string;
  lines: StatusLines;
  at: number | null; // when the newest reply was written
}

// Main's extra read for a session in another window (the tabs here have it already).
export interface BoardDetail {
  digest: ReplyDigest;
  conclusion: Conclusion | null;
  place: string | null; // "<repo> · <branch>", or the folder outside git
}

// Everything one card is built from, wherever the session lives.
export interface BoardSource {
  sessionId: string;
  tabId: string | null; // a tab in this window, or null for a session elsewhere on the Mac
  name: string; // the full shared session title
  place: string;
  busy: boolean;
  asking: boolean; // a question or permission prompt on its screen
  updatedAt: number | null;
  digest: ReplyDigest;
  conclusion: Conclusion | null;
  agents: number;
  starred: boolean;
}

export interface BoardCard extends Omit<BoardSource, 'busy' | 'asking' | 'conclusion'> {
  status: BoardStatus;
  conclusion: string | null; // the one line shown when concluded
}

export const EMPTY_DIGEST: ReplyDigest = { headline: '', lines: {}, at: null };

const FENCE = /^\s*(```|~~~)/;
const WHOLE_BOLD = /^\s*(\*\*|__)(.+)\1\s*$/;
const LABELLED = /^\s*(?:[-*+]\s+)?(\*\*|__)[^*_]+?(?::\s*\1|\1\s*:)/; // "**Done:** x" or "**Done**: x": a label, never the headline
const plain = (text: string): string => text.replace(/\*\*|__|==|`/g, '').replace(/^#{1,6}\s+/, '').replace(/\s+/g, ' ').trim();

// The first line that is bold all the way through, outside code; else the first unlabelled line of text.
export function replyHeadline(markdown: string): string {
  let fenced = false;
  let firstText = '';
  for (const line of markdown.split(/\r?\n/)) {
    if (FENCE.test(line)) { fenced = !fenced; continue; }
    if (fenced || !line.trim()) continue;
    const bold = WHOLE_BOLD.exec(line);
    if (bold?.[2] && !bold[2].includes(bold[1] ?? '')) return plain(bold[2]);
    if (!LABELLED.test(line)) firstText ||= plain(line);
  }
  return firstText;
}

const timeOf = (iso: string | null | undefined): number | null => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? null : ms;
};

// Replies newest first: the newest one's headline, and status lines from the newest that has any.
export function digestReplies(newestFirst: readonly { markdown: string; timestamp?: string | undefined }[]): ReplyDigest {
  const newest = newestFirst[0];
  if (!newest) return EMPTY_DIGEST;
  return {
    headline: replyHeadline(newest.markdown),
    lines: newestStatus(newestFirst.map((r) => r.markdown)) ?? {},
    at: timeOf(newest.timestamp),
  };
}

// Waiting beats Working (a prompt on screen stops the turn); concluded only while nothing came after the conclude.
export function boardStatus({ busy, asking, conclusion, digest }: Pick<BoardSource, 'busy' | 'asking' | 'conclusion' | 'digest'>): BoardStatus {
  if (asking) return 'waiting';
  if (busy) return 'working';
  const concludedAt = timeOf(conclusion?.at);
  if (conclusion && (digest.at === null || concludedAt === null || digest.at <= concludedAt)) return 'concluded';
  return 'idle';
}

export function toCard(source: BoardSource): BoardCard {
  const status = boardStatus(source);
  const { busy: _busy, asking: _asking, conclusion, ...rest } = source;
  return { ...rest, status, conclusion: status === 'concluded' && conclusion ? conclusionGist(conclusion) : null };
}

const RANK: Record<BoardStatus, number> = { waiting: 0, working: 1, idle: 2, concluded: 3 };

// Waiting first, then Working, then Idle and Concluded; most recent first inside each.
export const sortCards = (cards: readonly BoardCard[]): BoardCard[] =>
  [...cards].sort((a, b) => RANK[a.status] - RANK[b.status] || (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.name.localeCompare(b.name));

// Idle takes concluded sessions too: nothing is running in either.
export function matchesFilter(card: BoardCard, filter: BoardFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'idle') return card.status === 'idle' || card.status === 'concluded';
  return card.status === filter;
}

export const filterCards = (cards: readonly BoardCard[], filter: BoardFilter): BoardCard[] => cards.filter((c) => matchesFilter(c, filter));

// The newer of the session file's update and its newest reply.
export const lastUpdate = (...times: (number | null | undefined)[]): number | null =>
  times.reduce<number | null>((max, t) => (t && (!max || t > max) ? t : max), null);
