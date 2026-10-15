// Whether a concluded session's tab closes once its claude has exited.
export interface ConcludedTabState {
  claudeClosed: boolean;
  tabsInWindow: number;
  foregroundJob: boolean; // something other than the idle shell still owns the terminal
}

// The window's last tab stays, showing the ended reader, so concluding never closes a window.
export const shouldCloseConcludedTab = ({ claudeClosed, tabsInWindow, foregroundJob }: ConcludedTabState): boolean =>
  claudeClosed && tabsInWindow > 1 && !foregroundJob;
