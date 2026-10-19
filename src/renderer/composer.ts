// Reply box under the reader: pasted into the active tab's Claude, or starts Claude with it when none is running.
// Without Claude, `checkout <repo>` or `cd <repo>` opens Open Repo instead.
import * as tabs from './tabs';
import * as repos from './repos';
import { parseRepoCommand } from '../shared/repo-match';
import { byId, el, focusTerminal, isIpcError } from './dom';
import { acceptFileDrags, droppedPaths } from './terminal';
import { pastesImagePath, quotePaths } from '../shared/quote-path';
import { OPEN_THREAD_EVENT } from './open-threads';
import * as slashMenu from './slash-menu';
import { applySlash } from '../shared/slash';
import * as mentions from './mentions';
import * as mentionBar from './mention-bar';
import type { MentionPlan } from '../shared/mentions';
import { screenIsAsking } from '../shared/prompt-answer';

const form = byId<HTMLFormElement>('composer');
const input = byId<HTMLTextAreaElement>('composer-input');
const MAX_ROWS = 8;
// Pasted images waiting to go with the next send; each is a PNG main saved.
const attachments: { file: string; thumb: string }[] = [];
const chips = el('div');
chips.id = 'composer-attachments';
chips.hidden = true;
form.prepend(chips);
const toLine = mentionBar.create(form, input, () => mentions.targets());
// Bracketed paste keeps multi-line replies as one message instead of sending at each newline.
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

function fit(): void {
  input.style.height = 'auto';
  const line = parseFloat(getComputedStyle(input).lineHeight);
  input.style.height = `${Math.min(input.scrollHeight, line * MAX_ROWS + 20)}px`;
  // Chips start where the centered text box starts.
  chips.style.paddingLeft = `${Math.max(0, input.offsetLeft - chips.offsetLeft)}px`;
  document.documentElement.style.setProperty('--composer-height', `${form.offsetHeight}px`);
}

// C0 controls other than newline and tab could end the bracketed paste early or drive the TUI (ESC above all).
// eslint-disable-next-line no-control-regex -- stripping C0 controls is the point
export const stripControls = (text: string): string => text.replace(/[\x00-\x08\x0B-\x1F]/g, '');

const clear = (): void => {
  input.value = '';
  attachments.length = 0;
  renderChips();
  toLine.refresh();
  fit();
};

function renderChips(): void {
  chips.replaceChildren(...attachments.map(({ thumb }, i) => {
    const chip = el('span', 'composer-chip');
    const image = el('img');
    image.src = thumb;
    image.alt = `Pasted image ${i + 1}`;
    const remove = el('button', 'composer-chip-remove', '×');
    remove.type = 'button';
    remove.title = 'Remove image';
    remove.setAttribute('aria-label', `Remove pasted image ${i + 1}`);
    remove.addEventListener('click', () => { attachments.splice(i, 1); renderChips(); input.focus(); });
    chip.append(image, remove);
    return chip;
  }));
  chips.hidden = attachments.length === 0;
  fit();
}

const dataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

// Main saves the PNG; the chip shows a thumbnail and the path goes out with the message.
async function attach(image: File): Promise<void> {
  const saved = await window.pastel.savePastedImage(new Uint8Array(await image.arrayBuffer()));
  if (isIpcError(saved)) {
    console.warn('[petal] image paste failed:', saved.error);
    return;
  }
  attachments.push({ file: saved.file, thumb: await dataUrl(image) });
  renderChips();
}

// Inserts at the cursor, as Terminal types a dropped path.
function insertAtCursor(text: string): void {
  input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
  fit();
}

const refreshReader = (tabId: string): void => { window.dispatchEvent(new CustomEvent('petal:reader-refresh', { detail: tabId })); };

// Pastes a message into a tab's live Claude, echoed at once; a send that never arrived takes its echo back.
// While Claude waits on a prompt, a pasted Enter would answer it (a permission's focused "Yes"), so nothing is sent.
export const claudeIsAsking = (tab: tabs.Tab): boolean => screenIsAsking(tabs.screenLines(tab));

