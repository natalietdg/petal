// Customize section First steps: open the pet guide's checklist, token facts, and allow or stop Petal reading ~/.claude.
import * as getStarted from './get-started';
import * as consent from './consent';
import * as shortcuts from './shortcuts';
import { actionButton, card, note, page } from './customize-kit';
import { el } from './dom';
import { TOKEN_OWN, TOKEN_TITLE, TOKEN_USERS, styleLine, tokenLead } from '../shared/token-facts';

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

// A small link to the Shortcuts guide, under the pet guide button.
function shortcutsLink(): HTMLParagraphElement {
  const line = el('p', 'cz-note');
  const link = el('a', 'wf-doc-link cz-open-shortcuts', 'Shortcuts');
  link.href = '#';
  link.addEventListener('click', (event) => { event.preventDefault(); shortcuts.open(); });
  line.append(link, ' · every key and word Petal knows (⌘/)');
  return line;
}

// For anyone worried about cost: what Petal itself spends (nothing), what a style adds, and each feature that starts Claude.
export function tokenFacts(): HTMLElement[] {
  const list = el('ul', 'cz-token-list');
  list.append(...TOKEN_USERS.map(({ what, off }) => {
    const item = el('li');
    item.append(el('strong', null, `${what}. `), off);
    return item;
  }));
  return [note(tokenLead()), note(styleLine()), note('These start Claude on your plan:'), list, note(TOKEN_OWN)];
}

export function renderStart(): HTMLElement[] {
  return [
    card('First steps', note('Your pet shows the four steps from installing Claude Code to your first reply, ticked as Petal sees them. Help › Get started runs the whole guide again.'),
      actionButton('Open the pet guide', () => void getStarted.open(), 'flow-button cz-open-get-started'), shortcutsLink()),
    card(TOKEN_TITLE, ...tokenFacts()),
    card('Your Claude folder', folderSwitch(),
      note(`Petal reads: ${consent.READS.join(' ')} Everything stays on this Mac and nothing is uploaded. Off, the terminal works as usual and the reader, History and Agents stay empty.`)),
  ];
}
