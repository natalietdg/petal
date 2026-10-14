// Workflow › Factory: the stations Claude follows, as a left-to-right chart she edits in place.
// Every change saves through main, which regenerates the skill Claude reads (main/factory-store.ts).
import { el, isIpcError } from './dom';
import { RUNNERS, newStationId, runnerLabel, validateFactory, type Runner, type Station } from '../shared/factory';
import type { FactoryScope, FactoryState } from '../main/factory-store';

interface Editing {
  index: number; // where the station sits (or goes, when new)
  draft: Station;
  isNew: boolean;
  problem: string | null;
}

interface View {
  state: FactoryState;
  scope: FactoryScope;
  editing: Editing | null;
  confirmRemove: string | null; // station id
  confirmUseGlobal: boolean;
  note: { text: string; error: boolean } | null;
  focus: string | null; // selector to focus after the next draw
}

const SAVED = 'Saved. Claude follows this from your next message.';
const RUNNER_NAMES: Record<Runner, string> = { claude: 'Claude', subagent: 'A subagent', script: 'A script', you: 'You (approval gate)' };

const PATHS = {
  left: 'M14.5 6l-6 6 6 6',
  right: 'M9.5 6l6 6-6 6',
  add: 'M12 5v14M5 12h14',
  remove: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
  arrow: 'M4 12h15M14 7l5 5-5 5',
};
const icon = (name: keyof typeof PATHS): string => `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`;

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function iconButton(tool: keyof typeof PATHS, label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = button('fx-tool', '', onClick);
  b.innerHTML = icon(tool);
  b.dataset.tool = tool;
  b.setAttribute('aria-label', label);
  b.title = label;
  b.disabled = disabled;
  return b;
}

// The stations shown for the scope; null when its file is broken.
function stationsOf(view: View): Station[] | null {
  const { global, project } = view.state;
  if (view.scope === 'global') return global.factory?.stations ?? null;
  return project?.factory?.stations ?? global.factory?.stations ?? null;
}

// Editing needs Petal's own skill in the Claude folder; a project with no override shows the global one read-only.
const canEdit = (view: View): boolean =>
  !view.state.folderOff && view.state.skill.state !== 'foreign' && (view.scope === 'global' || Boolean(view.state.project?.factory));

function followsLine(state: FactoryState): string {
  switch (state.follows) {
    case 'project': return `Claude follows this project’s factory in ${state.project?.name ?? 'this repo'}.`;
    case 'global': return 'Claude follows the global factory.';
    case 'foreign': return `A factory skill you wrote already exists at ${state.skill.file}. Petal won’t overwrite it, so Claude follows yours.`;
    case 'none': return state.folderOff
      ? 'Petal isn’t reading your Claude folder, so Claude can’t pick up a factory. Allow it under Customize › Get started.'
      : 'Claude isn’t following a factory yet. Save once to hand it these stations.';
  }
}

export function renderFactory(state: FactoryState): HTMLElement[] {
  const root = el('div', 'fx');
  const view: View = { state, scope: state.project?.factory ? 'project' : 'global', editing: null, confirmRemove: null, confirmUseGlobal: false, note: null, focus: null };
  draw(root, view);
  return [root];
}

function draw(root: HTMLElement, view: View): void {
  root.replaceChildren(scopeSwitch(root, view), el('p', 'wf-summary fx-follows', followsLine(view.state)), ...scopeBody(root, view));
  if (view.editing) root.append(editor(root, view, view.editing));
  if (view.note) {
    const note = el('p', view.note.error ? 'wf-error fx-note' : 'fx-note fx-saved', view.note.text);
    note.setAttribute('role', 'status');
    root.append(note);
  }
  if (view.focus) root.querySelector<HTMLElement>(view.focus)?.focus();
  view.focus = null;
}

