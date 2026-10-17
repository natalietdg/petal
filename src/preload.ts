import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { EventChannel, EventChannels, InvokeArgs, InvokeChannel, InvokeResult, SendChannel, SendChannels } from './shared/ipc';
import type { FlowTarget, TabId, TermSize } from './shared/types';
import type { PromptAnswer } from './shared/prompt-answer';
import type { BackfillDays, BackfillState } from './shared/library';
import type { LessonTarget } from './shared/lessons';

// Typed against the contract in shared/ipc.ts; ipcRenderer itself is untyped.
const invoke = <C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>> => ipcRenderer.invoke(channel, ...args);
const send = <C extends SendChannel>(channel: C, ...args: SendChannels[C]): void => ipcRenderer.send(channel, ...args);

const subscribe = <C extends EventChannel>(channel: C, callback: (payload: EventChannels[C]) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: EventChannels[C]) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

export type TabCommand =
  | { kind: 'new'; background: boolean; tabId: TabId }
  | { kind: 'new-session' }
  | { kind: 'close-active' }
  | { kind: 'cycle'; delta: number }
  | { kind: 'activate'; tabId: TabId };

const api = {
  getTheme: () => invoke('theme:get'),
  getSessions: (options: InvokeArgs<'sessions:snapshot'>[0]) => invoke('sessions:snapshot', options),
  closeSession: (sessionId: string) => invoke('sessions:close', sessionId),
  agents: {
    list: (sessionId: string | null) => invoke('agents:list', { sessionId }),
    open: (sessionId: string, agentId: string) => invoke('agents:open', { sessionId, agentId }),
    poll: () => invoke('agents:poll'),
    close: () => invoke('agents:close'),
    onTimeline: (callback: (update: EventChannels['agents:timeline']) => void) => subscribe('agents:timeline', callback),
  },
  onTheme: (callback: (theme: EventChannels['theme:changed']) => void) => subscribe('theme:changed', callback),
  getCat: () => invoke('cat:get'),
  onCat: (callback: (catId: string) => void) => subscribe('cat:changed', callback),
  getScene: () => invoke('scene:get'),
  onScene: (callback: (sceneId: string) => void) => subscribe('scene:changed', callback),
  getReading: () => invoke('reading:get'),
  claudeInstalled: (recheck = false) => invoke('claude:installed', { recheck }),
  claudePathTip: () => invoke('claude:path-tip'),
  onReading: (callback: (readingId: string) => void) => subscribe('reading:changed', callback),
  startShell: (tabId: TabId, { cols, rows }: TermSize, startClaude = false) => send('pty:start', { tabId, cols, rows, startClaude }),
  write: (tabId: TabId, data: string) => send('pty:write', { tabId, data }),
  paste: (tabId: TabId, data: string) => invoke('pty:paste', { tabId, data }),
  startClaude: (tabId: TabId, prompt: string) => send('tab:start-claude', { tabId, prompt }),
  pickSession: (tabId: TabId, sessionId: string) => send('reader:pick-session', { tabId, sessionId }),
  savePastedImage: (bytes: Uint8Array) => invoke('paste:save-image', { bytes }),
  sendMention: (from: TabId | null, to: TabId[], text: string) => invoke('mentions:send', { from, to, text }),
  promptImage: (file: string, prompt: string) => invoke('paste:image', { file, prompt }),
  replyImage: {
    status: (path: string, cwd: string | null) => invoke('reply-image:status', { path, cwd }),
    reveal: (path: string, cwd: string | null) => invoke('reply-image:reveal', { path, cwd }),
    open: (path: string, cwd: string | null) => invoke('reply-image:open', { path, cwd }),
  },
  // A dropped file's absolute path; '' for a file made in the page.
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  answerPrompt: (tabId: TabId, answer: PromptAnswer) => send('prompt:answer', { tabId, answer }),
  resize: (tabId: TabId, { cols, rows }: TermSize) => send('pty:resize', { tabId, cols, rows }),
  closeShell: (tabId: TabId) => send('pty:close', { tabId }),
  activateTab: (tabId: TabId) => send('tab:activate', { tabId }),
  onData: (callback: (payload: EventChannels['pty:data']) => void) => subscribe('pty:data', callback),
  onReplies: (callback: (update: EventChannels['reader:replies']) => void) => subscribe('reader:replies', callback),
  onTabClosed: (callback: (payload: EventChannels['tab:closed']) => void) => subscribe('tab:closed', callback),
  onTabLabel: (callback: (payload: EventChannels['tab:label']) => void) => subscribe('tab:label', callback),
  onSessionTitles: (callback: () => void) => subscribe('session:titles', callback),
  onTabCommand: (callback: (command: TabCommand) => void) => {
    const offs = [
      subscribe('tabs:new', ({ background, tabId }) => callback({ kind: 'new', background, tabId })),
      subscribe('tabs:new-session', () => callback({ kind: 'new-session' })),
      subscribe('tabs:close-active', () => callback({ kind: 'close-active' })),
      subscribe('tabs:cycle', (delta) => callback({ kind: 'cycle', delta })),
      subscribe('tabs:activate', ({ tabId }) => callback({ kind: 'activate', tabId })),
    ];
    return () => offs.forEach((off) => off());
  },
  onToggleLayout: (callback: () => void) => subscribe('layout:toggle', callback),
  openLink: (url: string) => send('link:open', url),
  reportReady: (info: SendChannels['renderer:ready'][0]) => send('renderer:ready', info),
  onToggleHistory: (callback: () => void) => subscribe('history:toggle', callback),
  onToggleBoard: (callback: () => void) => subscribe('board:toggle', callback),
  onToggleFocus: (callback: () => void) => subscribe('focus:toggle', callback),
  onToggleHeaders: (callback: () => void) => subscribe('headers:toggle', callback),
  onTextSizeStep: (callback: (step: EventChannels['text-size:step']) => void) => subscribe('text-size:step', callback),
  onTextSizeChanged: (callback: (sizes: EventChannels['text-size:changed']) => void) => subscribe('text-size:changed', callback),
  onStopClaude: (callback: () => void) => subscribe('claude:stop', callback),
  onConclusionsChanged: (callback: () => void) => subscribe('history:conclusions', callback),
  onOpenCustomize: (callback: () => void) => subscribe('customize:open', callback),
  onOpenWelcome: (callback: () => void) => subscribe('welcome:open', callback),
  onOpenGetStarted: (callback: () => void) => subscribe('get-started:open', callback),
  onClaudeFolder: (callback: (allowed: boolean) => void) => subscribe('claude-folder:changed', callback),
  onOpenColourKey: (callback: () => void) => subscribe('colour-key:open', callback),
  onToggleShortcuts: (callback: () => void) => subscribe('shortcuts:toggle', callback),
  onOpenRepoPalette: (callback: () => void) => subscribe('repos:palette', callback),
  update: {
    status: () => invoke('update:status'),
    restart: () => invoke('update:restart'),
    showWhatsNew: () => invoke('update:whats-new'),
    onReady: (callback: (payload: EventChannels['update:ready']) => void) => subscribe('update:ready', callback),
    onNote: (callback: (note: EventChannels['update:note']) => void) => subscribe('update:note', callback),
  },
  look: {
    setTheme: (id: string) => send('look:theme', id),
    setReading: (id: string) => send('look:reading', id),
    setCat: (id: string) => send('look:cat', id),
    setScene: (id: string) => send('look:scene', id),
  },
  layout: {
    getSplit: () => invoke('layout:get-split'),
    saveSplit: (fraction: number) => invoke('layout:save-split', fraction),
  },
  config: {
    get: () => invoke('config:get'),
    save: (patch: InvokeArgs<'config:save'>[0]) => invoke('config:save', patch),
    reset: (keyPath: string) => invoke('config:reset', keyPath),
    testHook: () => invoke('config:test-hook'),
    hookRuns: () => invoke('config:hook-runs'),
    organizer: () => invoke('config:organizer'),
    openStyle: (file: string) => invoke('config:open-style', file),
    useStyle: (name: string) => invoke('config:use-style', name),
    addPetalStyles: () => invoke('config:add-petal-styles'),
    addPetalSkills: () => invoke('config:add-petal-skills'),
  },
  workflow: {
    today: (openTabs?: NonNullable<InvokeArgs<'workflow:today'>[0]>['openTabs']) => invoke('workflow:today', { openTabs }),
    setup: () => invoke('workflow:setup'),
    time: () => invoke('workflow:time'),
    handoffs: () => invoke('workflow:handoffs'),
  },
  slash: {
    list: (cwd: string | null) => invoke('slash:list', { cwd }),
  },
  library: {
    list: () => invoke('library:list'),
    read: (slug: string) => invoke('library:read', { slug }),
    addSession: (tabId: TabId) => invoke('library:add-session', { tabId }),
    onChanged: (callback: () => void) => subscribe('library:changed', callback),
    backfillPlan: (days: BackfillDays) => invoke('library:backfill-plan', { days }),
    backfillStart: (days: BackfillDays) => invoke('library:backfill-start', { days }),
    backfillStop: () => invoke('library:backfill-stop'),
    backfillState: () => invoke('library:backfill-state'),
    onBackfill: (callback: (state: BackfillState) => void) => subscribe('library:backfill', callback),
    rename: (slug: string, title: string) => invoke('library:rename', { slug, title }),
    recategorize: (slug: string, category: string) => invoke('library:recategorize', { slug, category }),
    remove: (slug: string) => invoke('library:delete', { slug }),
    restore: (trashId: string) => invoke('library:restore', { trashId }),
    merge: (from: string, into: string) => invoke('library:merge', { from, into }),
    duplicates: () => invoke('library:duplicates'),
    keepBoth: (a: string, b: string) => invoke('library:keep-both', { a, b }),
    lessons: () => invoke('lessons:list'),
    dismissLesson: (id: string) => invoke('lessons:dismiss', { id }),
    mergeLessons: (keep: string, fold: string) => invoke('lessons:merge', { keep, fold }),
    previewLesson: (id: string, target: LessonTarget) => invoke('lessons:preview', { id, target }),
    addLesson: (token: string) => invoke('lessons:add', { token }),
    onLessonsChanged: (callback: () => void) => subscribe('lessons:changed', callback),
  },
  conclusion: {
    info: (sessionId: string) => invoke('conclusion:info', { sessionId }),
    onInfoChanged: (callback: (change: EventChannels['conclusion:info-changed']) => void) => subscribe('conclusion:info-changed', callback),
  },
  testing: {
    detect: (tabId: TabId, root: string | null = null) => invoke('testing:detect', { tabId, root }),
    history: (tabId: TabId, root: string | null = null) => invoke('testing:history', { tabId, root }),
    savePipeline: (request: InvokeArgs<'testing:save-pipeline'>[0]) => invoke('testing:save-pipeline', request),
    useClaudePipeline: (tabId: TabId, root: string | null = null) => invoke('testing:use-claude-pipeline', { tabId, root }),
    run: (request: InvokeArgs<'testing:run'>[0]) => invoke('testing:run', request),
    stop: (runId: string) => invoke('testing:stop', { runId }),
    loopStart: (request: InvokeArgs<'testing:loop-start'>[0]) => invoke('testing:loop-start', request),
    onRunUpdate: (callback: (update: EventChannels['testing:run-update']) => void) => subscribe('testing:run-update', callback),
  },
  tasks: {
    get: (tabId: TabId) => invoke('tasks:get', { tabId }),
    change: (tabId: TabId, op: InvokeArgs<'tasks:change'>[0]['op']) => invoke('tasks:change', { tabId, op }),
  },
  coord: {
    get: () => invoke('coord:get'),
    onUpdate: (callback: (view: EventChannels['coord:update']) => void) => subscribe('coord:update', callback),
  },
  activity: {
    list: () => invoke('activity:list'),
    onChanged: (callback: () => void) => subscribe('activity:changed', callback),
  },
  factory: {
    get: () => invoke('factory:get'),
    save: (request: InvokeArgs<'factory:save'>[0]) => invoke('factory:save', request),
    useGlobal: (repo: string) => invoke('factory:use-global', { repo }),
  },
  history: {
    list: () => invoke('history:list'),
    conversation: (sessionId: string, before?: number) => invoke('history:conversation', { sessionId, before }),
    resume: (sessionId: string, confirmFork = false, background = false) => invoke('history:resume', { sessionId, confirmFork, background }),
    send: (sessionId: string) => invoke('history:send', { sessionId }),
    tidy: () => invoke('history:tidy'),
    tagAdd: (sessionId: string, name: string) => invoke('history:tag-add', { sessionId, name }),
    tagRemove: (sessionId: string, name: string) => invoke('history:tag-remove', { sessionId, name }),
    tagDelete: (name: string) => invoke('history:tag-delete', { name }),
    tagRename: (from: string, to: string) => invoke('history:tag-rename', { from, to }),
  },
  notes: {
    get: (sessionId: string) => invoke('notes:get', { sessionId }),
    save: (sessionId: string, text: string) => invoke('notes:save', { sessionId, text }),
  },
  repos: {
    list: (tabId: TabId) => invoke('repos:list', { tabId }),
    open: (tabId: TabId, path: string) => invoke('repos:open', { tabId, path }),
  },
  flow: {
    get: (target: FlowTarget) => invoke('flow:get', { target }),
    create: (target: FlowTarget) => invoke('flow:create', { target }),
    mermaid: (target: FlowTarget, all = false) => invoke('flow:mermaid', { target, all }),
    copyMermaid: (target: FlowTarget, all = false) => invoke('flow:copy-mermaid', { target, all }),
    saveMermaid: (target: FlowTarget, all = false) => invoke('flow:save-mermaid', { target, all }),
  },
};

// The renderer's view of window.pastel; Phase 2 types the renderer against this.
export type PastelApi = typeof api;

contextBridge.exposeInMainWorld('pastel', api);
