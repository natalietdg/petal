const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('pastel', {
  getTheme: () => ipcRenderer.invoke('theme:get'),
  getSessions: (options) => ipcRenderer.invoke('sessions:snapshot', options),
  onTheme: (callback) => subscribe('theme:changed', callback),
  getCat: () => ipcRenderer.invoke('cat:get'),
  onCat: (callback) => subscribe('cat:changed', callback),
  getScene: () => ipcRenderer.invoke('scene:get'),
  onScene: (callback) => subscribe('scene:changed', callback),
  getReading: () => ipcRenderer.invoke('reading:get'),
  claudeInstalled: () => ipcRenderer.invoke('claude:installed'),
  onReading: (callback) => subscribe('reading:changed', callback),
  startShell: (tabId, { cols, rows }) => ipcRenderer.send('pty:start', { tabId, cols, rows }),
  write: (tabId, data) => ipcRenderer.send('pty:write', { tabId, data }),
  resize: (tabId, { cols, rows }) => ipcRenderer.send('pty:resize', { tabId, cols, rows }),
  closeShell: (tabId) => ipcRenderer.send('pty:close', { tabId }),
  activateTab: (tabId) => ipcRenderer.send('tab:activate', { tabId }),
  onData: (callback) => subscribe('pty:data', callback),
  onReplies: (callback) => subscribe('reader:replies', callback),
  onTabClosed: (callback) => subscribe('tab:closed', callback),
  onTabCommand: (callback) => {
    const offs = [
      subscribe('tabs:new', () => callback({ kind: 'new' })),
      subscribe('tabs:close-active', () => callback({ kind: 'close-active' })),
      subscribe('tabs:cycle', (delta) => callback({ kind: 'cycle', delta })),
      subscribe('tabs:activate', ({ tabId }) => callback({ kind: 'activate', tabId })),
    ];
    return () => offs.forEach((off) => off());
  },
  onToggleLayout: (callback) => subscribe('layout:toggle', callback),
  openLink: (url) => ipcRenderer.send('link:open', url),
  reportReady: (info) => ipcRenderer.send('renderer:ready', info),
  onToggleHistory: (callback) => subscribe('history:toggle', callback),
  onOpenCustomize: (callback) => subscribe('customize:open', callback),
  look: {
    setTheme: (id) => ipcRenderer.send('look:theme', id),
    setReading: (id) => ipcRenderer.send('look:reading', id),
    setCat: (id) => ipcRenderer.send('look:cat', id),
    setScene: (id) => ipcRenderer.send('look:scene', id),
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    save: (patch) => ipcRenderer.invoke('config:save', patch),
    reset: (keyPath) => ipcRenderer.invoke('config:reset', keyPath),
    testHook: () => ipcRenderer.invoke('config:test-hook'),
    hookRuns: () => ipcRenderer.invoke('config:hook-runs'),
    organizer: () => ipcRenderer.invoke('config:organizer'),
  },
  workflow: {
    today: (openTabs) => ipcRenderer.invoke('workflow:today', { openTabs }),
    setup: () => ipcRenderer.invoke('workflow:setup'),
    time: () => ipcRenderer.invoke('workflow:time'),
    handoffs: () => ipcRenderer.invoke('workflow:handoffs'),
  },
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    preview: (sessionId) => ipcRenderer.invoke('history:preview', { sessionId }),
    conversation: (sessionId, before) => ipcRenderer.invoke('history:conversation', { sessionId, before }),
    resume: (sessionId, confirmFork = false) => ipcRenderer.invoke('history:resume', { sessionId, confirmFork }),
    send: (sessionId) => ipcRenderer.invoke('history:send', { sessionId }),
    tidy: () => ipcRenderer.invoke('history:tidy'),
    tagAdd: (sessionId, name) => ipcRenderer.invoke('history:tag-add', { sessionId, name }),
    tagRemove: (sessionId, name) => ipcRenderer.invoke('history:tag-remove', { sessionId, name }),
    tagDelete: (name) => ipcRenderer.invoke('history:tag-delete', { name }),
    tagRename: (from, to) => ipcRenderer.invoke('history:tag-rename', { from, to }),
  },
  flow: {
    get: (target) => ipcRenderer.invoke('flow:get', { target }),
    create: (target) => ipcRenderer.invoke('flow:create', { target }),
    mermaid: (target, all = false) => ipcRenderer.invoke('flow:mermaid', { target, all }),
    copyMermaid: (target, all = false) => ipcRenderer.invoke('flow:copy-mermaid', { target, all }),
    saveMermaid: (target, all = false) => ipcRenderer.invoke('flow:save-mermaid', { target, all }),
  },
});
