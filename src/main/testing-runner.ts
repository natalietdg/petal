// What Petal types to run a pipeline: each stage's command with a machine reporter added where the runner has one,
// wrapped in script(1) so its output is logged and Ctrl+C still lets the next line record the exit code.
import path from 'node:path';
import { shellQuote } from './resume-command';
import { runnerOf } from '../shared/testing';
import type { ReportKind } from './testing-parse';

export interface Report { kind: ReportKind; file: string }
export interface StagePlan { exec: string; runner: string | null; report: Report | null }

// "npm test", "pnpm run test:unit", "yarn e2e": the package manager and script name.
const SCRIPT_CALL = /^\s*(npm|pnpm|yarn|bun)\s+(?:run\s+|run-script\s+)?([\w:.-]+)/;
const HAS_REPORTER = /(--reporter\b|--json\b|--junitxml\b|\s-json\b|--format\b|--outputFile\b)/;

// The runner a command ends up calling, looking through a package.json script when it is one.
export function resolveRunner(command: string, scripts: Record<string, string>): { runner: string | null; viaNpm: boolean; viaScript: boolean } {
  const direct = runnerOf(command);
  const call = SCRIPT_CALL.exec(command);
  if (call && !/\b(exec|dlx|x)\b/.test(call[2])) {
    const name = call[2] === 't' ? 'test' : call[2];
    const script = scripts[name];
    if (script !== undefined) return { runner: runnerOf(script), viaNpm: call[1] === 'npm', viaScript: true };
  }
  return { runner: direct, viaNpm: false, viaScript: false };
}

// Extra arguments go after "--" for npm scripts; pnpm, yarn and bun pass them on as they are.
function appendArgs(command: string, args: string, viaNpm: boolean): string {
  const needsSeparator = viaNpm && !/\s--(\s|$)/.test(command);
  return `${command.trimEnd()}${needsSeparator ? ' --' : ''} ${args}`;
}

// The command as typed, plus a reporter writing to <base>.json or <base>.xml; null report means parse the log.
export function withReporter(command: string, scripts: Record<string, string>, base: string, log: string): StagePlan {
  const { runner, viaNpm } = resolveRunner(command, scripts);
  if (HAS_REPORTER.test(command)) return { exec: command, runner, report: null };
  const json = `${base}.json`;
  const xml = `${base}.xml`;
  switch (runner) {
    case 'vitest':
      return { exec: appendArgs(command, `--reporter=default --reporter=json --outputFile.json=${shellQuote(json)}`, viaNpm), runner, report: { kind: 'vitest-json', file: json } };
    case 'jest':
      return { exec: appendArgs(command, `--json --outputFile=${shellQuote(json)}`, viaNpm), runner, report: { kind: 'jest-json', file: json } };
    case 'playwright':
      return { exec: `PLAYWRIGHT_JSON_OUTPUT_NAME=${shellQuote(json)} ${appendArgs(command, '--reporter=list,json', viaNpm)}`, runner, report: { kind: 'playwright-json', file: json } };
    case 'pytest':
      return { exec: appendArgs(command, `--junitxml=${shellQuote(xml)}`, viaNpm), runner, report: { kind: 'junit', file: xml } };
    case 'maestro':
      return { exec: appendArgs(command, `--format junit --output ${shellQuote(xml)}`, viaNpm), runner, report: { kind: 'junit', file: xml } };
    case 'go':
      // go test -json writes its events to the terminal, so the log is the report.
      return /\bgo\s+test\b/.test(command)
        ? { exec: command.replace(/\bgo\s+test\b/, 'go test -json'), runner, report: { kind: 'go-json', file: log } }
        : { exec: command, runner, report: null };
    default:
      return { exec: command, runner, report: null };
  }
}

export interface ScriptStage { name: string; command: string; exec: string; log: string; exit: string }

// The pipeline as a shell script: a header per stage, the stage under script(1), its exit code to a file,
// then stop at a failure unless keepGoing. A last "done" file marks the end either way.
export function pipelineScript({ root, stages, keepGoing, done }: { root: string; stages: ScriptStage[]; keepGoing: boolean; done: string }): string {
  const lines = [
    '#!/bin/sh',
    `# Written by Petal to run this project's test pipeline; each stage's exit code goes next to this file.`,
    `cd ${shellQuote(root)} || { echo 1 > ${shellQuote(done)}; exit 1; }`,
    'failed=0',
  ];
  stages.forEach((stage, i) => {
    lines.push(
      '',
      `printf '\\n\\033[1m%s\\033[0m  %s\\n\\n' ${shellQuote(`${i + 1}/${stages.length} ${stage.name}`)} ${shellQuote(stage.command)}`,
      `script -q ${shellQuote(stage.log)} /bin/sh -c ${shellQuote(stage.exec)}`,
      'code=$?',
      `echo $code > ${shellQuote(stage.exit)}`,
      keepGoing
        ? '[ $code -eq 0 ] || failed=1'
        : `[ $code -eq 0 ] || { echo $code > ${shellQuote(done)}; printf '\\nStopped after a failed stage.\\n'; exit $code; }`,
    );
  });
  lines.push('', `echo $failed > ${shellQuote(done)}`, "printf '\\nPipeline finished.\\n'", '');
  return lines.join('\n');
}

// The files of one stage inside a run's folder.
export const stageFiles = (dir: string, index: number) => ({
  base: path.join(dir, `stage-${index + 1}`),
  log: path.join(dir, `stage-${index + 1}.log`),
  exit: path.join(dir, `stage-${index + 1}.exit`),
});

// The line typed into the new tab.
export const runLine = (script: string): string => `sh ${shellQuote(script)}\r`;
