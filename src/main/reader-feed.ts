// Pins the reader to the claude running inside one pty; never any other session.
import { repoLabel } from './repo-label';
import { findClaudeSession, type ClaudeSession, type ProcessRow } from './claude-session';
import { subscribe, unsubscribe, type ProcessListener } from './process-poll';
import { TranscriptTail, type TranscriptView } from './transcript';
import * as conclusions from './conclusions-store';
import { claudeFolderAllowed } from './claude-folder';
import { isClosingConcludePrompt, sameConclusion, type Conclusion } from '../shared/conclusion';
import { ConcludeWatch } from './conclude-close';
import type { FixtureSession } from './snapshot-mode';
import type { ReaderState, ReaderUpdate, Reply, WaitingPrompt } from '../shared/types';

// The session the reader follows; a fixture replay only fills sessionId, status and transcript.
export type FollowedSession = Pick<ClaudeSession, 'sessionId' | 'transcript'> & Partial<ClaudeSession>;

export interface ReplyFinished {
  reply: Reply;
  sessionId: string;
  cwd: string | null;
}

// The claude to close after her "conclude": this tab's own process, never another tab on the same session.
export interface ConcludedSession {
  sessionId: string;
  pid: number | null; // null only for a snapshot fixture, which has no process
}

interface FeedOptions {
  fixture?: FixtureSession | null;
  onReplyFinished?: ((finished: ReplyFinished) => void) | null;
  onConcluded?: ((concluded: ConcludedSession) => void) | null; // her "conclude" was answered and the turn is over
}

export class ReaderFeed implements ProcessListener {
  private readonly shellPid: number;
  private readonly onReplyFinished: ((finished: ReplyFinished) => void) | null;
  private readonly onConcluded: ((concluded: ConcludedSession) => void) | null;
  private readonly concludeWatch = new ConcludeWatch();
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
  private conclusion: Conclusion | null = null; // kept after claude exits, like the replies
  private repo: string | null = null; // kept after claude exits, so an ended reader still names its repo
  private ticking = false;

  constructor(shellPid: number, send: (channel: 'reader:replies', update: ReaderUpdate) => void, { fixture = null, onReplyFinished = null, onConcluded = null }: FeedOptions = {}) {
    this.shellPid = shellPid;
    this.onReplyFinished = onReplyFinished;
    this.onConcluded = onConcluded;
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
      const allowed = claudeFolderAllowed();
      if (!allowed && this.session) this.forget();
      const { pid, session: found }: { pid: number | null; session: FollowedSession | null } = this.fixture
        ? { pid: null, session: allowed ? { ...this.fixture } : null }
        : findClaudeSession(this.shellPid, processes); // no session file is read while reading is off
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
    if (pid && !this.session) {
      this.clearTranscript(); // a new claude starts clean
      this.repo = null;
    }
    if (!this.session) this.emit(pid ? 'live' : exited && this.replies.length ? 'ended' : 'none');
  }

  private follow(session: FollowedSession): void {
    this.finishingId = null;
    this.concludeWatch.reset();
    this.tail?.stop();
    this.session = session;
    this.repo = repoLabel(session.cwd);
    this.clearTranscript();
    this.emit('live');
    this.tail = new TranscriptTail(session.transcript, (view) => this.show(view));
    void this.refreshConclusion();
  }

  private show({ replies, waiting, promptCount }: TranscriptView): void {
    this.replies = replies;
    this.waiting = waiting;
    this.promptCount = promptCount;
    this.emit('live');
    void this.refreshConclusion();
  }

  // Async, so a first read of a long log never holds up a reply; later reads cover only what the log gained.
  private async refreshConclusion(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const conclusion = await conclusions.refresh(session.sessionId, session.transcript);
    if (this.session?.sessionId !== session.sessionId) return;
    this.concludeWatch.read(session.sessionId, conclusion);
    if (sameConclusion(conclusion, this.conclusion)) return;
    this.conclusion = conclusion;
    this.emit('live');
  }

  private clearTranscript(): void {
    this.replies = [];
    this.waiting = [];
    this.promptCount = 0;
    this.conclusion = null;
  }

  // Same session: pick up new lines, and re-emit when busy/idle flips (drives the cat).
  private refresh(found: FollowedSession): void {
    const current = this.session;
    if (!current) return; // refresh only runs while following
    const statusChanged = found.status !== current.status;
    const turnEnded = current.status === 'busy' && found.status === 'idle';
    this.session = { ...current, status: found.status, cwd: found.cwd };
    const repo = repoLabel(found.cwd);
    const repoChanged = repo !== this.repo; // a branch switch shows on the next tick
    this.repo = repo;
    this.tail?.poll();
    if (statusChanged || repoChanged) this.emit('live');
    this.reportFinished();
    if (turnEnded) this.finishingId = this.replies[0]?.id ?? null;
    this.reportConcluded(found.status !== 'idle'); // 'waiting' (a permission prompt or question on screen) is not done
  }

  private reportConcluded(busy: boolean): void {
    const sessionId = this.concludeWatch.tick({ busy, concludeIsLatest: this.concludeIsLatest() });
    if (!sessionId || !this.onConcluded) return;
    try {
      this.onConcluded({ sessionId, pid: this.claudePid });
    } catch (error) {
      console.error('[petal] conclude handler failed:', error); // never stops the reader ticking
    }
  }

  // Her newest prompt, queued or answered, is a bare "conclude"; hand-backs (no prompt) don't count.
  private concludeIsLatest(): boolean {
    const latest = this.waiting.at(-1)?.prompt ?? this.replies.find((reply) => reply.prompt)?.prompt ?? '';
    return isClosingConcludePrompt(latest);
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

  // Reading was turned off: drop the session and its replies, as if never read.
  private forget(): void {
    this.finishingId = null;
    this.tail?.stop();
    this.tail = null;
    this.session = null;
    this.repo = null;
    this.clearTranscript();
    this.emit(this.claudePid ? 'live' : 'none');
  }

  // Claude exited: keep its last replies on screen, marked as ended.
  private end(): void {
    this.finishingId = null;
    this.tail?.stop();
    this.tail = null;
    this.session = null;
    this.waiting = [];
    this.emit('ended');
  }


  private emit(state: ReaderState): void {
    const busy = state === 'live' && this.session?.status === 'busy';
    const { sessionId = null, cwd = null } = this.session ?? {};
    const live = state === 'live';
    this.send('reader:replies', {
      state, replies: this.replies, waiting: live ? this.waiting : [], promptCount: this.promptCount, busy, sessionId, cwd, repo: state === 'none' ? null : this.repo,
      conclusion: state === 'none' ? null : this.conclusion,
    });
  }

  stop(): void {
    unsubscribe(this);
    this.tail?.stop();
  }
}
