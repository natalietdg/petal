// IPC for the Workflow dashboard. Every handler is read-only.
const { ipcMain } = require('electron');
const workflow = require('./workflow');
const links = require('./links-store');

function registerWorkflowIpc({ sessions, history, organizer }) {
  // Petal's own tabs, for when the renderer doesn't pass its list.
  function openTabsFromMain(labels) {
    return [...sessions.values()]
      .map(({ feed }) => feed.session)
      .filter((s) => s?.sessionId)
      .map((s) => ({
        sessionId: s.sessionId,
        title: labels[s.sessionId]?.title || history.findRecord(s.sessionId)?.title || 'Shell',
        busy: s.status === 'busy',
      }));
  }

  const inputs = () => ({ sessions: history.listSessions(), labels: organizer.load(), tags: workflow.loadTags() });

  // One failing section shows a line in its tab, never a blank view.
  const guarded = (name, handler) => ipcMain.handle(name, async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error(`[petal] ${name} failed:`, error);
      return { error: error.message || String(error) };
    }
  });

  guarded('workflow:today', (_event, { openTabs } = {}) => {
    const data = inputs();
    return workflow.todayData({ ...data, openTabs: Array.isArray(openTabs) ? openTabs : openTabsFromMain(data.labels) });
  });
  guarded('workflow:setup', () => workflow.setupData());
  guarded('workflow:time', () => workflow.timeData(inputs()));
  guarded('workflow:handoffs', () => {
    const { sessions: list, labels } = inputs();
    return workflow.handoffData({ links: links.load(), sessions: list, labels });
  });
}

module.exports = { registerWorkflowIpc };
