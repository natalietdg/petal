// The IPC contract: every channel between main and the renderer, with its payload and reply types.
// main/ipc.ts and preload.ts only accept channels listed here, so a renamed channel fails typecheck.
import type { Choice, FlowTarget, IpcError, TabId, TabReaderUpdate, Theme, TermSize } from './types';
import type { Config, ConfigPatch } from '../main/config-store';
import type { SessionCounts, SessionsSnapshot, SnapshotOptions } from '../main/sessions-monitor';
import type { ListedSession, PastSessionsSummary } from '../main/history';
import type { StoredFlow } from '../main/flow-store';
import type { MermaidExport } from '../main/flow-mermaid';
import type { HookRun, HookTestResult } from '../main/response-hook';
import type { OutputStyles, StyleSwitch } from '../main/output-styles';
import type { PetalStyles } from '../main/petal-styles';
import type { PetalSkills } from '../main/petal-skills';
import type { PathTip } from './claude-setup-hints';
import type { OrganizerLabel, OrganizerStatus, PassResult } from '../main/session-organizer';
import type { HandoffData, OpenTab, SetupData, TimeData, TodayData } from '../main/workflow';
import type { FactoryScope, FactoryState } from '../main/factory-store';
import type { Factory } from './factory';
import type { TagsData } from '../main/tags-store';
import type { ClosedSession } from '../main/closed-store';
import type { PromptAnswerRequest } from './prompt-answer';
import type { RepoEntry } from '../main/repo-scan';
import type { SaveResult } from '../main/notes-store';
import type { AgentsList, TimelineStart, TimelineUpdate } from '../main/agents';
import type { Conclusion } from './conclusion';
import type { PromptImage } from '../main/paste-image';
import type { ReplyImageStatus } from './reply-image-url';
import type { SlashList } from './slash';
import type { Delivery } from './mentions';
import type { BackfillDays, BackfillPlan, BackfillState, LibraryDoc, LibraryEditResult, LibraryList, LibraryRunResult } from './library';
import type { TokenEstimate } from './library-cost';
import type { DuplicatePair } from './library-titles';
import type { LessonEditResult, LessonPreviewResult, LessonsList, LessonTarget } from './lessons';
import type { DistillRecord } from './distillation';
import type { ClaudePipelineState, PipelineConfig, PipelineRun, RunReply, TestingState } from './testing';
import type { Criteria } from './test-loop';
import type { TextStep } from './text-size';
import type { SessionInfo } from './session-info';
import type { ActivityEvent } from './activity';
import type { CoordView, TaskChangeResult, TaskOp, TasksView } from './coord';
import type { Prd, Task } from './tasks';

// A guarded handler never rejects: a failure comes back as { error }.
export type Guarded<T> = T | IpcError;

export interface HistoryList {
  sessions: (ListedSession & { hasFlow: boolean; organizer: OrganizerLabel | null; tags: string[]; notes: string; conclusion: Conclusion | null })[];
  tags: TagsData['tags'];
  organizing: boolean;
}

export interface ConversationPage {
  turns: { index: number; prompt: string; reply: string }[];
  start: number;
  total: number;
  missing?: true;
}

// The Sessions panel: live counts and rows, her limit, and (when open) what can be reopened.
export interface SessionsView extends SessionsSnapshot {
  maxOpen: number;
  closed?: ClosedSession[];
  oldestIdleId?: string | null;
  here: { running: number; total: number }; // the reader's session agents, for its header chip
}

// The Agents dropdown: a session's subagents, and the one opened in the right panel.
export type AgentsView = AgentsList & { sessionId: string | null; sessionLabel: string | null }; // the shared session name
export type AgentOpenResult = (TimelineStart & { agentId: string }) | { missing: true };

// "Agents · 3 running"; with none running, how many ran today.
export const agentsChipText = ({ running, total }: { running: number; total: number }): string =>
  running ? `Agents · ${running} running` : `Agents · ${total} today`;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

