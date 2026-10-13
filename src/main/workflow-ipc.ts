// IPC for the Workflow dashboard. Every handler is read-only.
import * as workflow from './workflow';
import * as links from './links-store';
import { handle } from './ipc';
import { sessionTitleFor } from './session-title';
import { isSnapshotRun, setupFixture } from './snapshot-mode';
import { allowedClaudeHome } from './claude-folder';
import type { TabSessions } from './tab-session';

interface WorkflowIpcDeps {
  sessions: TabSessions;
  history: typeof import('./history');
  organizer: typeof import('./session-organizer');
}

export function registerWorkflowIpc({ sessions, history, organizer }: WorkflowIpcDeps): void {
  // Petal's own tabs, for when the renderer doesn't pass its list.
  function openTabsFromMain(): workflow.OpenTab[] {
    return [...sessions.values()]
      .flatMap(({ feed }) => (feed.session?.sessionId ? [feed.session] : []))
      .map((s) => ({
        sessionId: s.sessionId,
        title: sessionTitleFor(s.sessionId, { cwd: s.cwd }),
        busy: s.status === 'busy',
      }));
  }

  const inputs = () => ({ sessions: history.listSessions(), labels: organizer.load(), tags: workflow.loadTags() });

  // One failing section shows a line in its tab, never a blank view (see ipc-guard.ts).
  handle('workflow:today', (_event, { openTabs } = {}) => {
    const data = { ...inputs(), tags: null }; // Today groups by project, like History's plain list
    return workflow.todayData({ ...data, openTabs: Array.isArray(openTabs) ? openTabs : openTabsFromMain() });
  });
  // Reading off: the empty Setup page, with nothing under ~/.claude touched.
  handle('workflow:setup', () => {
    const home = allowedClaudeHome();
    if (!home) return workflow.emptySetup();
    return workflow.setupData({ claudeDir: (isSnapshotRun() && setupFixture.claudeDir) || home });
  });
  handle('workflow:time', () => workflow.timeData(inputs()));
  handle('workflow:handoffs', () => {
    const { sessions: list, labels } = inputs();
    return workflow.handoffData({ links: links.load(), sessions: list, labels });
  });
}
