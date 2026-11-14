// The Waiting inbox: each open session's open Decide and running Doing line, newest first, read by the Confirmed parser.
import { confirmedItems, type ConfirmedPill } from './confirmed';
import type { Reply, WaitingPrompt } from './types';

export interface WaitingSource {
  tabId: string;
  title: string;
  replies: readonly Reply[]; // newest first
  waiting: readonly WaitingPrompt[]; // her prompts after the newest reply, oldest first
}

export interface WaitingItem {
  tabId: string;
  title: string;
  text: string; // markdown, rendered inline
  pill: ConfirmedPill;
  replyId: string | undefined;
  at: number | null; // the reply's time in ms
}

const PILL_ORDER: Record<ConfirmedPill, number> = { 'Waiting on you': 0, 'In progress': 1 };

const timeOf = (timestamp: string | undefined): number | null => {
  const ms = Date.parse(timestamp ?? '');
  return Number.isFinite(ms) ? ms : null;
};

// Only the newest reply counts: an older Decide was answered or overtaken by a later reply.
function sessionItems({ tabId, title, replies, waiting }: WaitingSource): WaitingItem[] {
  const newest = replies[0];
  if (!newest) return [];
  const at = timeOf(newest.timestamp);
  const { progress } = confirmedItems([newest], waiting.map((w) => w.prompt));
  return progress.flatMap((item) => (item.pill ? [{ tabId, title, text: item.text, pill: item.pill, replyId: item.replyId, at }] : []));
}

// Newest first; within one moment, what waits on her comes before what is running. Undated replies go last.
export function waitingItems(sources: readonly WaitingSource[]): WaitingItem[] {
  return sources.flatMap(sessionItems).sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || PILL_ORDER[a.pill] - PILL_ORDER[b.pill]);
}

// The button's count: only what waits on her, not what is running.
export const waitingCount = (items: readonly WaitingItem[]): number => items.filter((item) => item.pill === 'Waiting on you').length;

// Board's "Waiting on you" lane: only the open asks; running Doing lines already show on each card.
export const laneItems = (items: readonly WaitingItem[]): WaitingItem[] => items.filter((item) => item.pill === 'Waiting on you');
