// The reply box's To line: who a message with @session mentions goes to, and whether this session gets it too.
import { el } from './dom';
import { SESSION_PREFIX, deliverySummary, parseMentions, planMentions, type Delivery, type MentionPlan, type MentionTarget } from '../shared/mentions';

const RESULT_MS = 8000;

export interface MentionBar {
  plan: (text: string) => MentionPlan | null;
  refresh: () => void;
  showResult: (deliveries: readonly Delivery[], unknown: readonly string[]) => void;
  note: (text: string) => void;
}

export function create(form: HTMLFormElement, input: HTMLTextAreaElement, targets: () => MentionTarget[]): MentionBar {
  const bar = el('div');
  bar.id = 'composer-to';
  bar.hidden = true;
  const toRow = el('div', 'composer-to-row');
  const chips = el('span', 'composer-to-chips');
  const here = el('label', 'composer-to-here');
  const box = el('input');
  box.type = 'checkbox';
  box.id = 'composer-to-here';
  here.append(box, ' Also send to this session');
  toRow.append(el('span', 'composer-to-label', 'To:'), chips, here);
  const result = el('p', 'composer-to-result');
  result.setAttribute('role', 'status');
  bar.append(toRow, result);
  form.prepend(bar);
  let resultTimer: ReturnType<typeof setTimeout> | undefined;

  const removeMention = (slug: string): void => {
    const token = new RegExp(`(^|\\s)${SESSION_PREFIX}${slug}(?=\\s|$)\\s?`, 'gi');
    input.value = input.value.replace(token, '$1');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  };

  const chip = (target: MentionTarget | null, slug: string): HTMLElement => {
    const off = !target || !target.running;
    const item = el('span', `mention-chip${off ? ' off' : ''}`);
    item.dataset.slug = slug;
    item.append(el('span', 'mention-chip-name', target?.name ?? `${SESSION_PREFIX}${slug}`));
    if (off) item.append(el('span', 'mention-chip-state', target ? 'not running' : 'not open'));
    const remove = el('button', 'mention-chip-remove', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Don’t send to ${target?.name ?? slug}`);
    remove.addEventListener('mousedown', (event) => event.preventDefault());
    remove.addEventListener('click', () => removeMention(slug));
    item.append(remove);
    return item;
  };

  function refresh(): void {
    const parsed = parseMentions(input.value, targets());
    const mentioned = parsed.targets.length + parsed.unknown.length > 0;
    chips.replaceChildren(...parsed.targets.map((t) => chip(t, t.slug)), ...parsed.unknown.map((slug) => chip(null, slug)));
    toRow.hidden = !mentioned;
    if (!mentioned) box.checked = false;
    bar.hidden = toRow.hidden && result.hidden;
  }

  function note(text: string): void {
    clearTimeout(resultTimer);
    result.textContent = text;
    result.hidden = !text;
    bar.hidden = toRow.hidden && result.hidden;
    if (text) resultTimer = setTimeout(() => note(''), RESULT_MS);
  }

  input.addEventListener('input', () => { if (!result.hidden) note(''); refresh(); }); // typing again clears the last send's line
  result.hidden = true;
  refresh();

  return {
    plan: (text) => planMentions(text, targets(), box.checked),
    refresh,
    showResult: (deliveries, unknown) => note(deliverySummary(deliveries, unknown)),
    note,
  };
}
