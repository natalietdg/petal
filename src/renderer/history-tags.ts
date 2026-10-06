// History's tags UI: chips, the filter bar (click filters, × deletes, double-click renames) and the preview's tag line.
import { el, query } from './dom';
import { folded, hooks, openNote, selectedSession, state, TAGBAR_KEY, tagBar, toggleFold } from './history-state';
import type { InvokeResult } from '../shared/ipc';

let previewTags: HTMLDivElement | null = null; // the tag line in the preview header, redrawn on its own

export const UNTAGGED = 'Untagged';

// A pill with the tag's colour as a dot, like Finder.
export function tagChip(name: string, className = ''): HTMLSpanElement {
  const chip = el('span', `history-tag ${className}`.trim());
  chip.style.setProperty('--tag-color', state.tagColors[name]?.color ?? 'var(--muted)');
  chip.append(el('span', 'history-tag-name', name));
  return chip;
}

// Most-used tags first, so the bar and suggestions lead with the common ones.
export function tagNames(): string[] {
  const counts = new Map(Object.keys(state.tagColors).map((n) => [n, 0]));
  for (const s of state.sessions) for (const t of s.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n);
}

// Every edit re-reads the list, so chips, bar and groups never disagree.
async function editTags(request: Promise<InvokeResult<'history:tag-add'>>): Promise<void> {
  const result = await request;
  if ('error' in result) openNote.textContent = `Couldn’t change tags: ${result.error}`;
  await hooks.refresh();
  renderPreviewTags();
}
export const addTag = (sessionId: string, name: string) => editTags(window.pastel.history.tagAdd(sessionId, name));
export const removeTag = (sessionId: string, name: string) => editTags(window.pastel.history.tagRemove(sessionId, name));

// Click a tag to filter; × deletes it everywhere; double-click renames.
export function renderTagBar(): void {
  const names = tagNames();
  tagBar.hidden = !names.length;
  const barFolded = folded.has(TAGBAR_KEY);
  const fold = el('button', 'history-fold history-tagbar-fold', barFolded ? `▸ Tags${state.tagFilter.size ? ` · ${state.tagFilter.size} on` : ''}` : '▾ Tags');
  fold.type = 'button';
  fold.setAttribute('aria-expanded', String(!barFolded));
  fold.addEventListener('click', () => { toggleFold(TAGBAR_KEY); renderTagBar(); });
  if (barFolded) {
    tagBar.replaceChildren(fold);
    return;
  }
  tagBar.replaceChildren(fold, ...names.map((name) => {
    const chip = tagChip(name, 'history-tag-filter');
    chip.setAttribute('aria-pressed', String(state.tagFilter.has(name)));
    const label = query(chip, '.history-tag-name');
    label.setAttribute('role', 'button');
    label.tabIndex = 0;
    label.title = 'Filter by this tag · double-click to rename';
    const toggleFilter = () => {
      if (state.tagFilter.has(name)) state.tagFilter.delete(name);
      else state.tagFilter.add(name);
      renderTagBar();
      hooks.renderList();
    };
    label.addEventListener('click', toggleFilter);
    label.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleFilter(); } });
    label.addEventListener('dblclick', () => startRename(chip, name));
    const remove = el('button', 'history-tag-remove', '×');
    remove.type = 'button';
    remove.title = `Delete “${name}” from every session`;
    remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', () => {
      if (!window.confirm(`Delete the tag “${name}” from every session? The organizer won’t use it again.`)) return;
      state.tagFilter.delete(name);
      editTags(window.pastel.history.tagDelete(name));
    });
    chip.append(remove);
    return chip;
  }));
}

function startRename(chip: HTMLElement, name: string): void {
  const input = el('input', 'history-tag-input');
  input.value = name;
  input.setAttribute('aria-label', `Rename “${name}”`);
  let done = false;
  const finish = (save: boolean): void => {
    if (done) return;
    done = true;
    const to = input.value.trim();
    if (!save || !to || to === name) {
      renderTagBar();
      return;
    }
    if (state.tagFilter.delete(name)) state.tagFilter.add(to);
    editTags(window.pastel.history.tagRename(name, to));
  };
  input.addEventListener('keydown', (event) => {
    event.stopPropagation(); // Esc cancels the rename, not History
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  chip.replaceChildren(input);
  input.focus();
  input.select();
}

// The selected session's tags, with × and a "+ Tag" field that suggests existing names.
export function renderPreviewTags(): void {
  const session = selectedSession();
  if (!previewTags || !session) return;
  const chips = session.tags.map((name) => {
    const chip = tagChip(name);
    const remove = el('button', 'history-tag-remove', '×');
    remove.type = 'button';
    remove.title = `Remove “${name}”`;
    remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', () => removeTag(session.sessionId, name));
    chip.append(remove);
    return chip;
  });
  const add = el('button', 'history-tag-add', '+ Tag');
  add.type = 'button';
  add.addEventListener('click', () => {
    const input = el('input', 'history-tag-input');
    input.placeholder = 'Tag name';
    input.setAttribute('list', 'history-tag-suggestions');
    input.setAttribute('aria-label', 'Add a tag');
    const options = el('datalist');
    options.id = 'history-tag-suggestions';
    for (const name of tagNames().filter((n) => !session.tags?.includes(n))) {
      const option = el('option');
      option.value = name;
      options.append(option);
    }
    input.addEventListener('keydown', (event) => {
      event.stopPropagation(); // Esc closes the field, not History
      if (event.key === 'Enter' && input.value.trim()) addTag(session.sessionId, input.value);
      if (event.key === 'Escape') renderPreviewTags();
    });
    input.addEventListener('change', () => { // picking a suggestion adds it straight away
      if (state.tagColors[input.value]) addTag(session.sessionId, input.value);
    });
    input.addEventListener('blur', () => setTimeout(() => { if (input.isConnected) renderPreviewTags(); }, 150));
    add.replaceWith(input, options);
    input.focus();
  });
  previewTags.replaceChildren(...chips, add);
}

// The preview header owns the tag line; it hands it over each time it redraws.
export function attachPreviewTags(line: HTMLDivElement): void {
  previewTags = line;
  renderPreviewTags();
}
