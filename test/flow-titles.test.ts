import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeTempDirs, useTempUserData } from './helpers';

vi.mock('../src/main/claude-cli', () => ({
  claudePath: async () => null,
  cleanEnv: () => ({}),
  runClaude: async () => { throw new Error('flow-titles tests never call the CLI'); },
}));

type FlowTitles = typeof import('../src/main/flow-titles');
type ConfigStore = typeof import('../src/main/config-store');

let flowTitles: FlowTitles;
let config: ConfigStore;

beforeEach(async () => {
  useTempUserData();
  vi.resetModules();
  flowTitles = await import('../src/main/flow-titles');
  config = await import('../src/main/config-store');
});
afterEach(removeTempDirs);

// The hard-coded prompt before it became editable; the default must stay byte-identical.
const OLD = `You turn a work log into STATE CHANGES. For each step you get what the user asked and the reply.
List what is now different in the world: a setting, a file, an app, a design, a rule, a decision. Each change is
{"what": the thing that changed (2-4 words), "from": its old state or "" if new, "to": its new state (max 6 words)}.
A step that only answered a question, explained, or asked back changed nothing: give it "changes": [].
Also give a 3-6 word outcome title. Plain words, sentence case, no trailing periods. Never restate the request.
Answer with JSON only: {"steps":[{"i":<index>,"t":"<title>","changes":[{"what":"","from":"","to":""}]}]}`;

describe('flow-titles prompt', () => {
  it('default prompt + contract is byte-identical to the old hard-coded one', () => {
    expect(flowTitles.promptText()).toBe(OLD);
  });

  it('a custom prompt still gets the contract appended', () => {
    config.save({ flowTitles: { prompt: 'Be terse.' } });
    expect(flowTitles.promptText()).toBe('Be terse.\nAnswer with JSON only: {"steps":[{"i":<index>,"t":"<title>","changes":[{"what":"","from":"","to":""}]}]}');
  });

  it('resetting the prompt brings the old text back', () => {
    config.save({ flowTitles: { prompt: 'Be terse.' } });
    config.reset('flowTitles.prompt');
    expect(flowTitles.promptText()).toBe(OLD);
  });
});