function scopeSwitch(root: HTMLElement, view: View): HTMLElement {
  const bar = el('div', 'view-toggle fx-scope');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Which factory');
  const project = view.state.project;
  const choices: [FactoryScope, string][] = [['global', 'Global'], ['project', project ? `This project (${project.name})` : 'This project']];
  for (const [scope, text] of choices) {
    const b = button('', text, () => {
      if (view.scope === scope) return;
      Object.assign(view, { scope, editing: null, confirmRemove: null, confirmUseGlobal: false, note: null, focus: `.fx-scope [data-scope="${scope}"]` });
      draw(root, view);
    });
    b.dataset.scope = scope;
    b.setAttribute('aria-pressed', String(view.scope === scope));
    if (scope === 'project' && !project) {
      b.disabled = true;
      b.title = 'Open a Claude session in a git repo to give it its own factory.';
    }
    bar.append(b);
  }
  return bar;
}

function scopeBody(root: HTMLElement, view: View): HTMLElement[] {
  const { global, project } = view.state;
  if (view.scope === 'global') {
    if (global.problem) return [el('p', 'wf-error', global.problem)];
    const nodes = [chart(root, view)];
    if (!global.saved && !view.state.folderOff) nodes.unshift(el('p', 'wf-note fx-defaults', 'These are the starting stations; nothing is saved yet.'));
    return nodes;
  }
  if (!project) return [el('p', 'wf-empty', 'Open a Claude session in a git repo to give that project its own factory.')];
  const actions = el('div', 'fx-actions');
  if (project.problem) {
    actions.append(useGlobalControl(root, view));
    return [el('p', 'wf-error', project.problem), actions];
  }
  if (!project.factory) {
    const copy = button('cz-quiet-button fx-customise', 'Customise for this project', () => {
      const stations = global.factory?.stations;
      if (stations) persist(root, view, stations, null);
    });
    copy.disabled = !global.factory || view.state.folderOff || view.state.skill.state === 'foreign';
    actions.append(el('span', 'wf-desc', `${project.name} follows the global factory.`), copy);
    return [actions, chart(root, view)];
  }
  actions.append(el('span', 'wf-desc', `Stations for ${project.name} only, saved in .petal/factory.json.`), useGlobalControl(root, view));
  return [actions, chart(root, view)];
}

function useGlobalControl(root: HTMLElement, view: View): HTMLElement {
  if (!view.confirmUseGlobal) {
    return button('cz-quiet-button fx-use-global', 'Use global', () => { view.confirmUseGlobal = true; view.focus = '.fx-confirm-yes'; draw(root, view); });
  }
  const box = el('span', 'fx-confirm');
  box.append(
    el('span', '', 'Delete this project’s factory and follow the global one?'),
    button('cz-quiet-button fx-confirm-yes', 'Delete', async () => {
      const repo = view.state.project?.repo;
      if (!repo) return;
      const result = await window.pastel.factory.useGlobal(repo);
      view.confirmUseGlobal = false;
      if (isIpcError(result)) view.note = { text: result.error, error: true };
      else Object.assign(view, { state: result, editing: null, note: { text: 'This project follows the global factory again, from your next message.', error: false } });
      draw(root, view);
    }),
    button('cz-quiet-button fx-confirm-no', 'Keep', () => { view.confirmUseGlobal = false; view.focus = '.fx-use-global'; draw(root, view); }),
  );
  return box;
}

// ---- the chart

function chart(root: HTMLElement, view: View): HTMLElement {
  const stations = stationsOf(view) ?? [];
  const editable = canEdit(view);
  const list = el('ol', `fx-chart${editable ? '' : ' fx-readonly'}`);
  list.setAttribute('aria-label', 'Factory stations, in order');
  stations.forEach((station, i) => {
    if (i) {
      const arrow = el('li', 'fx-arrow');
      arrow.setAttribute('aria-hidden', 'true');
      arrow.innerHTML = icon('arrow');
      list.append(arrow);
    }
    list.append(node(root, view, stations, i, editable));
  });
  return list;
}

