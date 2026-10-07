// All the app itself knows about snapshot runs (PASTEL_SNAPSHOT=1). The harness lives in src/dev/ and is
// loaded only in those runs; these are the seams it drives: a scratch userData, a fixture session, and counters.
import os from 'node:os';
import path from 'node:path';
import type { SessionFile } from './claude-session';

export const isSnapshotRun = (): boolean => process.env.PASTEL_SNAPSHOT === '1';
export const snapshotOutDir = (): string => process.env.PASTEL_SNAPSHOT_DIR || path.join(os.tmpdir(), 'pastel-snapshot');
export const userDataDir = (): string => path.join(snapshotOutDir(), 'userData');

// PASTEL_SNAPSHOT_FAKE_JSONL=<path>: the first tab replays this fixture instead of following a real claude.
export const fixtureFile = (): string | null => (isSnapshotRun() && process.env.PASTEL_SNAPSHOT_FAKE_JSONL) || null;

// The replayed session; the harness flips `status` to drive busy/idle.
export interface FixtureSession {
  sessionId: string;
  transcript: string;
  status: string;
  cwd?: string; // set by the harness's repo header step only
}
export const fixtureSession = (): FixtureSession | null => {
  const transcript = fixtureFile();
  return transcript ? { sessionId: 'snapshot-fixture', transcript, status: 'idle' } : null;
};

// What the app did or skipped, so the harness can prove it (a stored flow skips the jsonl, the hook never runs).
export const counters = { flowExtractions: 0, hookSkippedInSnapshot: 0 };

// Snapshot runs record the keys a prompt answer would type instead of sending them to the fixture tab's shell.
export const promptWrites: string[][] = [];

// Snapshot runs also record what the terminal typed, so the harness can see a pasted image's Ctrl+V.
export const ptyWrites: { tabId: string; data: string }[] = [];

// Snapshot runs record Open Repo's `cd` instead of typing it, and open no tab for it.
export const repoWrites: { tabId: string; command: string; newTab: boolean }[] = [];

// Fake live sessions the harness shows in the Sessions panel; closing still reads only the real session files.
// subagentsRoot: <root>/<sessionId>/*.jsonl stands in for each fixture session's subagents folder.
export const panelFixture: { sessions: SessionFile[] | null; subagentsRoot: string | null } = { sessions: null, subagentsRoot: null };
