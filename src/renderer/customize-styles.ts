// Customize › Formatting › Output styles: her Claude Code formatting prompts, shown read-only, with Use this style to switch the active one.
import { el, isIpcError } from './dom';
import { actionButton, card, note, page } from './customize-kit';
import type { OutputStyle, StyleSwitch } from '../main/output-styles';
import type { CustomizeState } from '../shared/ipc';

// The open style survives redraws (a theme change re-renders the section).
let openFile: string | null = null;
// The line after a switch, kept only while the page shows the state it was made against (a reopen clears it).
let switched: { lines: string[]; state: CustomizeState } | null = null;

// Running sessions re-read settings.json, so the switch reaches them on their next message.
function switchedLines({ name, override }: StyleSwitch): string[] {
  const lines = [`New Claude sessions use ${name}; running ones switch on their next message.`];
  if (override) lines.push(`~/.claude/settings.local.json names ${override}, which still wins for sessions started in your home folder.`);
  return lines;
}

async function useStyle(style: OutputStyle, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  const result = await window.pastel.config.useStyle(style.name);
  const fresh = await window.pastel.config.get();
  if (!isIpcError(fresh)) page.state = fresh;
  switched = { lines: isIpcError(result) ? [`Couldn’t switch: ${result.error}`] : switchedLines(result), state: page.state };
  page.redraw();
  document.querySelector<HTMLElement>(`#customize .cz-style[data-file="${CSS.escape(style.file)}"] .cz-style-head`)?.focus();
}

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
  const top = el('div', 'cz-style-top');
  top.append(head);
  if (!style.active && !style.problem) {
    const use: HTMLButtonElement = actionButton('Use this style', () => useStyle(style, use), 'flow-button cz-style-use');
    use.setAttribute('aria-label', `Use ${style.name}`);
    top.append(use);
  }
  row.append(top);
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
  if (switched?.state === page.state) children.push(...switched.lines.map((line) => note(line, 'cz-note cz-style-switched')));
  children.push(note('Use this style changes only outputStyle in ~/.claude/settings.json; Petal never edits the style files. A style picked with /output-style inside a project is saved there and wins in that project.'));
  return card('Output styles', ...children);
}
