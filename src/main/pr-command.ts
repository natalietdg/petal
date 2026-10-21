// Reads a Bash call that opens a PR (gh pr create, az repos pr create): its title, branch and the folder it ran in.
import os from 'node:os';
import path from 'node:path';
import { azurePrUrl, type PrRef } from '../shared/pr-links';

export interface CreateCall { tool: 'gh' | 'az'; title: string | null; branch: string | null; dir: string | null }

const GH_CREATE = /(?:^|[\s;&|(])gh\s+pr\s+create\b/;
const AZ_CREATE = /(?:^|[\s;&|(])az\s+repos\s+pr\s+create\b/;
const VALUE = String.raw`("(?:[^"\\]|\\.)*"|'[^']*'|[^\s;&|]+)`;
const CD = new RegExp(String.raw`(?:^|[;&|(]\s*)cd\s+${VALUE}`, 'g');

const unquote = (raw: string): string => {
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1).replace(/\\(.)/g, '$1');
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
  return raw;
};

function flag(command: string, names: readonly string[]): string | null {
  const pattern = new RegExp(String.raw`(?:^|\s)(?:${names.join('|')})(?:=|\s+)${VALUE}`);
  const match = pattern.exec(command);
  const value = match ? unquote(match[1] as string).trim() : '';
  return value && !value.startsWith('$(') ? value : null; // a heredoc title isn't readable from the command
}

// The folder of the last `cd` before the create, read against Claude's folder for that call.
function dirOf(command: string, cwd: string | null, createAt: number): string | null {
  let dir = cwd;
  for (const match of command.matchAll(CD)) {
    if (match.index > createAt) break;
    const target = unquote(match[1] as string).replace(/^~(?=\/|$)/, os.homedir());
    dir = path.isAbsolute(target) ? target : dir ? path.resolve(dir, target) : null;
  }
  return dir;
}

export function parseCreateCommand(command: string, cwd: string | null): CreateCall | null {
  const gh = GH_CREATE.exec(command);
  const az = gh ? null : AZ_CREATE.exec(command);
  const found = gh ?? az;
  if (!found) return null;
  const rest = command.slice(found.index);
  return {
    tool: gh ? 'gh' : 'az',
    title: flag(rest, ['--title', '-t']),
    branch: gh ? flag(rest, ['--head', '-H']) : flag(rest, ['--source-branch', '-s']),
    dir: dirOf(command, cwd, found.index),
  };
}

export interface AzCreated { ref: PrRef; title: string | null; branch: string | null }

// az prints the new PR as JSON: its id, title, source branch and the repo's web URL, but not the PR's own page.
export function parseAzOutput(output: string): AzCreated | null {
  let data: { pullRequestId?: unknown; title?: unknown; sourceRefName?: unknown; repository?: { webUrl?: unknown } };
  try { data = JSON.parse(output.trim()) as typeof data; } catch { return null; }
  if (typeof data?.pullRequestId !== 'number' || typeof data.repository?.webUrl !== 'string') return null;
  const ref = azurePrUrl(data.repository.webUrl, data.pullRequestId);
  if (!ref) return null;
  const branch = typeof data.sourceRefName === 'string' ? data.sourceRefName.replace(/^refs\/heads\//, '') : null;
  return { ref, title: typeof data.title === 'string' ? data.title : null, branch };
}
