// Workflow dashboard data: today's sessions, how the Claude setup is wired, where time goes, and handoffs.
// Each tab is its own module (workflow-*.ts); this is their public face for workflow-ipc and the renderer types.
export { loadTags } from './workflow-common';
export { todayData, type OpenTab, type TodayData, type TodayRow } from './workflow-today';
export { setupData, type AgentInfo, type SetupData, type SkillInfo } from './workflow-setup';
export { timeData, type TimeData, type TimeGroup } from './workflow-time';
export { handoffData, type HandoffData } from './workflow-handoffs';
