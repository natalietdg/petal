// Words for Claude sessions Petal did not start (ux review, 2026-11-15). Petal can only watch them; she answers where they run.
export const OUTSIDE_MARK = 'outside Petal';

export const OUTSIDE_REASONS = {
  question: 'Asking you a question · answer where it runs',
  decide: 'Has a decision for you · answer where it runs',
  unknown: 'Waiting for you · open where it runs to see why',
} as const;

export const FOLLOW_LABEL = 'Follow';
// Says "copy" before the click: resuming it here forks the conversation, and the original keeps running.
export const OPEN_IN_TAB_LABEL = 'Open a copy in a Petal tab';
export const OPEN_IN_TAB_HINT = 'Starts a copy of this conversation in a Petal tab. The original keeps running where it is.';
export const FOLLOW_BANNER = 'Following, read-only. This session runs outside Petal. To answer, use the app or terminal where it runs.';
export const FOLLOW_ENDED_BANNER = 'Following, read-only. This session has ended.';
export const STOP_FOLLOWING = 'Stop following';
export const ENDED_TODAY = 'Ended today';
// Board's Close still quits it (#529), so the question says where it runs and what is lost.
export const OUTSIDE_CLOSE_CONFIRM = 'Quit this Claude? It runs outside Petal, and the app or terminal where it runs will lose it.';
export const NO_SESSIONS = 'No Claude sessions are running. Sessions you start anywhere on this Mac show up here.';
export const RECENT_HOURS = 12;

// Onboarding and the empty reader: the first page can be a session she already has (ux review #5).
export const FOLLOW_OFFER_TITLE = 'Follow a session you already have';
export const FOLLOW_OFFER_LINE = 'Claude is already running outside Petal. Follow one here, read-only. You answer it where it runs.';
export const FOLLOW_OFFER_MAX = 3;
