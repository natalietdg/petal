// The shell lines Petal types to start or reopen a session; every value in them is quoted.

// POSIX single-quote escaping: a value can never break out of the quotes.
export const shellQuote = (text: unknown): string => `'${String(text).replace(/'/g, `'\\''`)}'`;

// For a line typed into an interactive shell. A control byte would act as a key in the line editor (Tab completes,
// a newline submits early), so each run of them becomes a $'\t'-style segment and the typed line is printable only.
// NUL can't be in an argument at all, so it is dropped.
// eslint-disable-next-line no-control-regex -- finding controls is the point
const CONTROL_RUN = /([\x01-\x1f\x7f]+)/;
const ansiC = (run: string): string => `$'${[...run].map((ch) => (ch === '\t' ? '\\t' : ch === '\n' ? '\\n' : `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`)).join('')}'`;
export const typedQuote = (text: unknown): string => {
  const parts = String(text).replace(/\0/g, '').split(CONTROL_RUN);
  return parts.map((part, i) => (i % 2 ? ansiC(part) : part ? shellQuote(part) : '')).join('') || "''";
};

// What follows `claude` in the typed line; the snapshot harness matches on it.
export const resumeArgs = (sessionId: string): string => `--resume ${shellQuote(sessionId)}`;

// \r submits the line in the pty. `claude` is the command word: plain, or claude's quoted full path when her shell can't find it.
// `--` ends claude's options, so a message starting with "-" is still the prompt.
export const buildStartCommand = (prompt: string, claude = 'claude'): string => `${claude} -- ${typedQuote(prompt)}\r`;

export const buildResumeCommand = (cwd: string, sessionId: string, claude = 'claude'): string => `cd ${shellQuote(cwd)} && ${claude} ${resumeArgs(sessionId)}\r`;
