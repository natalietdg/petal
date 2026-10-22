// Code review for subagents: the reply that launched a subagent counts its changes and lists them under
// "By subagent: …", with the same cards and Explain. The reviewer is the snapshot stub only.
// Everything it adds is taken out again: the fixture logs, the History record, cached answers, the stub and Activity.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { Kit } from './snapshot';
import { codeReviewFixture, historyFixture } from '../main/snapshot-mode';
import { assertFixtureOutsideClaude } from './snapshot-views';
import { keepActivity } from './snapshot-activity';

const SESSION = 'a6e47c0d-0000-4000-8000-0000000a6e47';
const AGENT = 'fxcodereview1';
const CALL = 'toolu_fx_agent_review';
const TASK = 'Fix the cart total';
const ORIGINAL = 'export function total(items: Item[]): number {\n  return items.reduce((sum, i) => sum + i.price, 0);\n}\n';
const OLD = 'return items.reduce((sum, i) => sum + i.price, 0);';
const NEW = 'return items.reduce((sum, i) => sum + i.price * i.qty, 0);';
const REASON = 'The total ignored quantity, so multiply each price by qty.';

const jsonl = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';

// The parent: her prompt and one Agent call whose id the subagent's meta.json records.
function parentLines(cwd: string): unknown[] {
  const base = { isSidechain: false, cwd, sessionId: SESSION, timestamp: new Date().toISOString() };
  return [
    { ...base, type: 'user', uuid: 'pa-u', message: { role: 'user', content: 'have an agent fix the cart total' } },
    { ...base, type: 'assistant', uuid: 'pa-a', message: { role: 'assistant', content: [{ type: 'text', text: 'Sending an agent to fix it.' }, { type: 'tool_use', id: CALL, name: 'Agent', input: { description: TASK, prompt: 'Fix the cart total.' } }] } },
    { ...base, type: 'user', uuid: 'pa-r', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: CALL, content: 'Fixed.' }] } },
    { ...base, type: 'assistant', uuid: 'pa-d', message: { role: 'assistant', content: [{ type: 'text', text: 'The agent fixed the total.' }] } },
  ];
}

// The subagent's own log: every entry a sidechain, one Edit with the original file.
function agentLines(cwd: string): unknown[] {
  const file = path.join(cwd, 'src', 'cart.ts');
  const base = { isSidechain: true, agentId: AGENT, cwd, timestamp: new Date().toISOString() };
  return [
    { ...base, type: 'user', uuid: 'ag-u', message: { role: 'user', content: 'Fix the cart total.' } },
    { ...base, type: 'assistant', uuid: 'ag-a', message: { role: 'assistant', content: [{ type: 'text', text: REASON }] } },
    { ...base, type: 'assistant', uuid: 'ag-e', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'ag-t1', name: 'Edit', input: { file_path: file, old_string: OLD, new_string: NEW } }] } },
    { ...base, type: 'user', uuid: 'ag-r', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'ag-t1', content: 'ok' }] }, toolUseResult: { filePath: file, originalFile: ORIGINAL } },
    { ...base, type: 'assistant', uuid: 'ag-d', message: { role: 'assistant', content: [{ type: 'text', text: 'Done: the total counts quantity.' }] } },
  ];
}

