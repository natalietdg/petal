// Pins the reader to the claude running inside one pty; never any other session.
const { findClaudeSession } = require('./claude-session');
const { TranscriptTail } = require('./transcript');

const TICK_MS = 1000;

// Dev-only: a snapshot run can replay a fixture jsonl instead of a live claude.
const FAKE_SESSION = { pid: null, session: null };

class ReaderFeed {
  constructor(shellPid, send, { fakeTranscript = null } = {}) {
    this.shellPid = shellPid;
    this.fakeTranscript = fakeTranscript;
    this.fakeStatus = 'idle';
    this.send = send;
    this.session = null;
    this.claudePid = null;
    this.tail = null;
    this.replies = [];
    this.ticking = false;
    this.emit('none');
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  // Re-resolved every tick: /clear and /resume change the sessionId.
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const { pid, session: found } = this.fakeTranscript
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
  setClaudePid(pid) {
    if (pid === this.claudePid) return;
    const exited = this.claudePid && !pid;
    this.claudePid = pid;
    if (pid && !this.session) this.replies = []; // a new claude starts clean
    if (!this.session) this.emit(pid ? 'live' : exited && this.replies.length ? 'ended' : 'none');
  }

  follow(session) {
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
  refresh(found) {
    const statusChanged = found.status !== this.session.status;
    this.session = { ...this.session, status: found.status };
    this.tail.poll();
    if (statusChanged) this.emit('live');
  }

  // Claude exited: keep its last replies on screen, marked as ended.
  end() {
    this.tail.stop();
    this.tail = null;
    this.session = null;
    this.emit('ended');
  }

  emit(state) {
    const busy = state === 'live' && this.session?.status === 'busy';
    const { sessionId = null, cwd = null } = this.session ?? {};
    this.send('reader:replies', { state, replies: this.replies, busy, sessionId, cwd });
  }

  stop() {
    clearInterval(this.timer);
    this.tail?.stop();
  }
}

module.exports = { ReaderFeed };
