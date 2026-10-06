// Customize section Response hook: her command, the test button and recent runs.
import { el, isIpcError } from './dom';
import { timeOf } from './format';
import { actionButton, card, field, note, page, save } from './customize-kit';
import type { HookRun } from '../main/response-hook';

function runsList(runs: HookRun[]): HTMLDivElement {
  const list = el('div', 'cz-runs');
  if (!runs.length) list.append(note('No runs yet since Petal opened.', 'cz-empty'));
  for (const run of runs) {
    const row = el('div', 'cz-run');
    const ok = run.exitCode === 0;
    const badge = el('span', `cz-badge ${ok ? 'cz-ok' : 'cz-fail'}`, run.timedOut ? 'timeout' : `exit ${run.exitCode ?? '–'}`);
    row.append(badge, el('span', 'cz-run-time', timeOf(run.at, true)), el('span', 'cz-run-title', `${run.test ? 'Test · ' : ''}${run.title ?? ''}`));
    if (run.stderr) row.append(el('code', 'cz-run-err', run.stderr));
    list.append(row);
  }
  return list;
}

export function renderHook(): HTMLElement[] {
  const h = page.state.config.responseHook;
  const command = el('input', 'cz-input cz-command');
  Object.assign(command, { type: 'text', value: h.command, placeholder: 'cat >> ~/petal-replies.md', spellcheck: false });
  const notify = el('input');
  Object.assign(notify, { type: 'checkbox', checked: h.notify });
  const status = el('span', 'cz-status');
  const runs = el('div');
  runs.append(runsList(page.state.hookRuns));

  command.addEventListener('change', async () => {
    await save({ responseHook: { command: command.value } });
    status.textContent = page.state.config.responseHook.command ? 'Saved. Runs after the next reply.' : 'Hook off.';
  });
  notify.addEventListener('change', () => save({ responseHook: { notify: notify.checked } }));
  const test = actionButton('Test hook', async () => {
    await save({ responseHook: { command: command.value } });
    test.disabled = true;
    status.textContent = 'Running…';
    const result = await window.pastel.config.testHook();
    if (isIpcError(result)) status.textContent = `Test failed: ${result.error}`;
    else status.textContent = 'skipped' in result ? `Not run: ${result.skipped}.` : `Exit ${result.exitCode ?? '–'}${result.timedOut ? ' (timed out)' : ''} in ${result.ms} ms.`;
    const recent = await window.pastel.config.hookRuns();
    if (!isIpcError(recent)) runs.replaceChildren(runsList(recent));
    test.disabled = false;
  });

  const fields = el('div', 'cz-fields');
  fields.append(field('Command', command, 'Runs in your login shell, in the session’s folder. Empty turns it off.'), field('Notify me', notify, 'A notification with the session title and first line of the reply.'));
  const actions = el('div', 'cz-actions');
  actions.append(test, status);

  const how = el('ul', 'cz-list');
  for (const text of [
    'Runs once per finished reply (when Claude goes from busy to idle), in any tab.',
    'stdin is the reply markdown. Env: PETAL_SESSION_ID, PETAL_SESSION_TITLE, PETAL_CWD, PETAL_REPLY_FILE.',
    `Stopped after 30 s. Never runs during snapshot test runs. Reply files: ${page.state.hookDir}.`,
  ]) how.append(el('li', null, text));
  const examples = el('div', 'cz-examples');
  for (const example of ['cat >> ~/petal-replies.md', 'curl -s -X POST --data-binary @- https://example.com/hook']) {
    const use = actionButton(example, () => { command.value = example; command.focus(); }, 'cz-example');
    use.title = 'Use this command';
    examples.append(use);
  }
  return [card('Command', fields, actions), card('How it runs', how, el('p', 'cz-label', 'Examples (click to use)'), examples), card('Recent runs', runs)];
}
