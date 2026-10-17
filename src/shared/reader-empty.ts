// Which line an empty reader shows, in order. Folder-off comes first: with reading off no reply or sign-in can be seen.
export type EmptyLine = 'folder-off' | 'setting-up' | 'running' | 'not-installed' | 'start';

export interface EmptyFacts {
  hasReply: boolean;
  live: boolean; // a claude runs in the tab
  claudeSetup: boolean; // a new user on Claude Code's first-run screens
  folderAllowed: boolean;
  claudeMissing: boolean;
}

// null: there are replies to show.
export function emptyLine({ hasReply, live, claudeSetup, folderAllowed, claudeMissing }: EmptyFacts): EmptyLine | null {
  if (!folderAllowed) return 'folder-off';
  if (hasReply) return null;
  if (live) return claudeSetup ? 'setting-up' : 'running';
  return claudeMissing ? 'not-installed' : 'start';
}
