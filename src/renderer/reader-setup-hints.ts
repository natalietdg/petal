// The reader's setup help: the install command when Claude Code is missing, and the PATH tip when her shell can't find it.
import { el } from './dom';
import { INSTALL_COMMAND, type PathTip } from '../shared/claude-setup-hints';

const COPIED_MS = 1400;

function copyButton(text: string): HTMLButtonElement {
  const button = el('button', 'flow-button gs-copy', 'Copy');
  button.type = 'button';
  button.dataset.copy = text;
  button.addEventListener('click', async () => {
    const copied = await navigator.clipboard.writeText(text).then(() => true, () => false);
    button.textContent = copied ? 'Copied' : 'Copy failed';
    setTimeout(() => { button.textContent = 'Copy'; }, COPIED_MS);
  });
  return button;
}

function commandRow(command: string): HTMLDivElement {
  const row = el('div', 'gs-command');
  row.append(el('code', null, command), copyButton(command));
  return row;
}

// Under "Claude Code isn't installed yet": the official command, and where to run it.
export const installSteps = (): HTMLElement[] => [
  commandRow(INSTALL_COMMAND),
  el('p', 'reader-setup-hint', 'Paste it into the terminal below and press Return. When it finishes, click Add Session.'),
];

// A standing line above the replies while her shell's PATH is missing claude's folder.
export const pathTipLine = el('div', 'reader-path-tip');
pathTipLine.hidden = true;

export function setPathTip(tip: PathTip | null): void {
  pathTipLine.hidden = !tip;
  if (!tip) { pathTipLine.replaceChildren(); return; }
  pathTipLine.replaceChildren(el('p', null, `Your shell’s PATH doesn’t include ${tip.dir}; add this line to ${tip.rcFile}:`), commandRow(tip.line));
}