// One write with its Enter, unless the message holds an image path: then the Enter follows once Claude has read it.
async function sendPaste(tab: tabs.Tab, text: string): ReturnType<typeof window.pastel.paste> {
  const pasted = `${PASTE_START}${text}${PASTE_END}`;
  if (!pastesImagePath(text)) return window.pastel.paste(tab.id, `${pasted}\r`);
  const before = mentions.imageTags(tab);
  const result = await window.pastel.paste(tab.id, pasted);
  if (isIpcError(result) || !result.sent) return result;
  await mentions.imagesRead(tab, before);
  return window.pastel.paste(tab.id, '\r');
}

export async function pasteToClaude(tab: tabs.Tab, text: string): Promise<boolean> {
  if (claudeIsAsking(tab)) return false;
  const echo = tabs.addPending(tab, text);
  refreshReader(tab.id);
  const result = await sendPaste(tab, text);
  const sent = !isIpcError(result) && result.sent;
  if (echo !== null && !sent) {
    tabs.removePending(tab, echo);
    refreshReader(tab.id);
  }
  return sent;
}

// The one send path: live Claude gets it pasted, a repo command opens Open Repo, else Claude starts with it.
// taken: runs as the message leaves, so the box clears exactly when it always has.
async function deliver(text: string, taken: () => void): Promise<void> {
  const tab = tabs.active();
  if (!text || !tab) return;
  if (tab.update?.state === 'live') {
    if (claudeIsAsking(tab)) { toLine.note('Claude is asking something in the terminal. Answer it there first, then send.'); return; }
    taken();
    await pasteToClaude(tab, text);
    return;
  }
  const repoQuery = parseRepoCommand(text);
  if (repoQuery && await repos.offers(tab.id, repoQuery)) {
    taken();
    repos.open(repoQuery);
    return;
  }
  window.pastel.startClaude(tab.id, text);
  taken();
}

async function send(): Promise<void> {
  // Claude turns an image path in a pasted message into [Image #n].
  const text = [stripControls(input.value).trim(), quotePaths(attachments.map((a) => a.file))].filter(Boolean).join(' ');
  const plan = toLine.plan(text);
  if (!plan) { await deliver(text, clear); return; }
  if (!plan.body) { toLine.note('Write a message after the mention, then send.'); return; }
  await sendMentions(plan);
}

// Mentions go to their sessions through main; this session gets the message only when she ticked Also send.
async function sendMentions(plan: MentionPlan): Promise<void> {
  const from = tabs.active()?.id ?? null;
  clear();
  const result = plan.to.length ? await mentions.send(from, plan.to.map((t) => t.tabId), plan.body) : [];
  if ('error' in result) toLine.note(`Couldn’t send: ${result.error}`);
  else toLine.showResult(result, plan.unknown);
  if (plan.alsoHere) await deliver(plan.body, () => {});
}

// An Open threads card in the reader asks its question as if typed here; her draft in the box stays.
byId('reader').addEventListener(OPEN_THREAD_EVENT, (event) => {
  const text = stripControls(String((event as CustomEvent<string>).detail ?? '')).trim();
  void deliver(text, () => {});
});

form.addEventListener('submit', (event) => { event.preventDefault(); void send(); });
input.addEventListener('input', fit);
input.addEventListener('paste', (event) => {
  const images = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'));
  if (!images.length || event.clipboardData?.getData('text/plain')) return;
  event.preventDefault();
  images.forEach((image) => void attach(image));
});
acceptFileDrags(form);
form.addEventListener('drop', (event) => {
  const paths = droppedPaths(event.dataTransfer);
  if (!paths.length) return;
  event.preventDefault();
  input.focus();
  insertAtCursor(`${quotePaths(paths)} `);
});
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void send();
  } else if (event.key === 'Escape') {
    focusTerminal();
  }
});
slashMenu.attach(input, byId<HTMLButtonElement>('composer-slash'), () => tabs.active()?.update?.cwd ?? null, mentions.pickerItems);
new ResizeObserver(fit).observe(form);
fit();

export const focus = (): void => input.focus();

// Sends a message from another view (Testing's Ask in this session instead) the way the box sends; her draft stays.
export async function askClaude(text: string): Promise<void> {
  await deliver(stripControls(text).trim(), () => {});
}

// Puts a skill, agent or command in front of her draft, as picking it from the "/" menu does.
export function insertCommand(insert: string): void {
  input.value = applySlash(input.value, insert);
  input.setSelectionRange(insert.length, insert.length);
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