// "Sessions · 1 busy · 5 open · 3 agents"; busy and agents only when above zero.
export function sessionsPillText({ busy, total, agents }: SessionCounts): string {
  if (total === 0) return 'No sessions yet';
  const parts = ['Sessions'];
  if (busy > 0) parts.push(`${busy} busy`);
  parts.push(`${total} open`);
  if (agents > 0) parts.push(plural(agents, 'agent'));
  return parts.join(' · ');
}

export const agentsBadgeText = (count: number): string => plural(count, 'agent');

export type CloseResult = { closed: true } | { closed: false; note: string };

export type SendResult = { note: string } | { ok: true; file: string };

export type ResumeResult =
  | { note: string }
  | { confirm: string }
  | { ok: true; focused: boolean }
  | { ok: true; newTab: true; command: string }
  | { ok: true; command: string }
  | { ok: true; tabId: TabId }; // a background reply: this window's tab already showing the session

export type FlowView = (StoredFlow & { stale: boolean }) | { empty: true; creating: boolean };

export interface FlowExportRequest {
  target: FlowTarget;
  all: boolean;
}

export type MermaidResult = MermaidExport & { title: string };

export interface CustomizeState {
  config: Config;
  defaults: Config;
  models: string[];
  look: { theme: string; reading: string; cat: string; scene: string };
  choices: { themes: Choice[]; reading: readonly Choice[]; cats: readonly Choice[]; scenes: readonly Choice[] };
  outputStyle: string | null;
  outputStyles: OutputStyles;
  petalStyles: PetalStyles;
  petalSkills: PetalSkills;
  magazinePath: string | null;
  organizer: OrganizerStatus;
  backgroundCalls: number; // Petal's headless Claude calls today, all kinds
  libraryRange: { low: number; high: number }; // Build my Library's tokens per session, estimated locally
  backgroundModels: readonly string[];
  hookRuns: HookRun[];
  hookDir: string;
  configFile: string;
  handoffSample: string;
}

type Ok = { ok: true };

// Open Repo: the indexed repos, and whether a pick here would go to a new tab (Claude is live in this one).
export interface ReposList {
  repos: RepoEntry[];
  scannedAt: number | null;
  scanning: boolean;
  claudeLive: boolean;
}

// The update pill's Restart: either it is restarting, or a note says why not.
export type RestartResult = { restarting: true } | { note: string };
// What a manual Check for Updates reports in the pill; a downloaded update shows as the Restart pill instead.
export type UpdateNote =
  | { kind: 'checking' }
  | { kind: 'up-to-date'; version: string }
  | { kind: 'downloading'; version: string }
  | { kind: 'off' }
  | { kind: 'failed' };
// After a restart into a new version; hasNotes when the bundled CHANGELOG.md has its section.
export type WhatsNew = { version: string; hasNotes: boolean };
export interface UpdateStatus { readyVersion: string | null; whatsNew: WhatsNew | null }

export const updatePillText = (version: string): string => `Petal ${version} ready · Restart`;
export const whatsNewText = ({ version, hasNotes }: WhatsNew): string => (hasNotes ? `Updated to ${version} · What's new` : `Updated to ${version}`);
// Longest first: a narrow dock takes the first form that keeps it one row; the first is always the full text.
export const updatePillForms = (version: string): string[] => [updatePillText(version), `${version} · Restart`, 'Restart'];
export const whatsNewForms = (whatsNew: WhatsNew): string[] => [whatsNewText(whatsNew), ...(whatsNew.hasNotes ? [`${whatsNew.version} · What's new`, "What's new"] : [whatsNew.version])];
export function updateNoteText(note: UpdateNote): string {
  switch (note.kind) {
    case 'checking': return 'Checking…';
    case 'up-to-date': return `Petal is up to date (${note.version})`;
    case 'downloading': return `Downloading Petal ${note.version}…`;
    case 'off': return 'Updates are off in this build';
    case 'failed': return 'Couldn’t check for updates. Try again later.';
  }
}

