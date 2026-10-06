// Customize: every setting in one place. Replaces the reader while open; Esc or Cmd+, goes back.
PastelTerm.customize = (() => {
  const view = document.getElementById('customize');
  const reader = document.getElementById('reader');
  const button = document.getElementById('customize-button');

  const SECTIONS = [
    { id: 'look', name: 'Look', summary: 'Theme, reading style, pet and scene. Changes apply at once and tick the same menu items.' },
    { id: 'formatting', name: 'Formatting', summary: 'How each markdown shape in a reply is drawn in each reading style.' },
    { id: 'organizer', name: 'Organizer', summary: 'The background agent that titles, files and tags your recent sessions for History.' },
    { id: 'flowTitles', name: 'Flow titles', summary: 'The prompt that turns each step of a session into the state changes on the Flow view.' },
    { id: 'handoff', name: 'Handoff', summary: 'What Send to Claude writes when one session hands its history to another.' },
    { id: 'hook', name: 'Response hook', summary: 'A shell command of yours that runs each time Claude finishes a reply.' },
  ];

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const actionButton = (label, onClick, className = 'flow-button') => {
    const b = el('button', className, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  view.innerHTML = `
    <div class="customize-pane">
      <div class="customize-head">
        <h1 class="customize-title">Customize</h1>
        <div id="customize-tabs" class="view-toggle customize-tabs" role="tablist" aria-label="Customize sections"></div>
      </div>
      <p id="customize-summary" class="cz-summary"></p>
      <div id="customize-body" class="customize-body"></div>
    </div>`;
  const tabsBar = view.querySelector('#customize-tabs');
  const summary = view.querySelector('#customize-summary');
  const body = view.querySelector('#customize-body');
  for (const s of SECTIONS) {
    const b = el('button', null, s.name);
    b.type = 'button';
    b.dataset.section = s.id;
    b.setAttribute('role', 'tab');
    tabsBar.append(b);
  }

  let section = 'look';
  let state = null; // the config:get payload

  const card = (title, ...children) => {
    const box = el('div', 'cz-card');
    if (title) box.append(el('h2', 'cz-card-title', title));
    box.append(...children);
    return box;
  };
  const field = (label, control, hint) => {
    const row = el('label', 'cz-field');
    row.append(el('span', 'cz-label', label), control);
    if (hint) row.append(el('span', 'cz-hint', hint));
    return row;
  };
  const note = (text, className = 'cz-note') => el('p', className, text);

  async function save(patch) {
    state.config = await window.pastel.config.save(patch);
    return state.config;
  }

  // ---- Look: chips that call the same apply* functions as the menus.
  function chipGroup(label, choices, current, onPick) {
    const group = el('div', 'cz-chips');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', label);
    for (const [id, name] of choices) {
      const chip = actionButton(name, () => {
        for (const c of group.children) c.setAttribute('aria-checked', String(c === chip));
        onPick(id);
      }, 'cz-chip');
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-checked', String(id === current));
      group.append(chip);
    }
    return card(label, group);
  }

  function renderLook() {
    const { choices, look } = state;
    const { look: set } = window.pastel;
    return [
      chipGroup('Theme', choices.themes, look.theme, (id) => { look.theme = id; set.setTheme(id); }),
      chipGroup('Reading style', choices.reading, look.reading, (id) => { look.reading = id; set.setReading(id); }),
      chipGroup('Pet', choices.cats, look.cat, (id) => { look.cat = id; set.setCat(id); }),
      chipGroup('Scene', choices.scenes, look.scene, (id) => { look.scene = id; set.setScene(id); }),
      note('Also in the menus: Theme (⌘1–3), View for reading style (⇧⌘1–3), Pet and Pet › Scene.'),
    ];
  }

  // ---- Formatting: markdown shape -> what each reading style does with it (from reader.css + magazine.css).
  const SHAPES = [
    ['Headline', '**Bold first line**', 'Large serif headline', 'Big light serif, centred', 'Oversized grotesk in a colour-block hero'],
    ['Dek', 'Paragraph right after the headline', 'Larger standfirst with a rule under it', 'Italic, centred, “By Claude” byline', 'Inside the hero, a size up'],
    ['Lede', 'First body paragraph, 160+ characters', 'Drop cap', 'Two-line sunk drop cap in the link colour', 'Bold first letter, slightly larger'],
    ['Sections', '## Short title', 'Serif head with a rule above', '“Part I” opener over an italic head', 'Each section its own colour card'],
    ['Sidebar', '> **Title** then a list', 'Ruled box, small-caps title', 'Ruled box; margin rail on wide windows', 'Tinted rounded box'],
    ['Pull quote', '> One sentence', 'Large serif line', 'Italic under a coloured rule; margin rail when wide', 'Bold accent colour with a side bar'],
    ['Callouts', '**Watch out:** / **Decide:**', 'Watch: pill and thin rule. Decide: tinted box, thick bar', 'Same as Newspaper', 'Same; Decide sits on page colour inside a card'],
    ['Tables', 'GFM table + *italic caption*', 'Horizontal rules only, bold first column', 'Same as Newspaper', 'Tinted rounded panel, washed header row'],
    ['Code', 'Fenced block', 'Code-colour block, long lines wrap', 'Same as Newspaper', 'Same as Newspaper'],
    ['Highlight', '==phrase==', 'Highlighter mark', 'Highlighter mark', 'Highlighter mark'],
    ['Sources', '## Sources (or References, Limitations)', 'Small, quiet back matter', 'Same as Newspaper', 'Same, never a card'],
  ];

  const PREVIEW = `**The organizer now reads its prompt from Customize.**

Edits apply on the next pass, and the ==JSON format stays fixed in code== so a custom prompt can never break parsing.

Petal used to keep the organizer prompt inside the source, so changing its tone meant editing code and rebuilding the app. Now the instructions live in config.json and the answer format is appended after them.

## What changed

The prompt moved; the parser did not.

> **At a glance**
> - Interval 1–240 minutes
> - Up to 50 sessions a pass

> A custom prompt can't break the parser.

**Watch out:** a much longer prompt costs a little more per session.

| Setting | Default |
|---|---|
| Model | haiku |
| Per pass | 12 |

\`\`\`
organizer.prompt + JSON contract + existing tags
\`\`\`

## Sources

- \`src/main/session-organizer.js\``;

  function renderFormatting() {
    const readingName = Object.fromEntries(state.choices.reading)[state.look.reading] ?? state.look.reading;
    const table = el('table', 'cz-table');
    table.innerHTML = '<thead><tr><th>Shape</th><th>Write it as</th><th>Newspaper</th><th>Editorial</th><th>Lifestyle</th></tr></thead>';
    const tbody = el('tbody');
    for (const [shape, markdown, ...looks] of SHAPES) {
      const row = el('tr');
      row.append(el('td', 'cz-shape', shape));
      const md = el('td');
      md.append(el('code', null, markdown));
      row.append(md, ...looks.map((text, i) => {
        const cell = el('td', null, text);
        if (state.choices.reading[i]?.[0] === state.look.reading) cell.classList.add('cz-current');
        return cell;
      }));
      tbody.append(row);
    }
    table.append(tbody);

    const style = el('p', 'cz-note');
    style.append('Claude Code output style: ', el('strong', null, state.outputStyle ?? 'default'), ' (from ~/.claude/settings.json, read-only). ');
    if (state.magazinePath) style.append('Magazine guide: ', el('code', null, state.magazinePath), '.');
    else style.append('No magazine.md found in ~/.claude/output-styles.');

    const column = el('div', 'reader-column cz-preview');
    column.append(PastelTerm.markdown.render(PREVIEW));
    return [
      card('Shapes and treatments', table, style),
      card(`Live preview · ${readingName}`, note('Switch the reading style under Look to see this change.'), column),
    ];
  }

  // ---- A prompt editor shared by the organizer and flow titles.
  function promptEditor({ section: key, label, contract }) {
    const box = el('textarea', 'cz-textarea');
    box.value = state.config[key].prompt;
    box.rows = 8;
    box.spellcheck = false;
    box.setAttribute('aria-label', label);
    const status = el('span', 'cz-status');
    const saveButton = actionButton('Save prompt', async () => {
      await save({ [key]: { prompt: box.value } });
      box.value = state.config[key].prompt; // an empty box falls back to the default
      status.textContent = 'Saved. Used from the next run.';
    });
    const reset = actionButton('Reset to default', async () => {
      state.config = await window.pastel.config.reset(`${key}.prompt`);
      box.value = state.config[key].prompt;
      status.textContent = 'Back to the default prompt.';
    }, 'cz-quiet-button');
    box.addEventListener('input', () => {
      status.textContent = box.value === state.config[key].prompt ? '' : 'Unsaved changes';
    });
    const actions = el('div', 'cz-actions');
    actions.append(saveButton, reset, status);
    return card(label, box, actions, note(contract));
  }

  function numberInput(value, min, max, onSave) {
    const input = el('input', 'cz-input cz-number');
    Object.assign(input, { type: 'number', min, max, step: 1, value });
    input.addEventListener('change', async () => { input.value = await onSave(Number(input.value)); });
    return input;
  }

  function lastPassText(organizer) {
    if (organizer?.running) return 'A pass is running now.';
    const last = organizer?.lastPass;
    if (!last) return 'No pass yet since Petal opened.';
    if (last.skipped) return `Last pass ${timeOf(last.at)}: skipped (${last.skipped}).`;
    return `Last pass ${timeOf(last.at)} · ${last.titled} titled · ${last.failed} failed · ${last.due} due`;
  }

  function renderOrganizer() {
    const o = state.config.organizer;
    const enabled = el('input');
    Object.assign(enabled, { type: 'checkbox', checked: o.enabled });
    enabled.addEventListener('change', () => save({ organizer: { enabled: enabled.checked } }));

    const model = el('select', 'cz-input');
    for (const id of state.models) model.append(Object.assign(el('option', null, id), { value: id, selected: id === o.model }));
    model.addEventListener('change', () => save({ organizer: { model: model.value } }));

    const last = note(lastPassText(state.organizer), 'cz-status cz-last-pass');
    const tidy = actionButton('Tidy now', async () => {
      tidy.disabled = true;
      last.textContent = 'Tidying…';
      const result = await window.pastel.history.tidy();
      state.organizer = await window.pastel.config.organizer();
      last.textContent = result?.error ? `Tidy failed: ${result.error}` : lastPassText(state.organizer);
      tidy.disabled = false;
    });
    const actions = el('div', 'cz-actions');
    actions.append(tidy, last);

    const settings = el('div', 'cz-fields');
    settings.append(
      field('Run in the background', enabled, 'Tidy now works either way.'),
      field('Every', numberInput(o.intervalMinutes, 1, 240, async (n) => (await save({ organizer: { intervalMinutes: n } })).organizer.intervalMinutes), 'minutes, 1–240'),
      field('Sessions per pass', numberInput(o.perPass, 1, 50, async (n) => (await save({ organizer: { perPass: n } })).organizer.perPass), '1–50, one Claude call each'),
      field('Model', model, 'haiku is fastest and cheapest'),
    );
    return [
      card('Schedule', settings, actions),
      promptEditor({
        section: 'organizer',
        label: 'Organizer prompt',
        contract: 'Petal adds the JSON answer format, your existing projects and tags, the folder and the session digest after this text, so editing it can’t break parsing.',
      }),
    ];
  }

  function renderFlowTitles() {
    return [promptEditor({
      section: 'flowTitles',
      label: 'Flow titles prompt',
      contract: 'Petal adds the JSON answer format and the steps after this text. Runs once per flow, on Haiku; on failure the flow falls back to the audit log.',
    })];
  }

  function renderHandoff() {
    const steps = el('ol', 'cz-steps');
    for (const text of [
      'Writes the past session’s prompts and replies, without tool noise, to <Petal data>/handoffs/<session id>.md.',
      'Keeps the newest turns up to 120 KB; the header says how many were left out.',
      'Copies the file path to the clipboard.',
      'Types “Read "<file>", my earlier session "<title>" (<n> turns).” into this tab for you to finish and send.',
    ]) steps.append(el('li', null, text));
    const sample = el('pre', 'cz-pre');
    sample.append(el('code', null, state.handoffSample));
    return [card('What Send to Claude does', steps), card('Sample file', sample), note('Read-only: the format lives in src/main/handoff.js.')];
  }

  // ---- Response hook.
  function runsList(runs) {
    const list = el('div', 'cz-runs');
    if (!runs.length) list.append(note('No runs yet since Petal opened.', 'cz-empty'));
    for (const run of runs) {
      const row = el('div', 'cz-run');
      const ok = run.exitCode === 0;
      const badge = el('span', `cz-badge ${ok ? 'cz-ok' : 'cz-fail'}`, run.timedOut ? 'timeout' : `exit ${run.exitCode ?? '–'}`);
      row.append(badge, el('span', 'cz-run-time', timeOf(run.at)), el('span', 'cz-run-title', `${run.test ? 'Test · ' : ''}${run.title ?? ''}`));
      if (run.stderr) row.append(el('code', 'cz-run-err', run.stderr));
      list.append(row);
    }
    return list;
  }

  function renderHook() {
    const h = state.config.responseHook;
    const command = el('input', 'cz-input cz-command');
    Object.assign(command, { type: 'text', value: h.command, placeholder: 'cat >> ~/petal-replies.md', spellcheck: false });
    const notify = el('input');
    Object.assign(notify, { type: 'checkbox', checked: h.notify });
    const status = el('span', 'cz-status');
    const runs = el('div');
    runs.append(runsList(state.hookRuns));

    command.addEventListener('change', async () => {
      await save({ responseHook: { command: command.value } });
      status.textContent = state.config.responseHook.command ? 'Saved. Runs after the next reply.' : 'Hook off.';
    });
    notify.addEventListener('change', () => save({ responseHook: { notify: notify.checked } }));
    const test = actionButton('Test hook', async () => {
      await save({ responseHook: { command: command.value } });
      test.disabled = true;
      status.textContent = 'Running…';
      const result = await window.pastel.config.testHook();
      status.textContent = result.skipped ? `Not run: ${result.skipped}.` : `Exit ${result.exitCode ?? '–'}${result.timedOut ? ' (timed out)' : ''} in ${result.ms} ms.`;
      runs.replaceChildren(runsList(await window.pastel.config.hookRuns()));
      test.disabled = false;
    });

    const fields = el('div', 'cz-fields');
    fields.append(field('Command', command, 'Runs in your login shell, in the session’s folder. Empty turns it off.'), field('Notify me', notify, 'A notification with the session title and first line of the reply.'));
    const actions = el('div', 'cz-actions');
    actions.append(test, status);

    const how = el('ul', 'cz-list');
    for (const text of [
      'Runs once per finished reply (when Claude goes from busy to idle), in any tab.',
      'stdin is the reply markdown. Env: PETAL_SESSION_ID, PETAL_SESSION_TITLE, PETAL_CWD, PETAL_REPLY_FILE.',
      `Stopped after 30 s. Never runs during snapshot test runs. Reply files: ${state.hookDir}.`,
    ]) how.append(el('li', null, text));
    const examples = el('div', 'cz-examples');
    for (const example of ['cat >> ~/petal-replies.md', 'curl -s -X POST --data-binary @- https://example.com/hook']) {
      const use = actionButton(example, () => { command.value = example; command.focus(); }, 'cz-example');
      use.title = 'Use this command';
      examples.append(use);
    }
    return [card('Command', fields, actions), card('How it runs', how, el('p', 'cz-label', 'Examples (click to use)'), examples), card('Recent runs', runs)];
  }

  const RENDER = { look: renderLook, formatting: renderFormatting, organizer: renderOrganizer, flowTitles: renderFlowTitles, handoff: renderHandoff, hook: renderHook };

  async function show(id = section) {
    section = id;
    for (const b of tabsBar.children) b.setAttribute('aria-selected', String(b.dataset.section === id));
    summary.textContent = SECTIONS.find((s) => s.id === id).summary;
    try {
      state = await window.pastel.config.get();
      body.replaceChildren(...RENDER[id]());
    } catch (error) {
      body.replaceChildren(el('p', 'wf-error', `Couldn’t load settings: ${error?.message ?? error}`));
    }
  }

  async function open(id) {
    if (PastelTerm.history?.isOpen()) PastelTerm.history.close(); // one overlay at a time
    if (PastelTerm.workflow?.isOpen()) PastelTerm.workflow.close();
    view.hidden = false;
    reader.hidden = true;
    button?.setAttribute('aria-pressed', 'true');
    await show(id ?? section);
    tabsBar.querySelector('[aria-selected="true"]')?.focus();
  }

  function close() {
    view.hidden = true;
    // History or Workflow may have opened on top; leave the reader hidden for them.
    reader.hidden = Boolean(PastelTerm.history?.isOpen() || PastelTerm.workflow?.isOpen());
    button?.setAttribute('aria-pressed', 'false');
    window.dispatchEvent(new Event('petal:focus-terminal'));
  }

  const isOpen = () => !view.hidden;
  const toggle = () => (isOpen() ? close() : open());

  button?.addEventListener('click', () => toggle());
  // Another overlay opening on top would leave this one underneath, so step aside first.
  for (const id of ['history-button', 'workflow-button']) {
    document.getElementById(id)?.addEventListener('click', () => { if (isOpen()) close(); }, true);
  }
  window.pastel.onToggleHistory(() => { if (isOpen()) close(); });
  window.pastel.onOpenCustomize(() => (isOpen() ? close() : open()));
  tabsBar.addEventListener('click', (event) => { if (event.target.dataset.section) show(event.target.dataset.section); });
  // Esc inside a prompt box stays there, so a half-edited prompt isn't lost by accident.
  view.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !event.target.matches('textarea')) close(); });
  // A menu change while Look or Formatting is open redraws the ticks and the preview.
  const redraw = () => { if (isOpen() && (section === 'look' || section === 'formatting')) show(); };
  for (const subscribe of ['onTheme', 'onReading', 'onCat', 'onScene']) window.pastel[subscribe](redraw);

  return { open, close, isOpen, toggle, show };
})();
