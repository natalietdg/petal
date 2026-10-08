// Step summaries, timeline items and running/finished/stalled for subagent transcripts (made-up entries only).
import { describe, expect, it } from 'vitest';
import { agentStatus, isFinished, latestStep, resultPreview, STALLED_AFTER_MS, stepSummary, timelineItems } from '../src/main/agent-steps';
import type { ContentItem, TranscriptEntry } from '../src/main/transcript-entry';

const use = (name: string, input: ContentItem['input'] = {}, id = 't1'): ContentItem => ({ type: 'tool_use', id, name, input });
const assistant = (content: ContentItem[], stop_reason: string | null = null): TranscriptEntry => ({ type: 'assistant', isSidechain: true, message: { role: 'assistant', content, stop_reason } });
const prompt = (text: string): TranscriptEntry => ({ type: 'user', isSidechain: true, message: { role: 'user', content: text } });
const result = (id: string, content: unknown, is_error = false): TranscriptEntry => ({ type: 'user', isSidechain: true, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } });

describe('step summary', () => {
  it.each([
    [use('Read', { file_path: '/repo/src/main/sessions-monitor.ts' }), 'Reading sessions-monitor.ts'],
    [use('Bash', { command: 'npm test', description: 'Run the unit tests' }), 'Running npm test'],
    [use('Bash', { command: 'cd /repo && npx vitest run test/agent-steps.test.ts --reporter verbose', description: 'Run the step tests' }), 'Run the step tests'],
    [use('Bash', { command: 'git status' }), 'Running git status'],
    [use('Edit', { file_path: '/repo/src/renderer/print.css' }), 'Editing print.css'],
    [use('Write', { file_path: '/repo/notes.md' }), 'Writing notes.md'],
    [use('Grep', { pattern: 'SUBAGENT_WINDOW_MS' }), 'Searching for “SUBAGENT_WINDOW_MS”'],
    [use('WebFetch', { url: 'https://example.com/docs/page' }), 'Fetching example.com'],
    [use('Agent', { description: 'Sweep the repos' }), 'Starting an agent: Sweep the repos'],
    [use('SubagentHandback', { message: 'done' }), 'Sending the final report'],
    [use('mcp__claude_ai_Figma__get_screenshot'), 'Using get_screenshot'],
  ])('%#: %s', (item, want) => {
    expect(stepSummary(item)).toBe(want);
  });

  it('latest step is the newest tool_use, not a later text', () => {
    const entries = [assistant([use('Read', { file_path: '/a/one.ts' })]), assistant([use('Edit', { file_path: '/a/two.ts' })]), assistant([{ type: 'text', text: 'thinking aloud' }])];
    expect(latestStep(entries)).toBe('Editing two.ts');
    expect(latestStep([prompt('go')])).toBeNull();
  });
});

describe('finished and stalled', () => {
  it('is finished after a handback or an end_turn text, not mid-work', () => {
    expect(isFinished([prompt('go'), assistant([use('Read', { file_path: '/x' })])])).toBe(false);
    expect(isFinished([prompt('go'), assistant([use('SubagentHandback', { message: 'report' })]), result('t1', 'Report delivered')])).toBe(true);
    expect(isFinished([prompt('go'), assistant([{ type: 'text', text: 'All done.' }], 'end_turn')])).toBe(true);
    expect(isFinished([prompt('go'), assistant([{ type: 'text', text: 'Let me check.' }, use('Read')], 'tool_use')])).toBe(false);
  });

  it('a follow-up prompt after the report makes it run again', () => {
    expect(isFinished([assistant([{ type: 'text', text: 'Done.' }], 'end_turn'), prompt('one more thing')])).toBe(false);
  });

  it('stalled means no write for more than 10 minutes while unfinished', () => {
    const now = 1_000_000_000;
    expect(agentStatus(false, now - 60_000, now)).toBe('running');
    expect(agentStatus(false, now - STALLED_AFTER_MS, now)).toBe('running');
    expect(agentStatus(false, now - STALLED_AFTER_MS - 1, now)).toBe('stalled');
    expect(agentStatus(true, now - 3 * STALLED_AFTER_MS, now)).toBe('finished');
  });
});

describe('timeline items', () => {
  it('turns a transcript into prompt, step, result, text and report rows', () => {
    const items = [
      prompt('<system-reminder>ctx</system-reminder>\nFix the header'),
      assistant([{ type: 'text', text: 'Looking first.' }, use('Read', { file_path: '/r/a.css' }, 'r1')], 'tool_use'),
      result('r1', [{ type: 'text', text: 'line one' }, { type: 'image' }]),
      result('r2', 'boom', true),
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking' }] } },
      assistant([{ type: 'text', text: '**Done.** Header fixed.' }], 'end_turn'),
    ].flatMap(timelineItems);
    expect(items).toEqual([
      { kind: 'prompt', text: 'Fix the header' },
      { kind: 'text', markdown: 'Looking first.', at: undefined },
      { kind: 'step', id: 'r1', tool: 'Read', summary: 'Reading a.css', at: undefined },
      { kind: 'result', toolUseId: 'r1', ok: true, preview: 'line one\n[image]' },
      { kind: 'result', toolUseId: 'r2', ok: false, preview: 'boom' },
      { kind: 'report', markdown: '**Done.** Header fixed.', at: undefined },
    ]);
  });

  it('a handback becomes the report', () => {
    expect(timelineItems(assistant([use('SubagentHandback', { message: 'The report' })]))).toEqual([{ kind: 'report', markdown: 'The report', at: undefined }]);
  });

  it('result previews are cut to 300 characters', () => {
    const preview = resultPreview('x'.repeat(5000));
    expect(preview.length).toBe(301);
    expect(preview.endsWith('…')).toBe(true);
  });
});
