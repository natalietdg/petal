// pipeline.json, copied from <checkout>/.petal/ into ~/.petal/repos/<repoKey of the checkout>/: the project-wide pipeline
// older versions of the testing-suite skill wrote. Read only, strictly
// checked, size-capped. Suites are per task now; this file is only offered as a starting point for a task with no suite.
import fs from 'node:fs';
import path from 'node:path';
import { repoDir } from './petal-home';
import { slugId, type StageConfig } from '../shared/testing';

export const CLAUDE_PIPELINE_NAME = 'pipeline.json';
export const MAX_FILE_BYTES = 16 * 1024;
export const MAX_STAGES = 12;
export const NAME_CHARS = 40;
export const COMMAND_CHARS = 500;

export type ParsedPipeline = { stages: StageConfig[] } | { problem: string };

export interface ClaudePipeline {
  stages: StageConfig[];
  updatedAt: number; // the file's mtime
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// An array of { name, command }, nothing else: names up to 40 characters, one-line commands up to 500, 12 stages at most.
export function parseClaudePipeline(text: string): ParsedPipeline {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { problem: 'it isn’t valid JSON' };
  }
  if (!Array.isArray(value)) return { problem: 'it should be a list of stages' };
  if (!value.length) return { problem: 'it has no stages' };
  if (value.length > MAX_STAGES) return { problem: `it has more than ${MAX_STAGES} stages` };
  const stages: StageConfig[] = [];
  for (const [i, item] of value.entries()) {
    const where = `stage ${i + 1}`;
    if (!isPlainObject(item) || Object.keys(item).some((k) => k !== 'name' && k !== 'command')) return { problem: `${where} should have only a name and a command` };
    const { name, command } = item;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > NAME_CHARS || /[\r\n]/.test(name)) return { problem: `${where} needs a one-line name of ${NAME_CHARS} characters or fewer` };
    if (typeof command !== 'string' || !command.trim() || command.trim().length > COMMAND_CHARS || /[\r\n\0]/.test(command)) return { problem: `${where} needs a one-line command of ${COMMAND_CHARS} characters or fewer` };
    stages.push({ id: slugId(name.trim(), stages.map((s) => s.id)), name: name.trim(), command: command.trim() });
  }
  return { stages };
}

// null when there is no file. Never follows a symlink, never reads past the cap.
export function readClaudePipeline(root: string): (ClaudePipeline | { problem: string }) | null {
  const dir = repoDir(root);
  const file = path.join(dir, CLAUDE_PIPELINE_NAME);
  let stat: fs.Stats;
  try {
    if (!fs.lstatSync(dir).isDirectory()) return null;
    stat = fs.lstatSync(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return { problem: 'it isn’t a plain file' };
  if (stat.size > MAX_FILE_BYTES) return { problem: `it is over ${MAX_FILE_BYTES / 1024} KB` };
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const parsed = parseClaudePipeline(text);
  return 'problem' in parsed ? parsed : { stages: parsed.stages, updatedAt: stat.mtimeMs };
}
