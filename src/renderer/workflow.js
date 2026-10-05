// Workflow: how her Claude Code setup works and where the day went. Replaces the reader while open; Esc goes back.
PastelTerm.workflow = (() => {
  const view = document.getElementById('workflow');
  const reader = document.getElementById('reader');
  const button = document.getElementById('workflow-button');
  const LABELS = ['next', 'done', 'why', 'watch', 'decide'];
  const TABS = [
    { id: 'today', name: 'Today', load: (o) => window.pastel.workflow.today(o.openTabs) },
    { id: 'setup', name: 'How my setup works', load: () => window.pastel.workflow.setup() },
    { id: 'time', name: 'Where my time goes', load: () => window.pastel.workflow.time() },
    { id: 'handoffs', name: 'Handoffs', load: () => window.pastel.workflow.handoffs() },
  ];
  let tab = 'today';
  let options = {};
  let cache = {}; // tab id -> data, cleared on every open
  let drawn = 0; // stale async renders check this before writing

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  view.innerHTML = `
    <div class="workflow-pane">
      <header class="workflow-head">
        <h1 class="workflow-title">Workflow</h1>
        <div id="workflow-tabs" class="view-toggle workflow-tabs" role="tablist" aria-label="Workflow sections"></div>
      </header>
      <div id="workflow-body" class="workflow-body"></div>
    </div>`;
  const tabsBar = view.querySelector('#workflow-tabs');
  const body = view.querySelector('#workflow-body');
  for (const t of TABS) {
    const b = el('button', '', t.name);
    b.type = 'button';
    b.dataset.tab = t.id;
    b.setAttribute('role', 'tab');
    tabsBar.append(b);
  }

  // ---- small pieces

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const statusClass = (status) => `wf-status wf-status-${String(status).replace(/\s+/g, '-')}`;
  const duration = (ms) => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))}m` : `${(ms / 3_600_000).toFixed(1)}h`);

  // Tag colours may be a label name ("next") or a hex; anything else gets a rotating label wash.
  function swatch(color, index) {
    if (LABELS.includes(color)) return `var(--${color}-pill)`;
    if (/^#[0-9a-f]{3,8}$/i.test(color ?? '')) return color;
    return `var(--${LABELS[index % LABELS.length]}-pill)`;
  }

  const summary = (text) => el('p', 'wf-summary', text);

  function card(title, count) {
    const box = el('section', 'wf-card');
    const head = el('h3', 'wf-card-title', title);
    if (count !== undefined) head.append(el('span', 'wf-count', String(count)));
    box.append(head);
    return box;
  }

  function emptyLine(text) {
    return el('p', 'wf-empty', text);
  }

  // Graphs render through Petal's themed Mermaid; a failure shows the source instead.
  async function graph(container, source, token) {
    try {
      // validate() also applies the live theme; renderSource() alone would draw in Mermaid's defaults.
      if (!(await PastelTerm.diagrams.validate(source))) throw new Error('the graph source did not parse');
      if (token !== drawn) return;
      await PastelTerm.diagrams.renderSource(container, source);
    } catch (error) {
      if (token !== drawn) return;
      const pre = el('pre');
      pre.append(el('code', '', source));
      container.replaceChildren(el('p', 'wf-error', `Couldn’t draw this graph: ${error?.message ?? error}`), pre);
    }
  }

  // ---- 1. Today

  function sessionRow(item) {
    const row = el('div', 'wf-row');
    const title = el('span', 'wf-row-title');
    title.append(el('span', 'wf-row-text', item.title));
    if (item.status) title.append(el('span', statusClass(item.status), item.status));
    if (item.busy) title.append(el('span', 'wf-badge wf-badge-busy', 'working'));
    else if (item.open) title.append(el('span', 'wf-badge', 'open'));
    else if (item.live) title.append(el('span', 'wf-badge', 'live'));
    row.append(title, el('span', 'wf-row-meta', timeOf(item.lastAt)));
    return row;
  }

  function renderToday(data) {
    const parts = ['in progress', 'blocked', 'done'].filter((s) => data.counts[s]).map((s) => `${data.counts[s]} ${s}`);
    const lead = data.total
      ? `${plural(data.total, 'session')} today${parts.length ? `: ${parts.join(', ')}` : ''}.`
      : 'No sessions yet today.';
    const untidied = data.counts.unlabeled ? ` ${data.counts.unlabeled} not tidied yet.` : '';
    const nodes = [summary(lead + untidied)];

    const chips = el('div', 'wf-chips');
    for (const status of ['in progress', 'blocked', 'done']) {
      chips.append(el('span', statusClass(status), `${status} · ${data.counts[status]}`));
    }
    chips.append(el('span', 'wf-status wf-status-unlabeled', `untidied · ${data.counts.unlabeled}`));
    nodes.push(chips);

    const grid = el('div', 'wf-grid');
    const main = el('div', 'wf-main');
    main.append(el('h2', 'wf-heading', data.groupedBy === 'tag' ? 'By tag' : 'By project'));
    data.groups.forEach((group, i) => {
      const box = card(group.name, group.items.length);
      const dot = el('span', 'wf-dot');
      dot.style.background = swatch(group.color, i);
      box.firstChild.prepend(dot);
      box.append(...group.items.map(sessionRow));
      main.append(box);
    });
    if (!data.groups.length) main.append(emptyLine('Sessions you start today will gather here.'));

    const aside = el('aside', 'wf-aside');
    const tabs = card('Open tabs', data.openTabs.length);
    for (const t of data.openTabs) {
      const row = el('div', 'wf-row');
      const title = el('span', 'wf-row-title');
      title.append(el('span', 'wf-row-text', t.title));
      if (t.busy) title.append(el('span', 'wf-badge wf-badge-busy', 'working'));
      row.append(title);
      tabs.append(row);
    }
    if (!data.openTabs.length) tabs.append(emptyLine('No Claude sessions open in Petal.'));
    const tidied = card('Recently tidied');
    for (const entry of data.recentlyTidied) {
      const row = el('div', 'wf-row');
      const title = el('span', 'wf-row-title');
      title.append(el('span', 'wf-row-text', entry.title));
      if (entry.status) title.append(el('span', statusClass(entry.status), entry.status));
      row.append(title, el('span', 'wf-row-meta', [entry.project, timeOf(Date.parse(entry.at))].filter(Boolean).join(' · ')));
      tidied.append(row);
    }
    if (!data.recentlyTidied.length) tidied.append(emptyLine('Nothing tidied yet. History’s “Tidy now” fills this in.'));
    aside.append(tabs, tidied);
    grid.append(main, aside);
    nodes.push(grid);
    return nodes;
  }

  // ---- 2. How my setup works

  // A <div> per term keeps name and description together in grid layouts.
  function definition(name, description, className = '') {
    const pair = el('div', 'wf-def');
    pair.append(el('dt', className, name), el('dd', 'wf-desc', description));
    return pair;
  }

  function renderSetup(data, token) {
    const nodes = [summary(`${plural(data.sections.length, 'rule section')} route requests to ${plural(data.routedSkills.length, 'skill')} and ${plural(data.agents.length, 'agent')}. Replies come out in ${data.style.name} style.`)];
    const figure = el('div', 'wf-graph');
    nodes.push(figure);
    graph(figure, data.mermaid, token);

    const routing = card('Routing: when this happens, use that', data.routing.length);
    const table = el('div', 'wf-routing');
    for (const route of data.routing) {
      const skills = el('span', 'wf-route-skills');
      for (const name of route.skills) skills.append(el('code', 'wf-skill-chip', name));
      table.append(el('span', 'wf-route-trigger', route.trigger), skills);
    }
    routing.append(table);

    const style = card('Output style');
    style.append(el('p', 'wf-style-name', data.style.name), el('p', 'wf-desc', data.style.description));
    const rules = card('CLAUDE.md sections', data.sections.length);
    const chips = el('div', 'wf-chips');
    for (const section of data.sections) chips.append(el('span', 'wf-tag', section));
    rules.append(chips);

    const skills = card('Skills', data.skills.length);
    const skillList = el('dl', 'wf-defs wf-defs-columns');
    for (const s of data.skills) skillList.append(definition(s.name, s.description, data.routedSkills.includes(s.name) ? 'wf-routed' : ''));
    skills.append(skillList);

    const agents = card('Agents', data.agents.length);
    const agentList = el('dl', 'wf-defs');
    let group;
    for (const a of data.agents) {
      if (a.group !== group && a.group) agentList.append(el('div', 'wf-subhead', `${a.group} pipeline`));
      group = a.group;
      agentList.append(definition(a.name, a.description));
    }
    agents.append(agentList);

    const grid = el('div', 'wf-grid');
    const main = el('div', 'wf-main');
    main.append(routing, skills);
    const aside = el('aside', 'wf-aside');
    aside.append(style, rules, agents);
    grid.append(main, aside);
    nodes.push(grid);
    return nodes;
  }

  // ---- 3. Where my time goes

  function renderTime(data) {
    const top = data.groups[0];
    const lead = data.sessions
      ? `${duration(data.totalMs)} of active time across ${plural(data.sessions, 'session')} this week.${top ? ` Most went to ${top.name} (${duration(top.activeMs)}).` : ''}`
      : 'No active time logged this week.';
    const nodes = [summary(lead)];

    const bars = card(data.groupedBy === 'tag' ? 'Per tag' : 'Per project', data.groups.length);
    const chart = el('div', 'wf-bars');
    const max = Math.max(1, ...data.groups.map((g) => g.activeMs));
    data.groups.forEach((g, i) => {
      const track = el('span', 'wf-bar-track');
      const fill = el('span', 'wf-bar-fill');
      fill.style.width = `${Math.max(1.5, (g.activeMs / max) * 100)}%`;
      fill.style.background = swatch(g.color, i);
      track.append(fill);
      chart.append(el('span', 'wf-bar-name', g.name), track, el('span', 'wf-bar-value', `${duration(g.activeMs)} · ${plural(g.sessions, 'session')}`));
    });
    bars.append(chart);
    if (!data.groups.length) bars.append(emptyLine('Nothing to chart yet.'));
    const note = `Active time adds up gaps under 15 minutes between messages, so breaks don’t count.${data.skipped ? ` ${plural(data.skipped, 'log')} over 200 MB skipped.` : ''}`;
    bars.append(el('p', 'wf-note', note));

    const recurring = card('Keeps coming back', data.recurring.length);
    for (const r of data.recurring) {
      const row = el('div', 'wf-row');
      const title = el('span', 'wf-row-title');
      title.append(el('span', 'wf-row-text', r.name), el('span', 'wf-badge', r.kind));
      row.append(title, el('span', 'wf-row-meta', `${r.days} days`));
      recurring.append(row);
    }
    if (!data.recurring.length) recurring.append(emptyLine('Nothing has shown up on 3 or more days this week.'));

    const grid = el('div', 'wf-grid');
    const main = el('div', 'wf-main');
    main.append(bars);
    const aside = el('aside', 'wf-aside');
    aside.append(recurring);
    grid.append(main, aside);
    nodes.push(grid);
    return nodes;
  }

  // ---- 4. Handoffs

  function renderHandoffs(data, token) {
    if (!data.total) {
      return [summary('No handoffs this week.'), emptyLine('Sending a session to Claude or resuming one from History adds a line here.')];
    }
    const kinds = ['send', 'resume', 'fork'].filter((k) => data.counts[k]).map((k) => plural(data.counts[k], k));
    const nodes = [summary(`${plural(data.total, 'handoff')} this week across ${plural(data.nodes, 'session')}: ${kinds.join(', ')}.`)];
    const legend = el('p', 'wf-note', 'Solid arrow: sent to read. Dotted: resumed. Thick: forked while still running elsewhere.');
    const figure = el('div', 'wf-graph');
    nodes.push(legend, figure);
    graph(figure, data.mermaid, token);
    return nodes;
  }

  const RENDER = { today: renderToday, setup: renderSetup, time: renderTime, handoffs: renderHandoffs };

  // ---- view plumbing

  async function show(id) {
    tab = id;
    const token = ++drawn;
    for (const b of tabsBar.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.tab === id));
    if (!cache[id]) body.replaceChildren(el('p', 'status', id === 'time' ? 'Adding up this week…' : 'Loading…'));
    let data;
    try {
      data = cache[id] ?? await TABS.find((t) => t.id === id).load(options);
    } catch (error) {
      data = { error: error?.message ?? String(error) };
    }
    if (token !== drawn) return; // she switched tabs while this loaded
    if (data?.error) {
      body.replaceChildren(el('p', 'wf-error', `Couldn’t load this section: ${data.error}`));
      return;
    }
    cache[id] = data;
    body.replaceChildren(...RENDER[id](data, token));
  }

  async function open(openOptions = {}) {
    options = openOptions;
    cache = {};
    if (PastelTerm.history?.isOpen()) PastelTerm.history.close(); // one overlay at a time
    view.hidden = false;
    reader.hidden = true;
    button?.setAttribute('aria-pressed', 'true');
    await show(tab);
    tabsBar.querySelector('[aria-selected="true"]')?.focus();
  }

  function close() {
    view.hidden = true;
    reader.hidden = false;
    button?.setAttribute('aria-pressed', 'false');
    window.dispatchEvent(new Event('petal:focus-terminal'));
  }

  const isOpen = () => !view.hidden;
  const toggle = () => (isOpen() ? close() : open());

  button?.addEventListener('click', () => toggle());
  // History opening on top would leave this view underneath, so step aside first.
  document.getElementById('history-button')?.addEventListener('click', () => { if (isOpen()) close(); }, true);
  tabsBar.addEventListener('click', (event) => { if (event.target.dataset.tab) show(event.target.dataset.tab); });
  view.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });

  return { open, close, isOpen, toggle };
})();
