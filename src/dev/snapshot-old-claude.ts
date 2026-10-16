// Claude Code before 2.1.75 has no session file: the empty reader shows the update hint, and asks which log is this tab's.
import { oldClaudeHint, SHARED_FOLDER_LINE, UPDATE_COMMAND } from '../shared/reader-notice';
import type { Kit } from './snapshot';

const VERSION = '2.1.74';
const live = (notice: unknown) => ({ state: 'live', replies: [], waiting: [], promptCount: 0, busy: false, sessionId: null, cwd: null, repo: null, conclusion: null, tabId: 'old-claude-check', notice });
const HINT_ONLY = live({ oldVersion: VERSION, choices: [] });
const CHOOSING = live({ oldVersion: VERSION, choices: [
  { sessionId: 'aaaaaaaa-0000-4000-8000-000000000001', startedAt: '2026-10-16T09:00:00.000Z', prompt: 'fix the login bug' },
  { sessionId: 'aaaaaaaa-0000-4000-8000-000000000002', startedAt: '2026-10-16T09:05:00.000Z', prompt: null },
] });

const STATE = `(() => {
  const status = document.getElementById('reader-status');
  const hint = status.querySelector('.notice-update');
  return { text: status.textContent, empty: status.classList.contains('empty'), hint: hint?.textContent ?? null, code: hint?.querySelector('code')?.textContent ?? null,
    copy: hint?.querySelector('button.notice-copy')?.textContent ?? null, choices: [...status.querySelectorAll('button.notice-choice')].map((b) => b.textContent) };
})()`;

export async function oldClaudeCheck(kit: Kit): Promise<void> {
  const { js, waitFor, log, capture } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} old claude: ${what}`);
  // The fixture feed can redraw the reader; re-send until the notice is the one on screen.
  const show = (update: unknown, ready: string) => waitFor(async () => {
    await js(`PastelTerm.reader.update(${JSON.stringify(update)})`);
    const state = await js(STATE);
    return state.text.includes(ready) ? state : null;
  }, 5000);

  const expected = oldClaudeHint(VERSION).replace(`\`${UPDATE_COMMAND}\``, UPDATE_COMMAND);
  const hint = await show(HINT_ONLY, 'older than Petal needs');
  check(hint?.empty && hint.text.includes('Claude is running. Its replies will appear here.'), `running line kept above the hint: ${JSON.stringify(hint?.text)}`);
  check(hint?.hint?.startsWith(expected), `hint text exact: ${JSON.stringify(hint?.hint)}`);
  check(hint?.code === UPDATE_COMMAND && hint.copy === 'Copy', `command set as code with a Copy button: ${JSON.stringify(hint)}`);
  check(hint && !/[—–]/.test(hint.text), 'no em or en dash');
  await capture('old-claude-hint');

  const choosing = await show(CHOOSING, SHARED_FOLDER_LINE);
  check(choosing && !choosing.text.includes('Claude is running'), 'the choice replaces the running line');
  check(choosing?.choices.length === 2 && choosing.choices[0].includes('fix the login bug') && choosing.choices[1].startsWith('Started'), `one button per log: ${JSON.stringify(choosing?.choices)}`);
  check(choosing?.hint?.startsWith(expected), 'the update hint still shows under the choice');
  await capture('old-claude-choose');
}
