// Per project: its pipeline and its run history, in <userData>/testing/<project-hash>.json. Newest run first, 200 at most.
import crypto from 'node:crypto';
import path from 'node:path';
import { app } from 'electron';
import { readJsonOrSetAside, writeJsonAtomic } from './atomic-file';
import { FULL_TESTS_KEPT, RUN_CAP, type PipelineConfig, type PipelineRun, type ProjectTesting } from '../shared/testing';

export const testingDir = (): string => path.join(app.getPath('userData'), 'testing');
export const projectHash = (root: string): string => crypto.createHash('sha256').update(root).digest('hex').slice(0, 16);
export const projectFile = (root: string, dir = testingDir()): string => path.join(dir, `${projectHash(root)}.json`);
export const runsDir = (root: string, dir = testingDir()): string => path.join(dir, 'runs', projectHash(root));

const empty = (root: string): ProjectTesting => ({ version: 1, root, pipeline: null, runs: [] });

export function load(root: string, dir = testingDir()): ProjectTesting {
  const data = readJsonOrSetAside(projectFile(root, dir)) as ProjectTesting | undefined;
  // A hash collision or a hand-edited file for another folder reads as empty.
  if (!data || data.root !== root || !Array.isArray(data.runs)) return empty(root);
  return { ...empty(root), ...data };
}

// Newest first, capped; older runs keep their failing tests only, so the file stays small.
export function compact(runs: PipelineRun[]): PipelineRun[] {
  return [...runs]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, RUN_CAP)
    .map((run, i) => (i < FULL_TESTS_KEPT ? run : { ...run, stages: run.stages.map((s) => ({ ...s, tests: s.tests.filter((t) => t.status === 'failed') })) }));
}

export function save(data: ProjectTesting, dir = testingDir()): void {
  writeJsonAtomic(projectFile(data.root, dir), { ...data, runs: compact(data.runs) });
}

// Adds or replaces a run by id.
export function putRun(root: string, run: PipelineRun, dir = testingDir()): ProjectTesting {
  const data = load(root, dir);
  const next = { ...data, runs: [run, ...data.runs.filter((r) => r.id !== run.id)] };
  save(next, dir);
  return next;
}

export function savePipeline(root: string, pipeline: PipelineConfig, dir = testingDir()): ProjectTesting {
  const next = { ...load(root, dir), pipeline };
  save(next, dir);
  return next;
}