export type RepoOpenResult = { note: string } | { ok: true; newTab: boolean; command: string };

// renderer -> main, answered: ipcRenderer.invoke / ipcMain.handle. Every reply can be { error } (main/ipc-guard.ts).
export interface InvokeChannels {
  'theme:get': { args: []; result: Guarded<Theme> };
  'cat:get': { args: []; result: Guarded<string> };
  'scene:get': { args: []; result: Guarded<string> };
  'reading:get': { args: []; result: Guarded<string> };
  'claude:installed': { args: [request?: { recheck?: boolean }]; result: Guarded<boolean> };
  'claude:path-tip': { args: []; result: Guarded<PathTip | null> }; // her shell's PATH lacks claude's folder
  'update:status': { args: []; result: Guarded<UpdateStatus> };
  'update:restart': { args: []; result: Guarded<RestartResult> };
  'update:whats-new': { args: []; result: Guarded<Ok> };
  'sessions:snapshot': { args: [options: SnapshotOptions]; result: Guarded<SessionsView> };
  'sessions:close': { args: [sessionId: string]; result: Guarded<CloseResult> };
  // sessionId null: the reader's own session.
  'agents:list': { args: [request: { sessionId: string | null }]; result: Guarded<AgentsView> };
  'agents:open': { args: [request: { sessionId: string; agentId: string }]; result: Guarded<AgentOpenResult> };
  'agents:poll': { args: []; result: Guarded<Ok> };
  'agents:close': { args: []; result: Guarded<Ok> };

  'config:get': { args: []; result: Guarded<CustomizeState> };
  'config:save': { args: [patch: ConfigPatch]; result: Guarded<Config> };
  'config:reset': { args: [keyPath: string]; result: Guarded<Config> };
  'config:test-hook': { args: []; result: Guarded<HookTestResult> };
  'config:hook-runs': { args: []; result: Guarded<HookRun[]> };
  'config:organizer': { args: []; result: Guarded<OrganizerStatus> };
  'config:open-style': { args: [file: string]; result: Guarded<Ok> };
  'config:use-style': { args: [name: string]; result: Guarded<StyleSwitch> };
  'config:add-petal-styles': { args: []; result: Guarded<PetalStyles> };
  'config:add-petal-skills': { args: []; result: Guarded<PetalSkills> };
  // This window's saved reader share, or null for the default.
  'layout:get-split': { args: []; result: Guarded<number | null> };
  'layout:save-split': { args: [fraction: number]; result: Guarded<Ok> };