function writeAgent(dir: string, cwd: string): void {
  const file = path.join(dir, `agent-${AGENT}.jsonl`);
  assertFixtureOutsideClaude(file);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, jsonl(agentLines(cwd)));
  fs.writeFileSync(path.join(dir, `agent-${AGENT}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: TASK, toolUseId: CALL }));
}

const STUB_REPLY = JSON.stringify({
  type: 'result', is_error: false, usage: { input_tokens: 10, output_tokens: 60 },
  result: JSON.stringify({ answers: [{ id: 'F1', shape: 'One reduce over the items.', driver: 'The total ignored quantity.', alternatives: 'A loop would read the same.', risk: 'none seen', basis: 'recorded', quote: 'multiply each price by qty' }] }),
});

const PROBE = (root: string) => `(() => {
  const root = document.querySelector(${JSON.stringify(root)});
  const tabs = root?.querySelector('.cr-tabs');
  if (!tabs) return null;
  return {
    tabs: [...tabs.querySelectorAll('.cr-tab')].map((b) => b.textContent),
    selected: tabs.querySelector('[aria-selected="true"]')?.textContent ?? null,
    headings: [...root.querySelectorAll('.cr-subagent')].map((h) => h.textContent),
    cards: [...root.querySelectorAll('.cr-card')].map((c) => ({ name: c.querySelector('.cr-name')?.textContent ?? '', diff: Boolean(c.querySelector('.cr-diff .cr-add')), why: c.querySelector('.cr-basis')?.textContent ?? '' })),
    explain: root.querySelector('.cr-explain-button')?.textContent ?? '',
  };
})()`;

export async function agentCodeReviewCheck(kit: Kit): Promise<void> {
  const { js, waitFor, log, capture, outDir, applyTheme } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} agent code review: ${what}`);
  // any: the probe's shape is built in PROBE.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const probe = (root: string, want: (p: any) => boolean, ms = 8000) => waitFor(async () => { const p = await js(PROBE(root)); return p && want(p) ? p : null; }, ms);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  const root = path.join(outDir, 'agent-code-review-fixture');
  const project = path.join(root, 'projects', '-fixture');
  const parentFile = path.join(project, `${SESSION}.jsonl`);
  assertFixtureOutsideClaude(parentFile);
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(parentFile, jsonl(parentLines(project)));
  writeAgent(path.join(project, SESSION, 'subagents'), project);
  codeReviewFixture.projectsRoots = [path.join(root, 'projects')];
  historyFixture.records = [{ sessionId: SESSION, file: parentFile, cwd: project, title: 'Agent code review fixture', firstPrompt: 'have an agent fix the cart total', lastAt: Date.now() + 60_000, messages: 4, messagesExact: true }];
  const prompts: string[] = [];
  codeReviewFixture.review = async (prompt) => { prompts.push(prompt); return STUB_REPLY; };
  const restoreActivity = keepActivity();
  const H = '#history-preview';
  try {
    // History: the reply that launched the agent counts its changes and shows them under the agent's task.
    await js(`PastelTerm.history.open().then(() => { PastelTerm.history.select(${JSON.stringify(SESSION)}); return PastelTerm.history.setPreviewMode('replies'); })`);
    const listed = await probe(H, (p) => p.tabs.length === 2);
    check(listed?.tabs[1] === 'Code review (1)' && listed.selected === 'Reply', `the launching reply has Reply · Code review (1): ${JSON.stringify(listed?.tabs)}`);
    await click(`${H} .cr-tab:last-of-type`);
    const grouped = await probe(H, (p) => p.cards.length === 1 && p.explain);
    check(grouped?.headings.join() === `By subagent: ${TASK}` && grouped.cards[0].name === 'total' && grouped.cards[0].diff, `the agent's card sits under its heading: ${JSON.stringify(grouped)}`);
    check(/^Explain every function · ~[\d,]+ tokens$/.test(grouped?.explain ?? '') && prompts.length === 0, `the estimate shows before any call: ${JSON.stringify(grouped?.explain)}`);
    await click(`${H} .cr-explain-button`);
    const answered = await probe(H, (p) => p.cards[0]?.why);
    check(answered?.cards[0].why.startsWith('Recorded') && prompts.length === 1 && prompts[0].includes(`+  ${NEW}`), `one stubbed call, answered as recorded: ${JSON.stringify(answered?.cards)}`);
    check(fs.existsSync(path.join(app.getPath('userData'), 'code-review', `${SESSION}--${AGENT}.json`)), 'the answers are cached per agent');
    await capture('agent-code-review-light');
    applyTheme('nightPastel', { persist: false });
    await capture('agent-code-review-dark');
    applyTheme('paleSky', { persist: false });
    await click(`${H} .cr-tab:first-of-type`);
    check(await probe(H, (p) => p.selected === 'Reply'), 'Reply is back on');
    await js('PastelTerm.history.close()');
  } finally {
    codeReviewFixture.review = null;
    codeReviewFixture.projectsRoots = [];
    historyFixture.records = [];
    restoreActivity();
    fs.rmSync(path.join(app.getPath('userData'), 'code-review', `${SESSION}--${AGENT}.json`), { force: true });
    fs.rmSync(root, { recursive: true, force: true });
    await js('PastelTerm.overlays.hideCurrent()');
  }
}
