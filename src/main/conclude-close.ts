// When her "conclude" has been answered, the session is done: this decides the one moment to close it.
// A conclusion already in the log when the reader first read it never closes anything.
import { sameConclusion, type Conclusion } from '../shared/conclusion';

export class ConcludeWatch {
  private sessionId: string | null = null;
  private baseline: Conclusion | null = null; // what the first read found
  private due: Conclusion | null = null; // a newer conclusion, waiting for Claude to finish
  private settled = false; // one idle tick has passed since `due` last changed
  private fired = false;

  // A new session (or the same one followed afresh): its next read is the baseline.
  reset(): void {
    this.sessionId = null;
    this.baseline = null;
    this.due = null;
    this.settled = false;
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
    if (this.fired || !conclusion || sameConclusion(conclusion, this.baseline) || sameConclusion(conclusion, this.due)) return;
    this.due = conclusion;
    this.settled = false; // still being written; wait for a quiet tick
  }

  // Every reader tick; returns the session to close exactly once, two idle ticks after the reply stopped changing.
  tick(busy: boolean): string | null {
    if (this.fired || !this.due || !this.sessionId) return null;
    if (busy || !this.settled) {
      this.settled = !busy;
      return null;
    }
    this.fired = true;
    return this.sessionId;
  }
}
