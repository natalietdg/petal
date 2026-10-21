// Runs the reviewer: a headless `claude -p` in the session's repo with read-only tools, plan mode, no MCP servers and
// no saved session. One run at a time; Cancel kills it. Snapshot runs use the harness's stub, never a real claude.
import { execFile, type ChildProcess, type ExecFileException } from 'node:child_process';
import { claudePath, cleanEnv } from './claude-cli';
import { recordCall } from './background-calls';
import { codeReviewFixture, isSnapshotRun } from './snapshot-mode';

const TIMEOUT_MS = 5 * 60_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const REVIEWER_MODEL = 'sonnet';
// Read access only, and never to the files a secret would live in.
const DENIED = ['Read(**/.env*)', 'Read(**/*credentials*)', 'Read(**/*secret*)', 'Read(**/*.pem)', 'Read(**/*.key)', 'Read(**/id_rsa*)'];

export const reviewerArgs = (): string[] => [
  '-p', '--model', REVIEWER_MODEL, '--output-format', 'json', '--no-session-persistence',
  '--tools', 'Read,Grep,Glob', '--permission-mode', 'plan', '--strict-mcp-config', '--disallowedTools', ...DENIED,
];

export class ReviewCanceled extends Error {
  constructor() { super('canceled'); }
}

let running: ChildProcess | null = null;
let canceled = false;

export function cancel(): void {
  canceled = true;
  running?.kill('SIGTERM');
}

// Plain words for what went wrong; the raw error goes to the console only.
function plainError(error: ExecFileException): Error {
  console.warn('[petal] code review run failed:', error);
  if (error.killed && error.signal === 'SIGTERM' && !canceled) return new Error('The reviewer took longer than 5 minutes and was stopped.');
  if (error.code === 'ENOENT') return new Error('Claude Code couldn’t be started from Petal.');
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return new Error('The reviewer’s answer was too long to read.');
  return new Error('Claude Code stopped before answering.');
}

// The reviewer's text from the CLI's JSON envelope; an error result becomes a plain message.
export function resultText(stdout: string): string {
  let envelope: unknown;
  try { envelope = JSON.parse(stdout); } catch { throw new Error('Claude Code’s reply wasn’t readable.'); }
  const e = envelope as { is_error?: boolean; result?: unknown; subtype?: string };
  if (e.is_error || typeof e.result !== 'string') {
    const said = typeof e.result === 'string' && e.result.trim() ? `: ${e.result.trim().slice(0, 200)}` : '.';
    throw new Error(`Claude Code reported an error${said}`);
  }
  return e.result;
}

// The JSON object in the reviewer's answer, even when it wrapped it in a fence or a sentence.
export function answerJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('The reviewer didn’t answer in the expected format.');
  try { return JSON.parse(text.slice(start, end + 1)); } catch { throw new Error('The reviewer didn’t answer in the expected format.'); }
}

async function runStub(prompt: string): Promise<string> {
  const stub = codeReviewFixture.review;
  if (!stub) throw new Error('Snapshot runs never start a real reviewer.');
  const out = await stub(prompt);
  if (canceled) throw new ReviewCanceled();
  return out;
}

// stdout of one call; cwd is the repo, so its Read tool sees the code around each change.
export async function runReviewer(prompt: string, cwd: string): Promise<string> {
  if (isSnapshotRun()) return runStub(prompt);
  const claude = await claudePath();
  if (!claude) throw new Error('Claude Code isn’t installed, so nothing was explained.');
  if (canceled) throw new ReviewCanceled();
  recordCall(); // counted with Petal's other background calls
  return new Promise((resolve, reject) => {
    const child = execFile(claude, reviewerArgs(), { env: cleanEnv(claude), cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES }, (error, stdout) => {
      running = null;
      if (canceled) reject(new ReviewCanceled());
      else if (error) reject(plainError(error));
      else resolve(stdout);
    });
    running = child;
    child.stdin?.end(prompt);
  });
}

// A new run starts uncanceled; the flag stays up until then so a queued batch also stops.
export const beginRun = (): void => { canceled = false; };
export const wasCanceled = (): boolean => canceled;