function node(root: HTMLElement, view: View, stations: Station[], i: number, editable: boolean): HTMLLIElement {
  const station = stations[i];
  const item = el('li', 'fx-node');
  item.dataset.station = station.id;
  const card = el('button', 'fx-card');
  card.type = 'button';
  card.disabled = !editable;
  card.setAttribute('aria-label', `${i + 1}. ${station.name}, run by ${runnerLabel(station)}${editable ? '. Edit' : ''}`);
  const head = el('span', 'fx-card-head');
  head.append(el('span', 'fx-num', String(i + 1)), el('span', 'fx-name', station.name));
  const pass = el('span', 'fx-pass');
  pass.append(el('span', 'fx-pass-label', 'Pass check'), document.createTextNode(station.passCheck || 'None set.'));
  card.append(head, el('span', `fx-runner fx-runner-${station.runner}`, runnerLabel(station)), pass);
  card.addEventListener('click', () => {
    view.editing = { index: i, draft: { ...station }, isNew: false, problem: null };
    Object.assign(view, { confirmRemove: null, note: null, focus: '#fx-name' });
    draw(root, view);
  });
  item.append(card);
  if (!editable) return item;

  const move = (to: number, tool: 'left' | 'right') => {
    view.focus = `[data-station="${station.id}"] [data-tool="${to === 0 ? 'right' : to === stations.length - 1 ? 'left' : tool}"]`;
    persist(root, view, moved(stations, i, to), view.focus);
  };
  const tools = el('div', 'fx-tools');
  tools.append(
    iconButton('left', `Move ${station.name} left`, () => move(i - 1, 'left'), i === 0),
    iconButton('right', `Move ${station.name} right`, () => move(i + 1, 'right'), i === stations.length - 1),
    iconButton('add', `Add a station after ${station.name}`, () => {
      const draft: Station = { id: '', name: '', instructions: '', passCheck: '', runner: 'claude' };
      Object.assign(view, { editing: { index: i + 1, draft, isNew: true, problem: null }, confirmRemove: null, note: null, focus: '#fx-name' });
      draw(root, view);
    }),
    iconButton('remove', `Remove ${station.name}`, () => { view.confirmRemove = station.id; view.focus = '.fx-remove-yes'; draw(root, view); }, stations.length === 1),
  );
  item.append(tools);
  if (view.confirmRemove === station.id) {
    const confirm = el('div', 'fx-confirm');
    confirm.append(
      el('span', '', `Remove “${station.name}”?`),
      button('cz-quiet-button fx-remove-yes', 'Remove', () => persist(root, view, stations.filter((s) => s.id !== station.id), null)),
      button('cz-quiet-button fx-remove-no', 'Keep', () => { view.confirmRemove = null; view.focus = `[data-station="${station.id}"] [data-tool="remove"]`; draw(root, view); }),
    );
    item.append(confirm);
  }
  dragAndDrop(item, i, (from) => persist(root, view, moved(stations, from, i), null));
  return item;
}

function moved(stations: Station[], from: number, to: number): Station[] {
  const next = [...stations];
  const [station] = next.splice(from, 1);
  next.splice(to, 0, station);
  return next;
}

function dragAndDrop(item: HTMLLIElement, index: number, onDrop: (from: number) => void): void {
  item.draggable = true;
  item.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData('application/x-petal-station', String(index));
    item.classList.add('fx-dragging');
  });
  item.addEventListener('dragend', () => item.classList.remove('fx-dragging'));
  item.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes('application/x-petal-station')) return;
    event.preventDefault();
    item.classList.add('fx-drop');
  });
  item.addEventListener('dragleave', () => item.classList.remove('fx-drop'));
  item.addEventListener('drop', (event) => {
    event.preventDefault();
    item.classList.remove('fx-drop');
    const from = Number(event.dataTransfer?.getData('application/x-petal-station'));
    if (Number.isInteger(from) && from !== index) onDrop(from);
  });
}

// ---- the edit panel

function field(label: string, control: HTMLElement, hint?: string): HTMLLabelElement {
  const box = el('label', 'fx-field');
  box.append(el('span', 'fx-label', label), control);
  if (hint) box.append(el('span', 'fx-hint', hint));
  return box;
}

