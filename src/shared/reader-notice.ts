// The reader's words for a claude with no session file; shared so the snapshot checks the exact text.
export const UPDATE_COMMAND = 'claude update';

export const oldClaudeHint = (version: string): string =>
  `Your Claude Code (${version}) is older than Petal needs for the fastest tracking. Run \`${UPDATE_COMMAND}\` in the terminal, then restart Claude.`;

export const SHARED_FOLDER_LINE = 'Two Claude sessions share this folder; pick this tab’s.';

// The launch self-check's words (format-check.ts): what changed, with the version named, and that the terminal still has it all.
export const formatChangedNotice = (version: string | null, problem: string): string =>
  `${version ? `Claude Code ${version}` : 'This Claude Code'} saves replies in a way Petal can’t read yet, so the reader may stay blank. Every reply is still in the terminal. Check for a Petal update: Petal › Check for Updates. (Details: ${problem}.)`;

export const newerClaudeNotice = (version: string, checked: string): string =>
  `Claude Code ${version} is newer than Petal has been checked with (up to ${checked}). If the reader stays blank, every reply is still in the terminal. Check for a Petal update: Petal › Check for Updates.`;
