// Whether a concluded session's tab closes once its claude has exited.
export interface ConcludedTabState {
  claudeClosed: boolean;
  tabsInWindow: number;
  foregroundJob: boolean; // something other than the idle shell still owns the terminal
}

// The window's last tab stays, showing the ended reader, so concluding never closes a window.
export const shouldCloseConcludedTab = ({ claudeClosed, tabsInWindow, foregroundJob }: ConcludedTabState): boolean =>
  claudeClosed && tabsInWindow > 1 && !foregroundJob;

// The one-time question before a first conclude closes anything; the window's last tab stays, so only Claude ends there.
export interface ConcludeWarning {
  message: string;
  detail: string;
  buttons: [go: string, keep: string];
}

export function firstConcludeWarning({ warned, tabsInWindow }: { warned: boolean; tabsInWindow: number }): ConcludeWarning | null {
  if (warned) return null;
  const closesTab = tabsInWindow > 1;
  return {
    message: closesTab ? 'Conclude closes this tab after the summary. Close it?' : 'Conclude ends this Claude session after the summary. End it?',
    detail: 'The summary stays in History. Petal asks only this first time.',
    buttons: closesTab ? ['Close tab', 'Keep it open'] : ['End session', 'Keep it running'],
  };
}