  'workflow:today': { args: [request?: { openTabs?: OpenTab[] }]; result: Guarded<TodayData> };
  'workflow:setup': { args: []; result: Guarded<SetupData> };
  'workflow:time': { args: []; result: Guarded<TimeData> };
  'workflow:handoffs': { args: []; result: Guarded<HandoffData> };
  // The reply box's "/" menu; cwd is the session's folder, for its project skills, commands and agents.
  'slash:list': { args: [request: { cwd: string | null }]; result: Guarded<SlashList> };
  // The Library: its notes, one note's Markdown, and gathering from a tab's session now (read-only but for Petal's own notes).
  'library:list': { args: []; result: Guarded<LibraryList> };
  'library:read': { args: [request: { slug: string }]; result: Guarded<LibraryDoc> };
  'library:add-session': { args: [request: { tabId: TabId }]; result: Guarded<LibraryRunResult> };
  'library:add-estimate': { args: [request: { tabId: TabId }]; result: Guarded<TokenEstimate | { skipped: string }> };
  // Reading past sessions: count first, then run in the background until done or stopped.
  'library:backfill-plan': { args: [request: { days: BackfillDays }]; result: Guarded<BackfillPlan | { skipped: string }> };
  'library:backfill-start': { args: [request: { days: BackfillDays }]; result: Guarded<BackfillState | { skipped: string }> };
  'library:backfill-stop': { args: []; result: Guarded<BackfillState> };
  'library:backfill-state': { args: []; result: Guarded<BackfillState> };
  // Her edits to notes; the folded or deleted note goes to the Library's .trash.
  'library:rename': { args: [request: { slug: string; title: string }]; result: Guarded<LibraryEditResult> };
  'library:recategorize': { args: [request: { slug: string; category: string }]; result: Guarded<LibraryEditResult> };
  'library:delete': { args: [request: { slug: string }]; result: Guarded<LibraryEditResult> };
  'library:restore': { args: [request: { trashId: string }]; result: Guarded<LibraryEditResult> };
  'library:merge': { args: [request: { from: string; into: string }]; result: Guarded<LibraryEditResult> };
  'library:duplicates': { args: []; result: Guarded<DuplicatePair[]> };
  'library:keep-both': { args: [request: { a: string; b: string }]; result: Guarded<{ ok: true } | { error: string }> };
  // Lessons: how-to-work rules from sessions. A CLAUDE.md is written only by add, with a token from preview.
  'lessons:list': { args: []; result: Guarded<LessonsList> };
  'lessons:dismiss': { args: [request: { id: string }]; result: Guarded<LessonEditResult> };
  'lessons:merge': { args: [request: { keep: string; fold: string }]; result: Guarded<LessonEditResult> };
  'lessons:preview': { args: [request: { id: string; target: LessonTarget }]; result: Guarded<LessonPreviewResult> };
  'lessons:add': { args: [request: { token: string }]; result: Guarded<LessonEditResult> };
  // A concluded session's This session line: its Library notes, test runs and test loop; null when its log can't be read.
  'conclusion:info': { args: [request: { sessionId: string }]; result: Guarded<SessionInfo | null> };
  // The Testing tab, for a tab's project: detect reads its files and skills; run opens a new tab after her click.
  'testing:detect': { args: [request: { tabId: TabId; root?: string | null }]; result: Guarded<TestingState> };
  'testing:history': { args: [request: { tabId: TabId; root?: string | null }]; result: Guarded<{ runs: PipelineRun[]; running: string | null; sessionTab: string | null; criteria: Criteria | null; claudePipeline: ClaudePipelineState | null; distillation: DistillRecord[]; tasks: Task[]; prds: Prd[]; sessionTaskId: string | null }> };
  'testing:loop-start': { args: [request: { tabId: TabId; root?: string | null; brief: string; newTab: boolean }]; result: Guarded<{ tabId: string | null } | { note: string }> };
  'testing:save-pipeline': { args: [request: { tabId: TabId; root?: string | null; pipeline: PipelineConfig }]; result: Guarded<{ ok: true } | { note: string }> };
  'testing:use-claude-pipeline': { args: [request: { tabId: TabId; root?: string | null }]; result: Guarded<{ ok: true } | { note: string }> };
  'testing:run': { args: [request: { tabId: TabId; root?: string | null; stageId?: string | null; confirmed?: boolean }]; result: Guarded<RunReply> };
  'testing:stop': { args: [request: { runId: string }]; result: Guarded<{ ok: true }> };
  // The factory: global (Claude folder) and the active tab's project; repo is the one the view showed.
  'factory:get': { args: []; result: Guarded<FactoryState> };
  'factory:save': { args: [request: { scope: FactoryScope; repo: string | null; factory: Factory }]; result: Guarded<FactoryState> };
  'factory:use-global': { args: [request: { repo: string }]; result: Guarded<FactoryState> };

