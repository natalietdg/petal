// Customize sections for the agents' prompts: Organizer (schedule + prompt), Flow titles, and the read-only Handoff.
import { el, isIpcError } from './dom';
import { timeOf } from './format';
import { actionButton, card, field, keepConfig, note, numberInput, page, save } from './customize-kit';
import type { OrganizerStatus } from '../main/session-organizer';

type PromptSection = 'organizer' | 'flowTitles';
const INTERVAL_MINUTES = { min: 1, max: 240 };
const PER_PASS = { min: 1, max: 50 };
const PROMPT_ROWS = 8;

// ---- A prompt editor shared by the organizer and flow titles.
function promptEditor({ section: key, label, contract }: { section: PromptSection; label: string; contract: string }): HTMLDivElement {
  const box = el('textarea', 'cz-textarea');
  box.value = page.state.config[key].prompt;
  box.rows = PROMPT_ROWS;
  box.spellcheck = false;
  box.setAttribute('aria-label', label);
  const status = el('span', 'cz-status');
  const saveButton = actionButton('Save prompt', async () => {
    await save({ [key]: { prompt: box.value } });
    box.value = page.state.config[key].prompt; // an empty box falls back to the default
    status.textContent = 'Saved. Used from the next run.';
  });
  const reset = actionButton('Reset to default', async () => {
    keepConfig(await window.pastel.config.reset(`${key}.prompt`), 'reset the prompt');
    box.value = page.state.config[key].prompt;
    status.textContent = 'Back to the default prompt.';
  }, 'cz-quiet-button');
  box.addEventListener('input', () => {
    status.textContent = box.value === page.state.config[key].prompt ? '' : 'Unsaved changes';
  });
  const actions = el('div', 'cz-actions');
  actions.append(saveButton, reset, status);
  return card(label, box, actions, note(contract));
}

function lastPassText(organizer: OrganizerStatus | null): string {
  if (organizer?.running) return 'A pass is running now.';
  const last = organizer?.lastPass;
  if (!last) return 'No pass yet since Petal opened.';
  if (last.skipped) return `Last pass ${timeOf(last.at, true)}: skipped (${last.skipped}).`;
  return `Last pass ${timeOf(last.at, true)} · ${last.titled} titled · ${last.failed} failed · ${last.due} due`;
}

const MODEL_LABELS: Record<string, string> = { haiku: 'Haiku', sonnet: 'Sonnet', organizer: 'Same as organizer' };
const calls = (n: number): string => `Background work used ${n} call${n === 1 ? '' : 's'} today`;

// The session-end switches (Library, lessons) and the model their runs use; both run in one headless call when both are on.
function libraryCard(): HTMLDivElement {
  const checkbox = (checked: boolean, onChange: (on: boolean) => unknown): HTMLInputElement => {
    const box = el('input');
    Object.assign(box, { type: 'checkbox', checked });
    box.addEventListener('change', () => onChange(box.checked));
    return box;
  };
  const config = page.state.config;
  const model = el('select', 'cz-input');
  model.id = 'cz-background-model';
  for (const id of page.state.backgroundModels) {
    const label = id === 'organizer' ? `${MODEL_LABELS[id]} (${config.organizer.model})` : MODEL_LABELS[id] ?? id;
    model.append(Object.assign(el('option', null, label), { value: id, selected: id === config.background.model }));
  }
  model.addEventListener('change', () => save({ background: { model: model.value } }));
  const fields = el('div', 'cz-fields');
  fields.append(
    field('Build my Library from sessions · uses your Claude plan', checkbox(config.library.autoBuild, (on) => save({ library: { autoBuild: on } })),
      'When a session ends, Claude reads what was new in it and adds domain knowledge (how systems, rules and terms work) to the Library. Off unless you turn it on.'),
    field('Learn lessons from sessions · uses your Claude plan', checkbox(config.lessons.learn, (on) => save({ lessons: { learn: on } })),
      'When a session ends, Claude notes how to work with you: your corrections, its mistakes, approaches you approved. They wait in Library › Lessons; nothing goes into a CLAUDE.md until you add it.'),
    field('Model for background work', model, 'Library and lessons runs. Haiku is fastest and cheapest.'),
  );
  return card('Library and lessons', fields, note(calls(page.state.backgroundCalls), 'cz-status cz-background-calls'));
}

export function renderOrganizer(): HTMLElement[] {
  const o = page.state.config.organizer;
  const enabled = el('input');
  Object.assign(enabled, { type: 'checkbox', checked: o.enabled });
  enabled.addEventListener('change', () => save({ organizer: { enabled: enabled.checked } }));

  const model = el('select', 'cz-input');
  for (const id of page.state.models) model.append(Object.assign(el('option', null, id), { value: id, selected: id === o.model }));
  model.addEventListener('change', () => save({ organizer: { model: model.value } }));

  const last = note(lastPassText(page.state.organizer), 'cz-status cz-last-pass');
  const tidy = actionButton('Tidy now', async () => {
    tidy.disabled = true;
    last.textContent = 'Tidying…';
    const result = await window.pastel.history.tidy();
    const organizer = await window.pastel.config.organizer();
    if (!isIpcError(organizer)) page.state.organizer = organizer;
    last.textContent = isIpcError(result) ? `Tidy failed: ${result.error}` : lastPassText(page.state.organizer);
    tidy.disabled = false;
  });
  const actions = el('div', 'cz-actions');
  actions.append(tidy, last);

  const settings = el('div', 'cz-fields');
  settings.append(
    field('Name and tidy sessions with Claude · uses your Claude plan', enabled, 'Off unless you turn it on. Tidy now works either way.'),
    field('Every', numberInput(o.intervalMinutes, INTERVAL_MINUTES.min, INTERVAL_MINUTES.max, async (n) => (await save({ organizer: { intervalMinutes: n } })).organizer.intervalMinutes), 'minutes, 1–240'),
    field('Sessions per pass', numberInput(o.perPass, PER_PASS.min, PER_PASS.max, async (n) => (await save({ organizer: { perPass: n } })).organizer.perPass), '1–50, one Claude call each'),
    field('Model', model, 'haiku is fastest and cheapest'),
  );
  return [
    card('Schedule', settings, actions),
    libraryCard(),
    promptEditor({
      section: 'organizer',
      label: 'Organizer prompt',
      contract: 'Petal adds the JSON answer format, your existing projects and tags, the folder and the session digest after this text, so editing it can’t break parsing.',
    }),
  ];
}

export function renderFlowTitles(): HTMLElement[] {
  return [promptEditor({
    section: 'flowTitles',
    label: 'Flow titles prompt',
    contract: 'Petal adds the JSON answer format and the steps after this text. Runs once per flow, on Haiku; on failure the flow falls back to the audit log.',
  })];
}

export function renderHandoff(): HTMLElement[] {
  const steps = el('ol', 'cz-steps');
  for (const text of [
    'Writes the past session’s prompts and replies, without tool noise, to <Petal data>/handoffs/<session id>.md.',
    'Keeps the newest turns up to 120 KB; the header says how many were left out.',
    'Copies the file path to the clipboard.',
    'Types “Read "<file>", my earlier session "<title>" (<n> turns).” into this tab for you to finish and send.',
  ]) steps.append(el('li', null, text));
  const sample = el('pre', 'cz-pre');
  sample.append(el('code', null, page.state.handoffSample));
  return [card('What Send to Claude does', steps), card('Sample file', sample), note('This format is fixed and can’t be edited here.')];
}
