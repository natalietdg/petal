// The one shell line Petal types to reopen a past session; every value in it is single-quoted.

// POSIX single-quote escaping: a value can never break out of the quotes.
export const shellQuote = (text: unknown): string => `'${String(text).replace(/'/g, `'\\''`)}'`;

// What follows `claude` in the typed line; the snapshot harness matches on it.
export const resumeArgs = (sessionId: string): string => `--resume ${shellQuote(sessionId)}`;

// \r submits the line in the pty.
export const buildResumeCommand = (cwd: string, sessionId: string): string => `cd ${shellQuote(cwd)} && claude ${resumeArgs(sessionId)}\r`;
