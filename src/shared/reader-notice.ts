// The reader's words for a claude with no session file; shared so the snapshot checks the exact text.
export const UPDATE_COMMAND = 'claude update';

export const oldClaudeHint = (version: string): string =>
  `Your Claude Code (${version}) is older than Petal needs for the fastest tracking. Run \`${UPDATE_COMMAND}\` in the terminal, then restart Claude.`;

export const SHARED_FOLDER_LINE = 'Two Claude sessions share this folder; pick this tab’s.';
