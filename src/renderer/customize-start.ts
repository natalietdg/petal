// Customize section Get started: reopen the checklist, and allow or stop Petal reading ~/.claude.
import * as getStarted from './get-started';
import * as consent from './consent';
import * as shortcuts from './shortcuts';
import { actionButton, card, note, page } from './customize-kit';
import { el } from './dom';

function folderSwitch(): HTMLLabelElement {
  const label = el('label', 'welcome-switch cz-folder-switch');
  const box = el('input');
  Object.assign(box, { type: 'checkbox', checked: page.state.config.claudeFolder.choice === 'allowed' });
  box.addEventListener('change', async () => {
    await consent.setChoice(box.checked ? 'allowed' : 'declined');
    page.state.config.claudeFolder.choice = box.checked ? 'allowed' : 'declined';
  });
  label.append(box, el('span', null, 'Let Petal read your Claude folder (~/.claude)'));
  return label;
}

// A small link to the Shortcuts guide, under the Get started button.
function shortcutsLink(): HTMLParagraphElement {
  const line = el('p', 'cz-note');
  const link = el('a', 'wf-doc-link cz-open-shortcuts', 'Shortcuts');
  link.href = '#';
  link.addEventListener('click', (event) => { event.preventDefault(); shortcuts.open(); });
  line.append(link, ' · every key and word Petal knows (⌘/)');
  return line;
}

export function renderStart(): HTMLElement[] {
  return [
    card('Get started', note('The four steps from installing Claude Code to your first reply, with what Petal has seen so far.'),
      actionButton('Open Get started', () => getStarted.open(), 'flow-button cz-open-get-started'), shortcutsLink()),
    card('Your Claude folder', folderSwitch(),
      note(`Petal reads: ${consent.READS.join(' ')} Everything stays on this Mac and nothing is uploaded. Off, the terminal works as usual and the reader, History and Agents stay empty.`)),
  ];
}
