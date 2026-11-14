// Which optional dock buttons show. A button whose view is open always stays, so she is never stranded in it.
export const MIN_SESSIONS = 2; // Testing and @mentions need a second session to be useful

export interface DockFacts {
  sessions: number; // tabs open in this window
  libraryOn: boolean;
  hasSuite: boolean | null; // null: not known yet
}

export type OptionalButton = 'board-button' | 'testing-button' | 'library-button';
export const OPTIONAL_BUTTONS: readonly OptionalButton[] = ['board-button', 'testing-button', 'library-button'];

// Library once it is turned on or has notes; Testing once a repo has a suite (2+ sessions until that is known); Board always.
export function buttonShown(id: OptionalButton, facts: DockFacts, pressed: boolean): boolean {
  if (pressed) return true;
  if (id === 'library-button') return facts.libraryOn;
  if (id === 'testing-button') return facts.hasSuite ?? facts.sessions >= MIN_SESSIONS;
  return true;
}

// Library counts as on when it builds itself, or already holds notes.
export const libraryOn = (data: { autoBuild: boolean; entries: readonly unknown[] }): boolean => data.autoBuild || data.entries.length > 0;

// Mentions need someone to mention: at least two sessions in this window.
export const mentionsOn = (sessions: number): boolean => sessions >= MIN_SESSIONS;