function editor(root: HTMLElement, view: View, editing: Editing): HTMLElement {
  const stations = stationsOf(view) ?? [];
  const { draft } = editing;
  const panel = el('section', 'wf-card fx-editor');
  panel.setAttribute('aria-label', 'Edit station');
  const after = stations[editing.index - 1];
  panel.append(el('h3', 'wf-card-title', editing.isNew ? `New station${after ? ` after ${after.name}` : ''}` : `Station ${editing.index + 1}: ${draft.name}`));

  const name = el('input', 'fx-input');
  name.id = 'fx-name';
  name.value = draft.name;
  name.addEventListener('input', () => { draft.name = name.value; });
  const instructions = el('textarea', 'fx-input fx-textarea');
  instructions.id = 'fx-instructions';
  instructions.rows = 5;
  instructions.value = draft.instructions;
  instructions.addEventListener('input', () => { draft.instructions = instructions.value; });
  const passCheck = el('textarea', 'fx-input fx-textarea');
  passCheck.id = 'fx-pass';
  passCheck.rows = 2;
  passCheck.value = draft.passCheck;
  passCheck.addEventListener('input', () => { draft.passCheck = passCheck.value; });

  const runner = el('select', 'fx-input fx-select');
  runner.id = 'fx-runner';
  for (const r of RUNNERS) {
    const option = el('option', '', RUNNER_NAMES[r]);
    option.value = r;
    runner.append(option);
  }
  runner.value = draft.runner;
  const agentType = el('input', 'fx-input');
  agentType.id = 'fx-agent';
  agentType.value = draft.agentType ?? '';
  agentType.placeholder = 'general-purpose';
  agentType.addEventListener('input', () => { draft.agentType = agentType.value; });
  const command = el('input', 'fx-input fx-command');
  command.id = 'fx-command';
  command.value = draft.command ?? '';
  command.placeholder = 'npm test';
  command.addEventListener('input', () => { draft.command = command.value; });
  const agentField = field('Agent type', agentType, 'The subagent Claude hands this station to.');
  const commandField = field('Command', command, 'Claude runs this and reads the result. Petal never runs it.');
  const showExtra = () => {
    agentField.hidden = draft.runner !== 'subagent';
    commandField.hidden = draft.runner !== 'script';
  };
  runner.addEventListener('change', () => { draft.runner = runner.value as Runner; showExtra(); });
  showExtra();

  const problem = el('p', 'wf-error fx-problem', editing.problem ?? '');
  problem.hidden = !editing.problem;
  const actions = el('div', 'fx-actions');
  actions.append(
    button('cz-quiet-button fx-save', 'Save', () => {
      const station: Station = { ...draft, id: editing.isNew ? newStationId(draft.name, stations.map((s) => s.id)) : draft.id };
      if (station.runner !== 'subagent') delete station.agentType;
      if (station.runner !== 'script') delete station.command;
      const next = [...stations];
      next.splice(editing.index, editing.isNew ? 0 : 1, station);
      const checked = validateFactory({ version: 1, stations: next });
      if (!checked.ok) {
        problem.textContent = checked.problem;
        problem.hidden = false;
        return;
      }
      persist(root, view, checked.factory.stations, `[data-station="${station.id}"] .fx-card`);
    }),
    button('cz-quiet-button fx-cancel', 'Cancel', () => {
      const back = editing.isNew ? stations[editing.index - 1]?.id : draft.id;
      view.editing = null;
      view.focus = back ? `[data-station="${back}"] .fx-card` : null;
      draw(root, view);
    }),
  );
  panel.append(
    field('Name', name),
    field('Instructions', instructions, 'What Claude does at this station.'),
    field('Pass check', passCheck, 'What has to hold before the next station starts.'),
    field('Who runs it', runner),
    agentField,
    commandField,
    problem,
    actions,
  );
  return panel;
}

// Saves the whole list for the current scope and redraws from what main wrote back.
async function persist(root: HTMLElement, view: View, stations: Station[], focus: string | null): Promise<void> {
  const repo = view.scope === 'project' ? view.state.project?.repo ?? null : null;
  const result = await window.pastel.factory.save({ scope: view.scope, repo, factory: { version: 1, stations } });
  if (isIpcError(result)) {
    if (view.editing) view.editing.problem = result.error;
    else view.note = { text: result.error, error: true };
  } else {
    Object.assign(view, { state: result, editing: null, confirmRemove: null, note: { text: SAVED, error: false }, focus });
  }
  draw(root, view);
}
