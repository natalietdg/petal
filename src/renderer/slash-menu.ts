// The "/" menu for a reply box: skills, commands, agents and Claude Code's own commands, filtered as she types.
// One popup serves every box (the reader's and History's); it only fills the box, Send still sends.
// A box given `mentions` also opens it on "@": other sessions here, then agents.
import { el, isIpcError } from './dom';
import { BUILTINS, MENTION_GROUPS, SLASH_GROUPS, applySlash, filterSlash, slashQuery, type SlashItem, type SlashList } from '../shared/slash';
import { applyMention, mentionQuery } from '../shared/mentions';

interface Owner {
  input: HTMLTextAreaElement;
  button: HTMLButtonElement;
  cwd: () => string | null;
  mentions?: () => SlashItem[];
}

const MAX_HEIGHT = 380;
const MIN_ABOVE = 220; // less room than this above the box: open below it
const GAP = 6;
const OFF: SlashList = { allowed: false, items: [] };

const popup = el('div', 'slash-menu');
popup.hidden = true;
const listbox = el('div', 'slash-list');
listbox.id = 'slash-listbox';
listbox.setAttribute('role', 'listbox');
listbox.setAttribute('aria-label', 'Skills, commands and agents');
const footer = el('div', 'slash-footer');
popup.append(listbox, footer);
// Clicks in the menu keep the caret in the box.
popup.addEventListener('mousedown', (event) => event.preventDefault());

let owner: Owner | null = null;
let browsing = false; // opened from the "/" button, not by typing
let query = '';
let shown: SlashItem[] = [];
let active = 0;
let fetched: SlashList | null = null;
let fetchedFor: string | null | undefined; // the cwd `fetched` was read for; undefined: read again
let request = 0;
let mention: { start: number; end: number } | null = null; // the "@word" being picked for; null: the "/" menu

export const isOpen = (): boolean => !popup.hidden;

function setExpanded({ input, button }: Owner, open: boolean): void {
  input.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-expanded', String(open));
  if (open) input.setAttribute('aria-controls', listbox.id);
  else input.removeAttribute('aria-activedescendant');
}

export function close(): void {
  if (popup.hidden) return;
  popup.hidden = true;
  if (owner) setExpanded(owner, false);
  browsing = false;
}

function place(): void {
  if (!owner) return;
  const box = owner.input.getBoundingClientRect();
  const width = Math.min(Math.max(box.width, 360), window.innerWidth - 32); // lines up with the box
  const left = Math.min(Math.max(16, box.left), window.innerWidth - 16 - width);
  const above = box.top - 16 >= MIN_ABOVE;
  popup.style.width = `${width}px`;
  popup.style.left = `${left}px`;
  popup.style.maxHeight = `${Math.min(MAX_HEIGHT, (above ? box.top : window.innerHeight - box.bottom) - 16 - GAP)}px`;
  popup.style.top = above ? '' : `${box.bottom + GAP}px`;
  popup.style.bottom = above ? `${window.innerHeight - box.top + GAP}px` : '';
}

function setActive(index: number): void {
  if (!owner || !shown.length) return;
  active = (index + shown.length) % shown.length;
  listbox.querySelectorAll('[role="option"]').forEach((option, i) => option.setAttribute('aria-selected', String(i === active)));
  const current = listbox.querySelector<HTMLElement>(`#slash-option-${active}`);
  owner.input.setAttribute('aria-activedescendant', `slash-option-${active}`);
  current?.scrollIntoView({ block: 'nearest' });
}

function option(item: SlashItem, index: number): HTMLElement {
  const row = el('div', `slash-option slash-${item.kind}`);
  row.id = `slash-option-${index}`;
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', 'false');
  const head = el('span', 'slash-head');
  head.append(el('span', 'slash-name', item.label ?? item.insert.trimEnd()), el('span', 'slash-source', item.source));
  row.append(head);
  if (item.description) row.append(el('span', 'slash-desc', item.description));
  row.addEventListener('mousemove', () => { if (active !== index) setActive(index); });
  row.addEventListener('click', () => choose(item));
  return row;
}

// "@" matches sessions without their "session:" and agents without their "agent-".
function mentionMatches(list: SlashList): SlashItem[] {
  const sessions = filterSlash(owner?.mentions?.() ?? [], query.replace(/^session:/i, ''));
  const agents = filterSlash(list.items.filter((i) => i.kind === 'agent'), query.replace(/^agent-/i, ''));
  return [...sessions, ...agents];
}

function emptyText(): string {
  if (mention) return query ? `Nothing matches @${query}` : 'No other sessions in this window';
  return query ? `Nothing matches /${query}` : 'Nothing to show yet';
}

