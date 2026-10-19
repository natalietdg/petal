// All the app itself knows about snapshot runs (PASTEL_SNAPSHOT=1). The harness lives in src/dev/ and is
// loaded only in those runs; these are the seams it drives: a scratch userData, a fixture session, and counters.
import os from 'node:os';
import path from 'node:path';
import type { SessionFile } from './claude-session';
import type { SessionRecord } from './history';
import type { FolderChoice } from '../shared/claude-folder';

export const isSnapshotRun = (): boolean => process.env.PASTEL_SNAPSHOT === '1';
// The one run that starts as a brand-new install: no folder answer, the pet guide up. Every other run predates the guide.
export const freshInstallRun = (): boolean => isSnapshotRun() && process.env.PASTEL_SNAPSHOT_MODE === 'pet-onboarding';
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

// Fixtures for tabs opened after the first, taken in order (the session-names check); empty in every other run.
export const extraTabFixtures: FixtureSession[] = [];
const takeExtraFixture = (): FixtureSession | null => (isSnapshotRun() ? extraTabFixtures.shift() ?? null : null);
// The first tab replays the fixture; a later one replays a queued extra fixture, if any.
export const tabFixture = (isFirstTab: boolean): FixtureSession | null => (isFirstTab ? fixtureSession() : takeExtraFixture());

// What the app did or skipped, so the harness can prove it (a stored flow skips the jsonl, the hook never runs).
export const counters = { flowExtractions: 0, hookSkippedInSnapshot: 0, organizerPassesSkipped: 0, libraryRunsSkipped: 0 };

// Snapshot runs record the keys a prompt answer would type instead of sending them to the fixture tab's shell.
export const promptWrites: string[][] = [];

// Snapshot runs record each Stop's keys per tab, so the harness can count Escs per tab.
export const stopWrites: { tabId: string; keys: string[] }[] = [];

// Snapshot runs also record what the terminal typed, so the harness can see a pasted image's Ctrl+V.
export const ptyWrites: { tabId: string; data: string }[] = [];

// Snapshot runs also record reply-box pastes, so the harness can see a reply sent from History.
export const pasteWrites: { tabId: string; data: string }[] = [];

// Snapshot runs record Open Repo's `cd` instead of typing it, and open no tab for it.
export const repoWrites: { tabId: string; command: string; newTab: boolean }[] = [];

// A stand-in ~/.claude for Workflow › Setup (read only); null reads the real one.
export const setupFixture: { claudeDir: string | null } = { claudeDir: null };

// A stand-in ~/.claude for Customize › Formatting's output styles; Use this style and Add Petal's reply styles write there. null reads the real one and refuses writes.
// `opened` records Open in editor instead of launching an editor.
export const stylesFixture: { claudeDir: string | null; opened: string[] } = { claudeDir: null, opened: [] };

// Workflow › Factory: a stand-in ~/.claude and project repo. A null claudeDir reads and writes nothing; a null repo means no project.
export const factoryFixture: { claudeDir: string | null; repo: string | null } = { claudeDir: null, repo: null };

// Fake History sessions the harness adds to the list; their logs live in the snapshot folder, never ~/.claude.
// `live` marks some as running in another terminal; `resumes` records the resume a background tab typed a no-op for instead.
// `resumedHere` records a resume in this tab or a foreground one, which snapshot runs also replace with a no-op.
export const historyFixture: { records: SessionRecord[]; live: string[]; resumes: string[]; resumedHere: string[] } = { records: [], live: [], resumes: [], resumedHere: [] };

// Fake live sessions the harness shows in the Sessions panel; closing still reads only the real session files.
// sessions: null means none live, so her limit counts only these and never her real Claudes.
// subagentsRoot: <root>/<sessionId>/*.jsonl stands in for each fixture session's subagents folder.
export const panelFixture: { sessions: SessionFile[] | null; subagentsRoot: string | null } = { sessions: null, subagentsRoot: null };

// A stand-in ~/.claude for the folder-consent check (it holds a sentinel file); null means the real one.
// `choice` seeds a fresh snapshot userData, so every other check runs with reading on.
export const folderFixture: { home: string | null; choice: FolderChoice } = { home: null, choice: 'allowed' };

// Claude Code installed or not, for Get started and Add Session's auto-start; null asks this Mac.
export const claudeFixture: { installed: boolean | null } = { installed: null };

// What Add Session's auto-start or the reply box's Claude start would have typed; snapshot runs never launch claude.
// `prompt` is her message, for the reply box's start only.
export const claudeStarts: { tabId: string; command: string; prompt?: string }[] = [];

// What "Send to Claude" would have typed into a tab's claude; snapshot runs type nothing.
export const handoffWrites: { tabId: string; data: string }[] = [];

// Every close a "conclude" set off, with how it ended; snapshot runs stop before the signal.
export const concludeCloses: { sessionId: string; outcome: string }[] = [];

// Every agent Testing's Close agents tried to close, with how it ended; snapshot runs stop before the signal.
export const agentCloses: { sessionId: string; outcome: string; note: string }[] = [];

// A stand-in ~/.claude for the reply box's "/" menu (read only); null reads the real one.
export const slashFixture: { claudeDir: string | null } = { claudeDir: null };

// The Library's extractor in snapshot runs: the harness's stub, given the prompt; null skips the run. Never a real claude.
export const libraryFixture: { extract: ((prompt: string) => Promise<string>) | null } = { extract: null };

// The Testing tab in snapshot runs: a stand-in project and Claude folder, and every run it would have typed (never executed).
export const testingFixture: {
  project: string | null;
  claudeDir: string | null;
  runs: { runId: string; dir: string; typed: string; script: string; stages: { name: string; command: string; exec: string; report: string | null; exit: string; log: string }[] }[];
  loopStarts: { command: string; brief?: string }[]; // an agent started in a new tab: the line it would have typed, and its brief
  changed: string[] | null; // the project's recently changed files, instead of asking git
  agentIds: string[]; // session ids for the next agents Testing starts, so their fixture tabs match; taken in order
  notices: { title: string; body: string; tabId: string | null; focused: boolean }[]; // loop notifications, recorded instead of shown
  opened: string[]; // criteria files Edit scenarios would have opened in her editor
  resumes: { sessionId: string; command: string }[]; // an agent resumed in an agent terminal: the line it would have typed
} = { project: null, claudeDir: null, runs: [], loopStarts: [], changed: null, agentIds: [], notices: [], opened: [], resumes: [] };
