// History: this past week's Claude sessions. Replaces the reader while open; Esc or Cmd+Y goes back.
PastelTerm.history = (() => {
  const view = document.getElementById('history');
  const reader = document.getElementById('reader');
  const button = document.getElementById('history-button');
  let sessions = [];
  let selectedId = null;
  let previewMode = 'replies';
  let groupBy = 'tag';
  let tagColors = {}; // { [name]: { color } } from tags.json
  const tagFilter = new Set(); // every selected tag must be on a session (AND)
  let previewTags = null; // the tag line in the preview header, redrawn on its own

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  view.innerHTML = `
    <div class="history-list-pane">
      <input id="history-search" class="history-search" type="search" placeholder="Search titles and first prompts" aria-label="Search sessions">
      <div class="history-toolbar">
        <div id="history-group" class="view-toggle history-group" role="tablist" aria-label="Group sessions">
          <button type="button" data-group="tag" aria-selected="true">By tag</button>
          <button type="button" data-group="day" aria-selected="false">By day</button>
          <button type="button" data-group="project" aria-selected="false">By project</button>
        </div>
        <button id="history-tidy" class="flow-button history-tidy" type="button" title="Give recent sessions clear titles and projects">Tidy now</button>
      </div>
      <div id="history-tagbar" class="history-tagbar" role="group" aria-label="Filter by tag"></div>
      <p id="history-open-note" class="history-note" aria-live="polite"></p>
      <div id="history-list" class="history-list"></div>
    </div>
    <div id="history-preview" class="history-preview reader-column"></div>`;
  const search = view.querySelector('#history-search');
  const list = view.querySelector('#history-list');
  const preview = view.querySelector('#history-preview');
  const openNote = view.querySelector('#history-open-note');
  const groupToggle = view.querySelector('#history-group');
  const tidyButton = view.querySelector('#history-tidy');
  const tagBar = view.querySelector('#history-tagbar');

  // Organizer labels win over Claude Code's own title when present.
  const titleOf = (session) => session.organizer?.title || session.title || 'Untitled session';
  const projectOf = (session) => session.organizer?.project || 'Unsorted';

  function dayLabel(ms) {
    const day = new Date(ms);
    day.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - day) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return day.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
  }
  const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const UNTAGGED = 'Untagged';

  // A pill with the tag's colour as a dot, like Finder.
  function tagChip(name, className = '') {
    const chip = el('span', `history-tag ${className}`.trim());
    chip.style.setProperty('--tag-color', tagColors[name]?.color ?? 'var(--muted)');
    chip.append(el('span', 'history-tag-name', name));
    return chip;
  }

  // Most-used tags first, so the bar and suggestions lead with the common ones.
  function tagNames() {
    const counts = new Map(Object.keys(tagColors).map((n) => [n, 0]));
    for (const s of sessions) for (const t of s.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n);
  }

  // Every edit re-reads the list, so chips, bar and groups never disagree.
  async function editTags(request) {
    const result = await request;
    if (result?.error) openNote.textContent = `Couldn’t change tags: ${result.error}`;
    await refresh();
    renderPreviewTags();
  }
  const addTag = (sessionId, name) => editTags(window.pastel.history.tagAdd(sessionId, name));
  const removeTag = (sessionId, name) => editTags(window.pastel.history.tagRemove(sessionId, name));

  function row(session) {
    const item = el('button', `history-row${session.sessionId === selectedId ? ' selected' : ''}`);
    item.type = 'button';
    item.dataset.sessionId = session.sessionId;
    const title = el('span', 'history-title');
    title.append(el('span', 'history-title-text', titleOf(session)));
    const status = session.organizer?.status;
    if (status) title.append(el('span', `history-status history-status-${status.replace(/\s+/g, '-')}`, status));
    if (session.live) title.append(el('span', 'history-live', 'live'));
    if (session.hasFlow) title.append(el('span', 'history-flow', 'flow'));
    const count = `${session.messages}${session.messagesExact ? '' : '+'} messages`;
    const meta = el('span', 'history-meta');
    if (session.organizer?.project) meta.append(el('span', 'history-project', session.organizer.project));
    meta.append(document.createTextNode([session.shortCwd, timeOf(session.lastAt), count].join(' · ')));
    item.append(title, meta);
    if (session.tags?.length) {
      const tags = el('span', 'history-tags');
      for (const name of session.tags) {
        const chip = tagChip(name);
        const remove = el('span', 'history-tag-remove', '×');
        remove.title = `Remove “${name}”`;
        remove.addEventListener('click', (event) => { event.stopPropagation(); removeTag(session.sessionId, name); }); // not an open
        chip.append(remove);
        tags.append(chip);
      }
      item.append(tags);
    }
    // Click opens the session; hovering or focusing shows its preview.
    item.addEventListener('click', () => doResume(session.sessionId, openNote, false));
    item.addEventListener('mouseenter', () => preview_(session.sessionId));
    item.addEventListener('focus', () => preview_(session.sessionId));
    return item;
  }

  // A session with several tags sits under each of them.
  function groupLabels(session) {
    if (groupBy === 'project') return [projectOf(session)];
    if (groupBy === 'day') return [dayLabel(session.lastAt)];
    return session.tags?.length ? session.tags : [UNTAGGED];
  }

  // Folded groups and the folded tag bar are remembered per viewer; storage can be unavailable, so never rely on it.
  const FOLD_KEY = 'petal.history.folded';
  const readFolds = () => { try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || '[]')); } catch { return new Set(); } };
  const folded = readFolds();
  const saveFolds = () => { try { localStorage.setItem(FOLD_KEY, JSON.stringify([...folded])); } catch { /* per-viewer nicety only */ } };
  const foldKey = (label) => `${groupBy}:${label}`;
  const TAGBAR_KEY = 'tagbar';

  function toggleFold(key) {
    if (folded.has(key)) folded.delete(key);
    else folded.add(key);
    saveFolds();
  }

  function groupHeading(label, count) {
    const heading = el('h3', 'history-day history-group-heading');
    const isFolded = folded.has(foldKey(label));
    const toggle = el('button', 'history-fold', isFolded ? '▸' : '▾');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(!isFolded));
    toggle.setAttribute('aria-label', `${isFolded ? 'Show' : 'Hide'} ${label}`);
    heading.append(toggle);
    if (groupBy === 'tag' && label !== UNTAGGED) heading.append(tagChip(label, 'history-tag-heading'));
    else heading.append(document.createTextNode(label));
    heading.append(el('span', 'history-group-count', String(count)));
    toggle.addEventListener('click', () => { toggleFold(foldKey(label)); renderList(); });
    return heading;
  }

  function renderList() {
    const query = search.value.trim().toLowerCase();
    const haystack = (s) => `${s.title} ${s.firstPrompt} ${s.organizer?.title ?? ''} ${s.organizer?.project ?? ''} ${(s.tags ?? []).join(' ')}`.toLowerCase();
    const hasEveryTag = (s) => [...tagFilter].every((t) => s.tags?.includes(t));
    const shown = sessions.filter((s) => (!query || haystack(s).includes(query)) && hasEveryTag(s));
    // Sessions arrive newest first, so groups and their rows keep that order.
    const groups = new Map();
    for (const session of shown) {
      for (const label of groupLabels(session)) {
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(session);
      }
    }
    if (groups.has(UNTAGGED)) { // untagged sinks to the bottom
      const untagged = groups.get(UNTAGGED);
      groups.delete(UNTAGGED);
      groups.set(UNTAGGED, untagged);
    }
    list.replaceChildren(...[...groups].flatMap(([label, items]) => [
      groupHeading(label, items.length),
      ...(folded.has(foldKey(label)) ? [] : items.map(row)),
    ]));
    const filtered = query || tagFilter.size;
    if (!shown.length) list.append(el('p', 'history-empty', filtered ? 'No sessions match.' : 'No sessions this past week.'));
  }

  // Click a tag to filter; × deletes it everywhere; double-click renames.
  function renderTagBar() {
    const names = tagNames();
    tagBar.hidden = !names.length;
    const barFolded = folded.has(TAGBAR_KEY);
    const fold = el('button', 'history-fold history-tagbar-fold', barFolded ? `▸ Tags${tagFilter.size ? ` · ${tagFilter.size} on` : ''}` : '▾ Tags');
    fold.type = 'button';
    fold.setAttribute('aria-expanded', String(!barFolded));
    fold.addEventListener('click', () => { toggleFold(TAGBAR_KEY); renderTagBar(); });
    if (barFolded) {
      tagBar.replaceChildren(fold);
      return;
    }
    tagBar.replaceChildren(fold, ...names.map((name) => {
      const chip = tagChip(name, 'history-tag-filter');
      chip.setAttribute('aria-pressed', String(tagFilter.has(name)));
      const label = chip.querySelector('.history-tag-name');
      label.setAttribute('role', 'button');
      label.tabIndex = 0;
      label.title = 'Filter by this tag · double-click to rename';
      const toggleFilter = () => {
        if (tagFilter.has(name)) tagFilter.delete(name);
        else tagFilter.add(name);
        renderTagBar();
        renderList();
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
        tagFilter.delete(name);
        editTags(window.pastel.history.tagDelete(name));
      });
      chip.append(remove);
      return chip;
    }));
  }

  function startRename(chip, name) {
    const input = el('input', 'history-tag-input');
    input.value = name;
    input.setAttribute('aria-label', `Rename “${name}”`);
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const to = input.value.trim();
      if (!save || !to || to === name) return renderTagBar();
      if (tagFilter.delete(name)) tagFilter.add(to);
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
  function renderPreviewTags() {
    const session = sessions.find((s) => s.sessionId === selectedId);
    if (!previewTags || !session) return;
    const chips = (session.tags ?? []).map((name) => {
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
        if (tagColors[input.value]) addTag(session.sessionId, input.value);
      });
      input.addEventListener('blur', () => setTimeout(() => { if (input.isConnected) renderPreviewTags(); }, 150));
      add.replaceWith(input, options);
      input.focus();
    });
    previewTags.replaceChildren(...chips, add);
  }

  async function renderPreview() {
    const session = sessions.find((s) => s.sessionId === selectedId);
    if (!session) {
      preview.replaceChildren(el('p', 'status empty', 'Pick a session to preview it.'));
      return;
    }
    const head = el('header', 'history-preview-head');
    head.append(el('h2', 'history-preview-title', titleOf(session)),
      el('p', 'status', `${session.shortCwd} · ${dayLabel(session.lastAt)} ${timeOf(session.lastAt)}`));
    previewTags = el('div', 'history-preview-tags');
    head.append(previewTags);
    renderPreviewTags();

    const note = el('p', 'history-note');
    const resume = el('button', 'flow-button resume-button', 'Open');
    resume.type = 'button';
    resume.addEventListener('click', () => doResume(session.sessionId, note, false));
    const toggle = el('div', 'view-toggle');
    for (const mode of ['replies', 'flow', 'decisions']) {
      const b = el('button', '', { replies: 'Replies', flow: 'Flow', decisions: 'Decisions' }[mode]);
      b.type = 'button';
      b.setAttribute('aria-selected', String(mode === previewMode));
      b.addEventListener('click', () => { previewMode = mode; renderPreview(); });
      toggle.append(b);
    }
    const send = el('button', 'flow-button resume-button', 'Send to Claude');
    send.type = 'button';
    send.title = 'Let the Claude in this window read this session';
    send.addEventListener('click', () => doSend(session.sessionId, note));
    head.append(resume, send, note, toggle);

    const body = el('div', 'history-preview-body');
    preview.replaceChildren(head, body);
    try {
      await (previewMode === 'replies' ? renderRepliesBody(session, body) : renderFlowBody(session, body));
    } catch (error) {
      showError(body, error);
    }
  }

  // Failures show as a line in the pane, never as a blank preview.
  function showError(body, error) {
    body.replaceChildren(el('p', 'history-error', `Couldn’t show this session: ${error?.message ?? error}`));
  }

  async function renderFlowBody(session, body) {
    const target = { kind: 'history', sessionId: session.sessionId };
    const draw = previewMode === 'decisions' ? PastelTerm.flow.renderDecisions : PastelTerm.flow.render;
    draw(body, await window.pastel.flow.get(target), {
      target,
      onJump: () => { previewMode = 'replies'; renderPreview(); },
      onCreated: () => { session.hasFlow = true; renderList(); },
    });
  }

  async function renderRepliesBody(session, body) {
    const result = await window.pastel.history.preview(session.sessionId);
    if (result.error) return showError(body, result.error);
    if (!result.replies.length) {
      body.append(el('p', 'status', result.wholeFile ? 'No text replies in this session.' : 'No text replies in the last 4 MB of this session.'));
      return;
    }
    for (const reply of result.replies) {
      const card = el('article', 'history-reply');
      card.dataset.replyId = reply.id;
      card.append(PastelTerm.markdown.render(reply.markdown));
      body.append(card);
      PastelTerm.diagrams.render(card);
    }
  }

  async function doResume(sessionId, note, confirmFork) {
    const result = await window.pastel.history.resume(sessionId, confirmFork);
    note.replaceChildren();
    if (result.ok) {
      close();
      return;
    }
    if (result.confirm) {
      const again = el('button', 'flow-button', 'Open anyway');
      again.type = 'button';
      again.addEventListener('click', () => doResume(sessionId, note, true));
      note.append(document.createTextNode(`${result.confirm} `), again);
      return;
    }
    note.textContent = result.note;
  }

  async function doSend(sessionId, note) {
    note.textContent = 'Preparing…';
    const result = await window.pastel.history.send(sessionId);
    if (result.ok) {
      note.replaceChildren();
      close(); // back to the terminal, where the "read this" line is waiting for her question
      return;
    }
    note.textContent = result.note ?? result.error;
  }

  // Preview without re-rendering the list, so hovering never steals the row under the mouse.
  function preview_(sessionId) {
    if (sessionId === selectedId) return;
    selectedId = sessionId;
    for (const r of document.querySelectorAll('.history-row')) r.classList.toggle('selected', r.dataset.sessionId === sessionId);
    renderPreview();
  }

  function select(sessionId) {
    selectedId = sessionId;
    renderList();
    renderPreview();
  }

  // Re-reads the list; returns whether a background pass is running.
  async function refresh() {
    const result = await window.pastel.history.list();
    sessions = result.sessions;
    tagColors = result.tags ?? {};
    for (const name of [...tagFilter]) if (!tagColors[name]) tagFilter.delete(name); // a deleted tag can't stay a filter
    if (!sessions.some((s) => s.sessionId === selectedId)) selectedId = sessions[0]?.sessionId ?? null;
    renderTagBar();
    renderList();
    return result.organizing;
  }

  // Also joins a pass the timer already started, so the button shows it.
  async function tidy() {
    if (tidyButton.disabled) return;
    tidyButton.disabled = true;
    tidyButton.textContent = 'Organizing…';
    try {
      const result = await window.pastel.history.tidy();
      if (result?.error) openNote.textContent = `Couldn’t organize: ${result.error}`;
      if (isOpen()) await refresh();
    } finally {
      tidyButton.disabled = false;
      tidyButton.textContent = 'Tidy now';
    }
  }

  function setGroupBy(mode) {
    groupBy = mode;
    for (const b of groupToggle.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.group === mode));
    renderList();
  }

  async function open() {
    view.hidden = false;
    reader.hidden = true;
    button.setAttribute('aria-pressed', 'true');
    const organizing = await refresh();
    renderPreview();
    search.focus();
    if (organizing) tidy();
  }

  function close() {
    view.hidden = true;
    reader.hidden = false;
    button.setAttribute('aria-pressed', 'false');
    window.dispatchEvent(new Event('petal:focus-terminal')); // the clicked row is gone; keys must reach the shell
  }

  const isOpen = () => !view.hidden;
  const toggle = () => (isOpen() ? close() : open());

  button.addEventListener('click', toggle);
  search.addEventListener('input', renderList);
  groupToggle.addEventListener('click', (event) => { if (event.target.dataset.group) setGroupBy(event.target.dataset.group); });
  tidyButton.addEventListener('click', tidy);
  view.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  window.pastel.onToggleHistory(toggle);

  return { open, close, isOpen, toggle, select, rerender: () => isOpen() && renderPreview(), setPreviewMode: (m) => { previewMode = m; return renderPreview(); } };
})();
