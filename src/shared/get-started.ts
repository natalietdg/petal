// The Get started checklist's state: which steps are done, from what Petal can see plus what she ticked by hand.

// The official native install line, from code.claude.com/docs/en/setup (macOS and Linux).
export const INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash';

export const STEP_IDS = ['install', 'add-session', 'sign-in', 'ask'] as const;
export type StepId = (typeof STEP_IDS)[number];

export const isStepId = (value: unknown): value is StepId => STEP_IDS.some((id) => id === value);

// What Petal can see right now, gathered from the tabs and the install check.
export interface LiveFacts {
  claudeInstalled: boolean;
  tabCount: number;
  claudeRunning: boolean; // a claude process in any tab
  sessionStarted: boolean; // a session file or transcript for it, so sign-in is behind her
  replied: boolean; // the reader has at least one reply
  pastSessions: boolean; // History has a conversation from before, so she has done all this already
  folderOff: boolean; // reading the Claude folder is off, so sessions and replies stay unseen
}

export interface StepState {
  id: StepId;
  done: boolean;
  auto: boolean; // ticked from real state, so a click can't untick it
  unseen: boolean; // only a hand tick can mark it, since the Claude folder is off
}

// One tab's reader state, as the renderer holds it.
export interface TabFacts {
  state: 'none' | 'live' | 'ended';
  sessionId: string | null;
  replies: number;
}

export function factsFrom(tabs: readonly TabFacts[], claudeInstalled: boolean, pastSessions = false, folderOff = false): LiveFacts {
  return {
    claudeInstalled,
    tabCount: tabs.length,
    claudeRunning: tabs.some((t) => t.state !== 'none'),
    sessionStarted: tabs.some((t) => t.sessionId !== null || t.replies > 0),
    replied: tabs.some((t) => t.replies > 0),
    pastSessions,
    folderOff,
  };
}

const AUTO: Record<StepId, (facts: LiveFacts) => boolean> = {
  install: (f) => f.claudeInstalled,
  'add-session': (f) => f.tabCount > 1 || f.claudeRunning || f.pastSessions,
  'sign-in': (f) => f.sessionStarted || f.pastSessions,
  ask: (f) => f.replied || f.pastSessions,
};

// Seen only through the Claude folder: with reading off they never tick themselves.
const NEEDS_FOLDER: ReadonlySet<StepId> = new Set(['sign-in', 'ask']);

// Known ids only, each once, in checklist order; anything else in the saved list is dropped.
export function cleanDone(saved: unknown): StepId[] {
  if (!Array.isArray(saved)) return [];
  return STEP_IDS.filter((id) => saved.includes(id));
}

export function stepStates(saved: readonly string[], facts: LiveFacts): StepState[] {
  const ticked = new Set(cleanDone(saved));
  return STEP_IDS.map((id) => {
    const auto = AUTO[id](facts);
    return { id, done: auto || ticked.has(id), auto, unseen: facts.folderOff && !auto && NEEDS_FOLDER.has(id) };
  });
}

// Until sign-in is behind her, Claude Code is still on its first-run screens, so the terminal needs room for them.
// Not before Claude Code is installed (no screens yet), nor with the folder off (sign-in can't be seen, so it would never end).
export const needsSetupRoom = (states: readonly StepState[]): boolean =>
  states.some((s) => s.id === 'install' && s.auto) && states.some((s) => s.id === 'sign-in' && !s.done && !s.unseen);

export const allDone = (states: readonly StepState[]): boolean => states.every((s) => s.done);

// Launch reopens Get started only for a step Petal could tick itself; an unseen one waits for her.
export const needsReopen = (states: readonly StepState[]): boolean => states.some((s) => !s.done && !s.unseen);

// What to save: every step done now, so progress Petal saw survives a relaunch.
// Install is checked afresh each launch, so only her own tick of it is kept.
export function toSave(states: readonly StepState[], saved: readonly string[]): StepId[] {
  const ticked = cleanDone(saved);
  return states.filter((s) => s.done && (s.id !== 'install' || ticked.includes('install'))).map((s) => s.id);
}

// A hand tick or untick; a step Petal saw done stays done.
export function toggle(saved: readonly string[], id: StepId, facts: LiveFacts): StepId[] {
  if (AUTO[id](facts)) return cleanDone(saved);
  const ticked = new Set(cleanDone(saved));
  if (ticked.has(id)) ticked.delete(id); else ticked.add(id);
  return STEP_IDS.filter((step) => ticked.has(step));
}

export const sameSteps = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, i) => id === b[i]);
