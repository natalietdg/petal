// Stand-in for tasks-feed's recordActivity (src/main/activity.ts) until that branch lands; switch the import over then.
export interface MessageActivity {
  kind: 'message';
  at: string; // ISO time sent
  from: string; // sender session name, or "Petal"
  to: string[]; // session names it reached (sent or queued)
  skipped: string[]; // mentioned but not running or closed
  text: string; // her message, unwrapped
}

export type ActivityEvent = MessageActivity;

const KEEP = 200;
const recorded: ActivityEvent[] = [];

export function recordActivity(event: ActivityEvent): void {
  recorded.push(event);
  if (recorded.length > KEEP) recorded.shift();
}

// Newest last; read by the snapshot harness until the shared feed exists.
export const recordedActivity = (): readonly ActivityEvent[] => recorded;
