// Pins the reader to the claude running inside one pty; never any other session.
import { findClaudeSession, type ClaudeSession, type ProcessRow } from './claude-session';
import { subscribe, unsubscribe, type ProcessListener } from './process-poll';
import { TranscriptTail, type TranscriptView } from './transcript';
import type { FixtureSession } from './snapshot-mode';
import type { PendingQuestion } from '../shared/prompt-answer';
import type { ReaderState, ReaderUpdate, Reply, WaitingPrompt } from '../shared/types';

// The session the reader follows; a fixture replay only fills sessionId, status and transcript.
export type FollowedSession = Pick<ClaudeSession, 'sessionId' | 'transcript'> & Partial<ClaudeSession>;

export interface ReplyFinished {
  reply: Reply;
  sessionId: string;
  cwd: string | null;
}

interface FeedOptions {
  fixture?: FixtureSession | null;
  onReplyFinished?: ((finished: ReplyFinished) => void) | null;
}

export class ReaderFeed implements ProcessListener {
  private readonly shellPid: number;
  private readonly onReplyFinished: ((finished: ReplyFinished) => void) | null;
  private finishingId: string | null = null; // reply whose turn just went busy -> idle, reported on the next tick
  // Dev-only: a snapshot run replays a fixture jsonl instead of a live claude.
  readonly fixture: FixtureSession | null;
  private readonly send: (channel: 'reader:replies', update: ReaderUpdate) => void;
  session: FollowedSession | null = null;
  claudePid: number | null = null;
  private tail: TranscriptTail | null = null;
  private replies: Reply[] = [];
  private waiting: WaitingPrompt[] = [];
  private promptCount = 0;
  private pendingQuestion: PendingQuestion | null = null;
  private ticking = false;

  constructor(shellPid: number, send: (channel: 'reader:replies', update: ReaderUpdate) => void, { fixture = null, onReplyFinished = null }: FeedOptions = {}) {
    this.shellPid = shellPid;
    this.onReplyFinished = onReplyFinished;
    this.fixture = fixture;
    this.send = send;
    this.emit('none');
    subscribe(this);
  }

  get needsProcesses(): boolean {
    return !this.fixture;
  }

  // Re-resolved every tick: /clear and /resume change the sessionId.
  async tick(processes: readonly ProcessRow[]): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const { pid, session: found }: { pid: number | null; session: FollowedSession | null } = this.fixture
        ? { pid: null, session: { ...this.fixture } }
        : findClaudeSession(this.shellPid, processes);
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
    if (pid && !this.session) this.clearTranscript(); // a new claude starts clean
    if (!this.session) this.emit(pid ? 'live' : exited && this.replies.length ? 'ended' : 'none');
  }

  private follow(session: FollowedSession): void {
    this.finishingId = null;
    this.tail?.stop();
    this.session = session;
    this.clearTranscript();
    this.emit('live');
    this.tail = new TranscriptTail(session.transcript, (view) => this.show(view));
  }

  private show({ replies, waiting, promptCount, question }: TranscriptView): void {
    this.replies = replies;
    this.waiting = waiting;
    this.promptCount = promptCount;
    this.pendingQuestion = question;
    this.emit('live');
  }

  private clearTranscript(): void {
    this.replies = [];
    this.waiting = [];
    this.promptCount = 0;
    this.pendingQuestion = null;
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
    this.pendingQuestion = null;
    this.waiting = [];
    this.emit('ended');
  }

  // What the reader may offer to answer: only while this tab's claude is live.
  get question(): PendingQuestion | null {
    return this.session ? this.pendingQuestion : null;
  }

  private emit(state: ReaderState): void {
    const busy = state === 'live' && this.session?.status === 'busy';
    const { sessionId = null, cwd = null } = this.session ?? {};
    const live = state === 'live';
    this.send('reader:replies', {
      state, replies: this.replies, waiting: live ? this.waiting : [], promptCount: this.promptCount, busy, sessionId, cwd, question: live ? this.question : null,
    });
  }

  stop(): void {
    unsubscribe(this);
    this.tail?.stop();
  }
}
