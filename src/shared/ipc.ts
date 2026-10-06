// The IPC contract: every channel between main and the renderer, with its payload and reply types.
// main/ipc.ts and preload.ts only accept channels listed here, so a renamed channel fails typecheck.
import type { Choice, FlowTarget, IpcError, TabId, TabReaderUpdate, Theme, TermSize } from './types';
import type { Config, ConfigPatch } from '../main/config-store';
import type { SessionsSnapshot, SnapshotOptions } from '../main/sessions-monitor';
import type { ListedSession } from '../main/history';
import type { StoredFlow } from '../main/flow-store';
import type { MermaidExport } from '../main/flow-mermaid';
import type { HookRun, HookTestResult } from '../main/response-hook';
import type { OrganizerLabel, OrganizerStatus, PassResult } from '../main/session-organizer';
import type { HandoffData, OpenTab, SetupData, TimeData, TodayData } from '../main/workflow';
import type { TagsData } from '../main/tags-store';

// A guarded handler never rejects: a failure comes back as { error }.
export type Guarded<T> = T | IpcError;

export interface HistoryList {
  sessions: (ListedSession & { hasFlow: boolean; organizer: OrganizerLabel | null; tags: string[] })[];
  tags: TagsData['tags'];
  organizing: boolean;
}

export interface ConversationPage {
  turns: { index: number; prompt: string; reply: string }[];
  start: number;
  total: number;
  missing?: true;
}

export type SendResult = { note: string } | { ok: true; file: string };

export type ResumeResult =
  | { note: string }
  | { confirm: string }
  | { ok: true; focused: boolean }
  | { ok: true; newTab: true; command: string }
  | { ok: true; command: string };

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
  magazinePath: string | null;
  organizer: OrganizerStatus;
  hookRuns: HookRun[];
  hookDir: string;
  configFile: string;
  handoffSample: string;
}

type Ok = { ok: true };

// renderer -> main, answered: ipcRenderer.invoke / ipcMain.handle. Every reply can be { error } (main/ipc-guard.ts).
export interface InvokeChannels {
  'theme:get': { args: []; result: Guarded<Theme> };
  'cat:get': { args: []; result: Guarded<string> };
  'scene:get': { args: []; result: Guarded<string> };
  'reading:get': { args: []; result: Guarded<string> };
  'claude:installed': { args: []; result: Guarded<boolean> };
  'sessions:snapshot': { args: [options: SnapshotOptions]; result: Guarded<SessionsSnapshot> };

  'config:get': { args: []; result: Guarded<CustomizeState> };
  'config:save': { args: [patch: ConfigPatch]; result: Guarded<Config> };
  'config:reset': { args: [keyPath: string]; result: Guarded<Config> };
  'config:test-hook': { args: []; result: Guarded<HookTestResult> };
  'config:hook-runs': { args: []; result: Guarded<HookRun[]> };
  'config:organizer': { args: []; result: Guarded<OrganizerStatus> };

  'workflow:today': { args: [request?: { openTabs?: OpenTab[] }]; result: Guarded<TodayData> };
  'workflow:setup': { args: []; result: Guarded<SetupData> };
  'workflow:time': { args: []; result: Guarded<TimeData> };
  'workflow:handoffs': { args: []; result: Guarded<HandoffData> };

  'history:list': { args: []; result: Guarded<HistoryList> };
  'history:conversation': { args: [request: { sessionId: string; before?: number }]; result: Guarded<ConversationPage> };
  'history:resume': { args: [request: { sessionId: string; confirmFork: boolean }]; result: Guarded<ResumeResult> };
  'history:send': { args: [request: { sessionId: string }]; result: Guarded<SendResult> };
  'history:tidy': { args: []; result: Guarded<PassResult> };
  'history:tag-add': { args: [request: { sessionId: string; name: string }]; result: Guarded<Ok> };
  'history:tag-remove': { args: [request: { sessionId: string; name: string }]; result: Guarded<Ok> };
  'history:tag-delete': { args: [request: { name: string }]; result: Guarded<Ok> };
  'history:tag-rename': { args: [request: { from: string; to: string }]; result: Guarded<Ok> };

  'flow:get': { args: [request: { target: FlowTarget }]; result: Guarded<FlowView | null> };
  'flow:create': { args: [request: { target: FlowTarget }]; result: Guarded<(StoredFlow & { stale: false }) | null> };
  'flow:mermaid': { args: [request: FlowExportRequest]; result: Guarded<MermaidResult | null> };
  'flow:copy-mermaid': { args: [request: FlowExportRequest]; result: Guarded<{ ok: boolean }> };
  'flow:save-mermaid': { args: [request: FlowExportRequest]; result: Guarded<{ ok: boolean; canceled?: true; filePath?: string }> };
}

// What the renderer reports once its terminal is up; logged by snapshot runs only.
export type RendererInfo = Record<string, unknown>;

// renderer -> main, fire and forget: ipcRenderer.send / ipcMain.on.
export interface SendChannels {
  'pty:start': [request: { tabId: TabId } & TermSize];
  'pty:write': [request: { tabId: TabId; data: string }];
  'pty:resize': [request: { tabId: TabId } & TermSize];
  'pty:close': [request: { tabId: TabId }];
  'tab:activate': [request: { tabId: TabId }];
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
  'tabs:new': void;
  'tabs:close-active': void;
  'tabs:cycle': number;
  'tabs:activate': { tabId: TabId };
  'layout:toggle': void;
  'history:toggle': void;
  'customize:open': void;
}

export type InvokeChannel = keyof InvokeChannels;
export type SendChannel = keyof SendChannels;
export type EventChannel = keyof EventChannels;
export type InvokeArgs<C extends InvokeChannel> = InvokeChannels[C]['args'];
export type InvokeResult<C extends InvokeChannel> = InvokeChannels[C]['result'];
// Payload as a rest tuple, so events with no payload take no argument.
export type EventArgs<C extends EventChannel> = EventChannels[C] extends void ? [] : [payload: EventChannels[C]];
