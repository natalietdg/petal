import { contextBridge, ipcRenderer } from 'electron';
import type { EventChannel, EventChannels, InvokeArgs, InvokeChannel, InvokeResult, SendChannel, SendChannels } from './shared/ipc';
import type { FlowTarget, TabId, TermSize } from './shared/types';
import type { PromptAnswer } from './shared/prompt-answer';

// Typed against the contract in shared/ipc.ts; ipcRenderer itself is untyped.
const invoke = <C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>> => ipcRenderer.invoke(channel, ...args);
const send = <C extends SendChannel>(channel: C, ...args: SendChannels[C]): void => ipcRenderer.send(channel, ...args);

const subscribe = <C extends EventChannel>(channel: C, callback: (payload: EventChannels[C]) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: EventChannels[C]) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

export type TabCommand =
  | { kind: 'new' }
  | { kind: 'close-active' }
  | { kind: 'cycle'; delta: number }
  | { kind: 'activate'; tabId: TabId };

const api = {
  getTheme: () => invoke('theme:get'),
  getSessions: (options: InvokeArgs<'sessions:snapshot'>[0]) => invoke('sessions:snapshot', options),
  closeSession: (sessionId: string) => invoke('sessions:close', sessionId),
  onTheme: (callback: (theme: EventChannels['theme:changed']) => void) => subscribe('theme:changed', callback),
  getCat: () => invoke('cat:get'),
  onCat: (callback: (catId: string) => void) => subscribe('cat:changed', callback),
  getScene: () => invoke('scene:get'),
  onScene: (callback: (sceneId: string) => void) => subscribe('scene:changed', callback),
  getReading: () => invoke('reading:get'),
  claudeInstalled: () => invoke('claude:installed'),
  onReading: (callback: (readingId: string) => void) => subscribe('reading:changed', callback),
  startShell: (tabId: TabId, { cols, rows }: TermSize) => send('pty:start', { tabId, cols, rows }),
  write: (tabId: TabId, data: string) => send('pty:write', { tabId, data }),
  startClaude: (tabId: TabId, prompt: string) => send('tab:start-claude', { tabId, prompt }),
  answerPrompt: (tabId: TabId, answer: PromptAnswer) => send('prompt:answer', { tabId, answer }),
  resize: (tabId: TabId, { cols, rows }: TermSize) => send('pty:resize', { tabId, cols, rows }),
  closeShell: (tabId: TabId) => send('pty:close', { tabId }),
  activateTab: (tabId: TabId) => send('tab:activate', { tabId }),
  onData: (callback: (payload: EventChannels['pty:data']) => void) => subscribe('pty:data', callback),
  onReplies: (callback: (update: EventChannels['reader:replies']) => void) => subscribe('reader:replies', callback),
  onTabClosed: (callback: (payload: EventChannels['tab:closed']) => void) => subscribe('tab:closed', callback),
  onTabCommand: (callback: (command: TabCommand) => void) => {
    const offs = [
      subscribe('tabs:new', () => callback({ kind: 'new' })),
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
  onOpenCustomize: (callback: () => void) => subscribe('customize:open', callback),
  look: {
    setTheme: (id: string) => send('look:theme', id),
    setReading: (id: string) => send('look:reading', id),
    setCat: (id: string) => send('look:cat', id),
    setScene: (id: string) => send('look:scene', id),
  },
  config: {
    get: () => invoke('config:get'),
    save: (patch: InvokeArgs<'config:save'>[0]) => invoke('config:save', patch),
    reset: (keyPath: string) => invoke('config:reset', keyPath),
    testHook: () => invoke('config:test-hook'),
    hookRuns: () => invoke('config:hook-runs'),
    organizer: () => invoke('config:organizer'),
  },
  workflow: {
    today: (openTabs?: NonNullable<InvokeArgs<'workflow:today'>[0]>['openTabs']) => invoke('workflow:today', { openTabs }),
    setup: () => invoke('workflow:setup'),
    time: () => invoke('workflow:time'),
    handoffs: () => invoke('workflow:handoffs'),
  },
  history: {
    list: () => invoke('history:list'),
    conversation: (sessionId: string, before?: number) => invoke('history:conversation', { sessionId, before }),
    resume: (sessionId: string, confirmFork = false) => invoke('history:resume', { sessionId, confirmFork }),
    send: (sessionId: string) => invoke('history:send', { sessionId }),
    tidy: () => invoke('history:tidy'),
    tagAdd: (sessionId: string, name: string) => invoke('history:tag-add', { sessionId, name }),
    tagRemove: (sessionId: string, name: string) => invoke('history:tag-remove', { sessionId, name }),
    tagDelete: (name: string) => invoke('history:tag-delete', { name }),
    tagRename: (from: string, to: string) => invoke('history:tag-rename', { from, to }),
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