function render(): void {
  const list = fetched ?? OFF;
  const groups = mention ? MENTION_GROUPS : SLASH_GROUPS;
  const matches = mention ? mentionMatches(list) : filterSlash([...list.items, ...BUILTINS], query);
  shown = groups.flatMap(({ kind }) => matches.filter((m) => m.kind === kind));
  listbox.replaceChildren();
  listbox.setAttribute('aria-label', mention ? 'Sessions and agents' : 'Skills, commands and agents');
  let index = 0;
  for (const { kind, label } of groups) {
    const items = shown.filter((m) => m.kind === kind);
    if (!items.length) continue;
    const group = el('div', 'slash-group');
    group.setAttribute('role', 'group');
    const heading = el('div', 'slash-group-label', label);
    heading.id = `slash-group-${kind}`;
    heading.setAttribute('aria-hidden', 'true');
    group.setAttribute('aria-labelledby', heading.id);
    group.append(heading, ...items.map((item) => option(item, index++)));
    listbox.append(group);
  }
  if (!shown.length) listbox.append(el('p', 'slash-empty', emptyText()));
  footer.replaceChildren();
  if (fetched && !fetched.allowed) {
    const allow = el('button', 'slash-allow', 'Allow reading your Claude folder');
    allow.type = 'button';
    allow.addEventListener('click', () => {
      window.dispatchEvent(new Event('petal:allow-folder'));
      fetchedFor = undefined;
      close();
    });
    footer.append(el('span', '', 'Your skills, commands and agents show once Petal may read your Claude folder.'), allow);
  }
  footer.hidden = !footer.childElementCount;
  setActive(Math.min(active, Math.max(0, shown.length - 1)));
  place();
}

async function load(): Promise<void> {
  const cwd = owner?.cwd() ?? null;
  const ticket = ++request;
  const result = await window.pastel.slash.list(cwd);
  if (ticket !== request) return;
  fetched = isIpcError(result) ? OFF : result;
  fetchedFor = cwd;
  if (!popup.hidden) render();
}

function open(next: Owner, text: string, browse: boolean, at: { start: number; end: number } | null = null): void {
  if (!next.input.getClientRects().length) return; // a box hidden under an overlay never opens a menu in mid-air
  const fresh = popup.hidden || owner !== next || (mention === null) !== (at === null);
  mention = at;
  if (owner && owner !== next) setExpanded(owner, false);
  owner = next;
  browsing = browse;
  query = text;
  if (fresh) active = 0;
  if (!popup.isConnected) document.body.append(popup);
  popup.hidden = false;
  setExpanded(next, true);
  if (fetchedFor !== next.cwd()) fetched = null;
  render();
  if (fresh) void load(); // main answers from its cache when it read the folder a moment ago
}

function choose(item: SlashItem): void {
  if (!owner) return;
  const { input } = owner;
  const range = mention;
  close();
  const next = range ? applyMention(input.value, range, item.insert) : { value: applySlash(input.value, item.insert), caret: item.insert.length };
  input.value = next.value;
  input.setSelectionRange(next.caret, next.caret);
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true })); // the box refits and History keeps the draft
}

function sync(target: Owner): void {
  const { value, selectionStart } = target.input;
  const text = slashQuery(value, selectionStart ?? 0);
  const at = text === null && target.mentions ? mentionQuery(value, selectionStart ?? 0) : null;
  if (text !== null) open(target, text, false);
  else if (at) open(target, at.query, false, { start: at.start, end: at.end });
  else if (owner === target && !browsing) close();
}

// Wires one reply box and its "/" button. Call once per box; `mentions` turns on the "@" picker.
export function attach(input: HTMLTextAreaElement, button: HTMLButtonElement, cwd: () => string | null, mentions?: () => SlashItem[]): void {
  const self: Owner = { input, button, cwd, ...(mentions ? { mentions } : {}) };
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-haspopup', 'listbox');
  input.setAttribute('aria-expanded', 'false');
  input.addEventListener('input', () => {
    if (owner === self && browsing && !input.value.startsWith('/')) close();
    sync(self);
  });
  input.addEventListener('click', () => sync(self));
  input.addEventListener('blur', () => { if (owner === self) close(); });
  // Capture: runs before the box's own Enter-sends and Escape handlers.
  input.addEventListener('keydown', (event) => {
    if (owner !== self || popup.hidden || event.isComposing) return;
    const take = () => { event.preventDefault(); event.stopImmediatePropagation(); };
    if (event.key === 'ArrowDown') { take(); setActive(active + 1); }
    else if (event.key === 'ArrowUp') { take(); setActive(active - 1); }
    else if (event.key === 'Escape') { take(); close(); }
    else if ((event.key === 'Enter' && !event.shiftKey) || (event.key === 'Tab' && !event.shiftKey)) {
      if (!shown.length) { close(); return; } // nothing to pick: Enter sends what she typed
      take();
      choose(shown[active]);
    }
  }, true);
  input.addEventListener('keyup', (event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) sync(self); });
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('mousedown', (event) => event.preventDefault()); // keeps the caret in the box
  button.addEventListener('click', () => {
    if (owner === self && !popup.hidden) { close(); input.focus(); return; }
    input.focus();
    open(self, slashQuery(input.value, input.selectionStart ?? 0) ?? '', true, null);
  });
}

// Back in Petal: the next open reads again, so a skill added meanwhile shows.
window.addEventListener('focus', () => { fetchedFor = undefined; if (owner && !popup.hidden) void load(); });
window.addEventListener('resize', () => { if (!popup.hidden) place(); });