  'history:list': { args: []; result: Guarded<HistoryList> };
  'history:past-summary': { args: []; result: Guarded<PastSessionsSummary> }; // the setup guide's import card
  'history:conversation': { args: [request: { sessionId: string; before?: number }]; result: Guarded<ConversationPage> };
  // background: open it in a tab that isn't shown (a reply from History's preview).
  'history:resume': { args: [request: { sessionId: string; confirmFork: boolean; background?: boolean }]; result: Guarded<ResumeResult> };
  'history:send': { args: [request: { sessionId: string }]; result: Guarded<SendResult> };
  'history:tidy': { args: []; result: Guarded<PassResult> };
  'history:tag-add': { args: [request: { sessionId: string; name: string }]; result: Guarded<Ok> };
  'history:tag-remove': { args: [request: { sessionId: string; name: string }]; result: Guarded<Ok> };
  'history:tag-delete': { args: [request: { name: string }]; result: Guarded<Ok> };
  'history:tag-rename': { args: [request: { from: string; to: string }]; result: Guarded<Ok> };
  // Her private notes for one Claude session; read and written only by Petal.
  'notes:get': { args: [request: { sessionId: string }]; result: Guarded<{ text: string }> };
  'notes:save': { args: [request: { sessionId: string; text: string }]; result: Guarded<SaveResult> };

  'flow:get': { args: [request: { target: FlowTarget }]; result: Guarded<FlowView | null> };
  'flow:create': { args: [request: { target: FlowTarget }]; result: Guarded<(StoredFlow & { stale: false }) | null> };
  'flow:mermaid': { args: [request: FlowExportRequest]; result: Guarded<MermaidResult | null> };
  'flow:copy-mermaid': { args: [request: FlowExportRequest]; result: Guarded<{ ok: boolean }> };
  'flow:save-mermaid': { args: [request: FlowExportRequest]; result: Guarded<{ ok: boolean; canceled?: true; filePath?: string }> };

  'repos:list': { args: [request: { tabId: TabId }]; result: Guarded<ReposList> };
  'repos:open': { args: [request: { tabId: TabId; path: string }]; result: Guarded<RepoOpenResult> };

  // The reply box's send: answered, so a send that never reached the pty can be taken back.
  'pty:paste': { args: [request: { tabId: TabId; data: string }]; result: Guarded<{ sent: boolean }> };
  // A message to other sessions in this window (mentions, Board's Message…, a reply's To line); main wraps and pastes it.
  'mentions:send': { args: [request: { from: TabId | null; to: TabId[]; text: string }]; result: Guarded<{ deliveries: Delivery[] }> };
  // An image pasted into the reply box, saved as a PNG; Claude reads it by the returned path.
  'paste:save-image': { args: [request: { bytes: Uint8Array }]; result: Guarded<{ file: string }> };
  // An image path in one of her messages, as a data URL; prompt is the text that names it.
  'paste:image': { args: [request: { file: string; prompt: string }]; result: Guarded<PromptImage> };
  // The Board's Activity tab: every recorded event, newest first.
  'activity:list': { args: []; result: Guarded<ActivityEvent[]> };
  // The Board's Tasks: the tab's project list, and one change to it (giving a task returns the brief to send).
  'tasks:get': { args: [request: { tabId: TabId }]; result: Guarded<TasksView> };
  'tasks:change': { args: [request: { tabId: TabId; op: TaskOp }]; result: Guarded<TaskChangeResult> };
  // Every live session's repo, branch, task and file clashes.
  'coord:get': { args: []; result: Guarded<CoordView> };
  // A picture a reply names (main/reply-image.ts checks each): why it isn't shown, Show in Finder, Open in its default app.
  'reply-image:status': { args: [request: { path: string; cwd: string | null }]; result: Guarded<ReplyImageStatus> };
  'reply-image:reveal': { args: [request: { path: string; cwd: string | null }]; result: Guarded<{ ok: boolean }> };
  'reply-image:open': { args: [request: { path: string; cwd: string | null }]; result: Guarded<{ ok: boolean }> };
}

// What the renderer reports once its terminal is up; logged by snapshot runs only.
export type RendererInfo = Record<string, unknown>;

