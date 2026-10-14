// When her "conclude" has been answered, the session is done: this decides the one moment to close it.
// A conclusion already in the log when the reader first read it, even half written, never closes anything.
import { sameConclusion, type Conclusion } from '../shared/conclusion';

// One reader tick, as the watch needs it.
export interface ConcludeTick {
  busy: boolean; // this tab's claude is anything but idle: working, or a prompt open on screen
  concludeIsLatest: boolean; // her newest prompt is a bare "conclude"; anything she sent after it cancels the close
}

export class ConcludeWatch {
  private sessionId: string | null = null;
  private baseline: Conclusion | null = null; // what the first read found
  private due: Conclusion | null = null; // a newer conclusion, waiting for Claude to finish
  private settled = false; // one idle tick has passed since `due` last changed
  private worked = false; // this tab's claude was busy since her "conclude"; another tab on the same log never was
  private fired = false;

  // A new session (or the same one followed afresh): its next read is the baseline.
  reset(): void {
    this.sessionId = null;
    this.baseline = null;
    this.due = null;
    this.settled = false;
    this.worked = false;
    this.fired = false;
  }

  // Every conclusion read of the followed session's log.
  read(sessionId: string, conclusion: Conclusion | null): void {
    if (sessionId !== this.sessionId) {
      this.reset();
      this.sessionId = sessionId;
      this.baseline = conclusion;
      return;
    }
    if (this.fired || !conclusion || sameConclusion(conclusion, this.due)) return;
    if (this.baseline && conclusion.at === this.baseline.at) return; // the baseline answer still streaming in
    this.due = conclusion;
    this.settled = false; // still being written; wait for a quiet tick
  }

  // Every reader tick; returns the session to close exactly once, two idle ticks after the reply stopped changing.
  tick({ busy, concludeIsLatest }: ConcludeTick): string | null {
    if (!concludeIsLatest) {
      this.worked = false;
      this.settled = false;
      return null;
    }
    if (busy) this.worked = true;
    if (this.fired || !this.due || !this.sessionId) return null;
    if (busy || !this.settled || !this.worked) {
      this.settled = !busy;
      return null;
    }
    this.fired = true;
    return this.sessionId;
  }
}
