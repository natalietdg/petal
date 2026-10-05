// Session tabs: each tab owns one xterm and one pty in main; only the active one is shown.
PastelTerm.tabs = (() => {
  const strip = document.getElementById('tab-strip');
  const stage = document.getElementById('terminal');
  const tabs = new Map(); // tabId -> { id, host, term, renderer, refit, element, update }
  let activeId = null;
  let nextNumber = 1;
  let theme = null;
  let hooks = { onActivate: () => {}, onCreated: () => {} };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  const newTabButton = el('button', 'tab-new', '+');
  newTabButton.type = 'button';
  newTabButton.title = 'New tab (⌘T)';
  newTabButton.addEventListener('click', () => create());
  strip.append(newTabButton);

  function tabElement(id) {
    const element = el('div', 'tab');
    element.setAttribute('role', 'tab');
    element.dataset.tabId = id;
    const close = el('button', 'tab-close', '×');
    close.type = 'button';
    close.title = 'Close tab (⌘W)';
    close.addEventListener('click', (event) => { event.stopPropagation(); requestClose(id); });
    element.append(el('span', 'tab-dot'), el('span', 'tab-label', 'Shell'), close);
    element.addEventListener('click', () => activate(id));
    return element;
  }

  function init(options) {
    theme = options.theme;
    hooks = { ...hooks, ...options };
  }

  // Shown before its shell starts, so the pty is spawned at the visible grid size.
  function create() {
    const id = `t${nextNumber++}`;
    const host = el('div', 'term-host');
    stage.append(host);
    const { term, renderer, refit } = PastelTerm.terminal.create(host, theme, id);
    const tab = { id, host, term, renderer, refit, element: tabElement(id), update: null };
    strip.insertBefore(tab.element, newTabButton);
    tabs.set(id, tab);
    hooks.onCreated(tab);
    activate(id);
    window.pastel.startShell(id, { cols: term.cols, rows: term.rows });
    return tab;
  }

  function activate(id) {
    const tab = tabs.get(id);
    if (!tab) return;
    activeId = id;
    for (const other of tabs.values()) {
      other.host.hidden = other !== tab;
      other.element.setAttribute('aria-selected', String(other === tab));
    }
    tab.refit();
    tab.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    window.pastel.activateTab(id);
    hooks.onActivate(tab);
    tab.term.focus();
  }

  function cycle(delta) {
    const ids = [...tabs.keys()];
    if (ids.length < 2) return;
    activate(ids[(ids.indexOf(activeId) + delta + ids.length) % ids.length]);
  }

  // Main kills the pty; its exit comes back as tab:closed, which calls remove().
  const requestClose = (id) => { if (tabs.has(id)) window.pastel.closeShell(id); };

  function remove(id) {
    const tab = tabs.get(id);
    if (!tab) return;
    const ids = [...tabs.keys()];
    const index = ids.indexOf(id);
    tab.term.dispose();
    tab.host.remove();
    tab.element.remove();
    tabs.delete(id);
    if (id === activeId && tabs.size) activate(ids[index + 1] ?? ids[index - 1]);
  }

  function setUpdate(id, update) {
    const tab = tabs.get(id);
    if (!tab) return;
    tab.update = update;
    tab.element.classList.toggle('busy', Boolean(update.busy));
    tab.element.querySelector('.tab-label').textContent = update.label;
    tab.element.title = update.label;
  }

  function applyTheme(next) {
    theme = next;
    for (const tab of tabs.values()) tab.term.options.theme = PastelTerm.theme.toXterm(next);
  }

  window.pastel.onData(({ tabId, data }) => tabs.get(tabId)?.term.write(data));

  return {
    init, create, activate, cycle, requestClose, remove, setUpdate, applyTheme,
    active: () => tabs.get(activeId) ?? null,
    get: (id) => tabs.get(id) ?? null,
    ids: () => [...tabs.keys()],
  };
})();