// renderer -> main, fire and forget: ipcRenderer.send / ipcMain.on.
export interface SendChannels {
  // startClaude: type `claude` once the shell is ready, if Claude Code is installed (Add Session, ⌘T, +).
  'pty:start': [request: { tabId: TabId; startClaude?: boolean } & TermSize];
  'pty:write': [request: { tabId: TabId; data: string }];
  'pty:resize': [request: { tabId: TabId } & TermSize];
  'pty:close': [request: { tabId: TabId }];
  'tab:activate': [request: { tabId: TabId }];
  'tab:start-claude': [request: { tabId: TabId; prompt: string }];
  'reader:pick-session': [request: { tabId: TabId; sessionId: string }]; // her answer to "which log is this tab's"
  // A structured choice; main turns it into keystrokes, so the renderer never sends raw keys here.
  'prompt:answer': [request: PromptAnswerRequest];
  'link:open': [url: string];
  'renderer:ready': [info: RendererInfo];
  'look:theme': [id: string];
  'look:reading': [id: string];
  'look:cat': [id: string];
  'look:scene': [id: string];
}

// main -> renderer: webContents.send / ipcRenderer.on. void = no payload.
export interface EventChannels {
  'theme:changed': Theme;
  'cat:changed': string;
  'scene:changed': string;
  'reading:changed': string;
  'pty:data': { tabId: TabId; data: string };
  'reader:replies': TabReaderUpdate;
  'tab:closed': { tabId: TabId };
  'tab:label': { tabId: TabId; label: string }; // its session got a (new) title after the last reader update
  'session:titles': void; // some open session's title changed; History re-lists
  'tabs:new': { background: boolean; tabId: TabId }; // main picks the id, so its pending command reaches this tab
  'tabs:new-session': void; // ⌘T: a tab meant for Claude, so her limit applies
  'tabs:close-active': void;
  'tabs:cycle': number;
  'tabs:activate': { tabId: TabId };
  'layout:toggle': void;
  'history:toggle': void;
  'board:toggle': void; // ⌘⇧O: the Sessions board
  'focus:toggle': void; // ⌘⇧F: only the reply, full window
  'headers:toggle': void; // ⌘⇧H: the dock and reader header folded to a thin strip
  'text-size:step': TextStep; // ⌘= bigger, ⌘- smaller, ⌘0 actual size
  'text-size:changed': Config['text']; // saved in any window; every window follows
  'claude:stop': void; // ⌘.: Esc to the active tab's working Claude
  'history:conclusions': void; // a session's conclusion changed since History last listed it
  'customize:open': void;
  'welcome:open': void; // snapshot runs only
  'get-started:open': void; // snapshot runs only
  'pet-guide:open': void; // Help › Get started
  'claude-folder:changed': boolean; // reading ~/.claude allowed or not
  'colour-key:open': void;
  'shortcuts:toggle': void; // ⌘/ and Help › Keyboard Shortcuts
  'repos:palette': void;
  'library:changed': void; // a run added or updated notes
  'lessons:changed': void; // a run kept new lessons
  'conclusion:info-changed': { sessionId: string }; // the Library started or finished reading that session
  'library:backfill': BackfillState; // reading past sessions moved on
  'testing:run-update': { root: string; run: PipelineRun }; // a stage started or finished
  'update:ready': { version: string };
  'update:note': UpdateNote;
  'agents:timeline': TimelineUpdate & { agentId: string };
  'activity:changed': void; // the activity feed gained or changed an event
  'coord:update': CoordView; // a session's task, branch or file clashes changed
}

export type InvokeChannel = keyof InvokeChannels;
export type SendChannel = keyof SendChannels;
export type EventChannel = keyof EventChannels;
export type InvokeArgs<C extends InvokeChannel> = InvokeChannels[C]['args'];
export type InvokeResult<C extends InvokeChannel> = InvokeChannels[C]['result'];
// Payload as a rest tuple, so events with no payload take no argument.
export type EventArgs<C extends EventChannel> = EventChannels[C] extends void ? [] : [payload: EventChannels[C]];
