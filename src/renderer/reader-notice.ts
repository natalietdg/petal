// The empty reader's extra lines for an older Claude Code: the update hint, and "which log is this tab's".
import { el } from './dom';
import { timeOf } from './format';
import { oldClaudeHint, SHARED_FOLDER_LINE, UPDATE_COMMAND } from '../shared/reader-notice';
import type { ReaderNotice, SessionChoice } from '../shared/types';

const COPIED_MS = 1600;

function copyButton(text: string): HTMLButtonElement {
  const button = el('button', 'flow-button status-action notice-copy', 'Copy');
  button.type = 'button';
  button.addEventListener('click', async () => {
    const copied = await navigator.clipboard.writeText(text).then(() => true, () => false);
    button.textContent = copied ? 'Copied' : 'Copy failed';
    setTimeout(() => { button.textContent = 'Copy'; }, COPIED_MS);
  });
  return button;
}

// The hint as text, with the command set as code.
function hintLine(version: string): HTMLParagraphElement {
  const line = el('p', 'notice-update');
  const [before, after] = oldClaudeHint(version).split(`\`${UPDATE_COMMAND}\``);
  line.append(before, el('code', null, UPDATE_COMMAND), after ?? '', ' ', copyButton(UPDATE_COMMAND));
  return line;
}

const choiceLabel = ({ startedAt, prompt }: SessionChoice): string =>
  [startedAt ? `Started ${timeOf(startedAt)}` : 'Session', prompt ? `“${prompt.length > 60 ? `${prompt.slice(0, 60)}…` : prompt}”` : null].filter(Boolean).join(' · ');

function choiceButton(choice: SessionChoice, tabId: string): HTMLButtonElement {
  const button = el('button', 'flow-button status-action notice-choice', choiceLabel(choice));
  button.type = 'button';
  button.dataset.sessionId = choice.sessionId;
  button.addEventListener('click', () => window.pastel.pickSession(tabId, choice.sessionId));
  return button;
}

// The lines to show under (or instead of) "Claude is running", or null when there's nothing to say.
export function noticeLines(notice: ReaderNotice | null | undefined, tabId: string | null | undefined): HTMLElement[] | null {
  if (!notice) return null;
  const lines: HTMLElement[] = [];
  if (notice.choices.length && tabId) {
    const pick = el('div', 'notice-choices');
    pick.append(el('p', null, SHARED_FOLDER_LINE), ...notice.choices.map((c) => choiceButton(c, tabId)));
    lines.push(pick);
  }
  if (notice.oldVersion) lines.push(hintLine(notice.oldVersion));
  return lines.length ? lines : null;
}
