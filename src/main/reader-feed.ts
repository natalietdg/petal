// Pins the reader to the claude running inside one pty; never any other session.
import { findClaudeSession, type ClaudeSession } from './claude-session';
import { TranscriptTail } from './transcript';
import type { ReaderState, ReaderUpdate, Reply } from '../shared/types';

const TICK_MS = 1000;

// The session the reader follows; a fixture replay only fills sessionId, status and transcript.
export type FollowedSession = Pick<ClaudeSession, 'sessionId' | 'transcript'> & Partial<ClaudeSession>;

export interface ReplyFinished {
  reply: Reply;
  sessionId: string;
  cwd: string | null;
}

interface FeedOptions {
  fakeTranscript?: string | null;
  onReplyFinished?: ((finished: ReplyFinished) => void) | null;
}

// Dev-only: a snapshot run can replay a fixture jsonl instead of a live claude.
const FAKE_SESSION = { pid: null, session: null };

export class ReaderFeed {
  private readonly shellPid: number;
  private readonly onReplyFinished: ((finished: ReplyFinished) => void) | null;
  private finishingId: string | null = null; // reply whose turn just went busy -> idle, reported on the next tick
  private readonly fakeTranscript: string | null;
  fakeStatus = 'idle'; // snapshot runs flip this to drive the fixture's busy/idle
  private readonly send: (channel: 'reader:replies', update: ReaderUpdate) => void;
  session: FollowedSession | null = null;
  claudePid: number | null = null;
  private tail: TranscriptTail | null = null;
  private replies: Reply[] = [];
  private ticking = false;
  private readonly timer: NodeJS.Timeout;

  constructor(shellPid: number, send: (channel: 'reader:replies', update: ReaderUpdate) => void, { fakeTranscript = null, onReplyFinished = null }: FeedOptions = {}) {
    this.shellPid = shellPid;
    this.onReplyFinished = onReplyFinished;
    this.fakeTranscript = fakeTranscript;
    this.send = send;
    this.emit('none');
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  // Re-resolved every tick: /clear and /resume change the sessionId.
  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const { pid, session: found }: { pid: number | null; session: FollowedSession | null } = this.fakeTranscript
        ? { ...FAKE_SESSION, session: { sessionId: 'snapshot-fixture', status: this.fakeStatus, transcript: this.fakeTranscript } }
        : await findClaudeSession(this.shellPid);
      this.setClaudePid(pid);
      if (found && found.sessionId !== this.session?.sessionId) this.follow(found);
      else if (found) this.refresh(found);
      else if (this.session) this.end();
    } finally {
      this.ticking = false;
    }
  }

  // Tracks the claude process itself, which can run briefly before its session file is readable.
  private setClaudePid(pid: number | null): void {
    if (pid === this.claudePid) return;
    const exited = this.claudePid && !pid;
    this.claudePid = pid;
    if (pid && !this.session) this.replies = []; // a new claude starts clean
    if (!this.session) this.emit(pid ? 'live' : exited && this.replies.length ? 'ended' : 'none');
  }

  private follow(session: FollowedSession): void {
    this.finishingId = null;
    this.tail?.stop();
    this.session = session;
    this.replies = [];
    this.emit('live');
    this.tail = new TranscriptTail(session.transcript, (replies) => {
      this.replies = replies;
      this.emit('live');
    });
  }

  // Same session: pick up new lines, and re-emit when busy/idle flips (drives the cat).
  private refresh(found: FollowedSession): void {
    const current = this.session;
    if (!current) return; // refresh only runs while following
    const statusChanged = found.status !== current.status;
    const turnEnded = current.status === 'busy' && found.status === 'idle';
    this.session = { ...current, status: found.status };
    this.tail?.poll();
    if (statusChanged) this.emit('live');
    this.reportFinished();
    if (turnEnded) this.finishingId = this.replies[0]?.id ?? null;
  }

  // One tick after the turn ends, so its last transcript lines are in; fires once per finished turn.
  private reportFinished(): void {
    const id = this.finishingId;
    this.finishingId = null;
    const reply = id && this.replies.find((r) => r.id === id);
    if (!reply || !this.onReplyFinished || !this.session) return;
    try {
      this.onReplyFinished({ reply, sessionId: this.session.sessionId, cwd: this.session.cwd ?? null });
    } catch (error) {
      console.error('[petal] reply-finished handler failed:', error); // never stops the reader ticking
    }
  }

  // Claude exited: keep its last replies on screen, marked as ended.
  private end(): void {
    this.finishingId = null;
    this.tail?.stop();
    this.tail = null;
    this.session = null;
    this.emit('ended');
  }

  private emit(state: ReaderState): void {
    const busy = state === 'live' && this.session?.status === 'busy';
    const { sessionId = null, cwd = null } = this.session ?? {};
    this.send('reader:replies', { state, replies: this.replies, busy, sessionId, cwd });
  }

  stop(): void {
    clearInterval(this.timer);
    this.tail?.stop();
  }
}
