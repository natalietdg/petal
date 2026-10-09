// Customize › Formatting › Output styles: her Claude Code formatting prompts, listed and shown read-only.
import { el, isIpcError } from './dom';
import { actionButton, card, note, page } from './customize-kit';
import type { OutputStyle } from '../main/output-styles';

// The open style survives redraws (a theme change re-renders the section).
let openFile: string | null = null;

function promptPanel(style: OutputStyle): HTMLDivElement {
  const panel = el('div', 'cz-style-panel');
  const status = el('span', 'cz-status');
  const open = actionButton('Open in editor', async () => {
    const result = await window.pastel.config.openStyle(style.file);
    status.textContent = isIpcError(result) ? `Couldn’t open it: ${result.error}` : '';
  });
  const where = el('div', 'cz-actions cz-style-where');
  where.append(el('code', 'cz-style-path', style.file), open, status);
  panel.append(where);
  if (style.problem) panel.append(note(style.problem));
  else {
    const text = el('pre', 'cz-style-text');
    text.tabIndex = 0; // scrollable by keyboard
    text.setAttribute('aria-label', `${style.name} prompt`);
    text.textContent = style.text; // plain text, never the reply markdown renderer
    panel.append(text);
    if (style.truncated) panel.append(note('Showing the first 256 KB.'));
  }
  return panel;
}

function styleRow(style: OutputStyle, list: HTMLElement): HTMLDivElement {
  const row = el('div', 'cz-style');
  row.dataset.file = style.file;
  const head = el('button', 'cz-style-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', String(style.file === openFile));
  const title = el('span', 'cz-style-name', style.name);
  if (style.active) title.append(el('span', 'cz-badge cz-ok cz-style-active', 'Active'));
  head.append(title);
  if (style.description) head.append(el('span', 'cz-style-desc', style.description));
  row.append(head);
  if (style.file === openFile) row.append(promptPanel(style));
  head.addEventListener('click', () => {
    openFile = style.file === openFile ? null : style.file;
    list.replaceChildren(...page.state.outputStyles.styles.map((s) => styleRow(s, list)));
    list.querySelector<HTMLElement>(`[data-file="${CSS.escape(style.file)}"] .cz-style-head`)?.focus();
  });
  return row;
}

export function outputStylesCard(): HTMLDivElement {
  const { styles, problem } = page.state.outputStyles;
  const list = el('div', 'cz-styles');
  list.append(...styles.map((s) => styleRow(s, list)));
  const children: Node[] = [];
  if (problem) children.push(el('p', 'cz-empty', problem));
  if (styles.length) children.push(list);
  children.push(note('Read-only here: Petal never changes these files or which one is active. Open one in your editor to change it.'));
  return card('Output styles', ...children);
}
