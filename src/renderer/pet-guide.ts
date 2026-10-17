// The pet's setup guide on a new install: four cards over the reader (hello, pet, scene, folder), then a speech
// bubble by the pet that points at the next thing until the first reply. Skip ends it; Help › Show setup again restarts it.
import * as overlays from './overlays';
import * as consent from './consent';
import * as getStarted from './get-started';
import * as tabs from './tabs';
import * as scenes from './scenes';
import { petWords, portrait } from './cat';
import { byId, el, focusTerminal, isIpcError } from './dom';
import type { FolderChoice } from '../shared/claude-folder';
import type { Choice } from '../shared/types';
import {
  CARD_STEPS, EXAMPLE_ASK, GUIDE_PETS, INSTALL_COMMAND, bubbleCopy, bubbleStep, cardCopy, isCardStep, nextCard, personality, previousCard,
  resumeAt, stageToSave, typeClaudeHelp, type BubbleStep, type CardStep, type GuideFacts, type GuideStage, type GuideStep,
} from '../shared/pet-guide';

const COPIED_MS = 1400;
const CELEBRATE_MS = 12_000; // the party ends by itself if she doesn't click
const BUBBLE_GAP = 14;

const view = byId('pet-guide');
const bubble = el('div', 'pet-bubble');
bubble.id = 'pet-bubble';
bubble.hidden = true;
bubble.setAttribute('role', 'dialog');
bubble.setAttribute('aria-label', 'Petal setup');
const pointer = el('div', 'pet-pointer');
pointer.hidden = true;
pointer.setAttribute('aria-hidden', 'true');
const party = el('div', 'pet-party');
party.hidden = true;
party.setAttribute('aria-hidden', 'true');
const announcer = el('p', 'pet-announcer');
announcer.setAttribute('aria-live', 'polite');
document.body.append(bubble, pointer, party, announcer);

let step: GuideStep | null = null;
let savedStage: GuideStage | null = null; // as this launch found it
let folder: FolderChoice = 'unasked';
let cat = 'mika';
let scene = 'none';
let sceneChoices: readonly Choice[] = [];
let tabsAtAsk = 1; // tabs open when the bubble first said Add Session
let repliesAtStart = 0; // replies already there when the bubbles began, so a restart waits for a new one
let celebrateTimer: ReturnType<typeof setTimeout> | undefined;

const words = () => petWords(cat);
const save = (stage: GuideStage) => window.pastel.config.save({ onboarding: { step: stage } });
const replyCount = (): number => tabs.ids().reduce((sum, id) => sum + (tabs.get(id)?.update?.replies.length ?? 0), 0);

function facts(): GuideFacts {
  const live = getStarted.currentFacts();
  return {
    folderChoice: folder,
    addedSession: live.tabCount > tabsAtAsk,
    claudeRunning: live.claudeRunning,
    sessionStarted: live.sessionStarted,
    replied: replyCount() > repliesAtStart,
  };
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function copyChip(text: string, label: string): HTMLElement {
  const chip = el('div', 'pg-chip');
  const code = el('code', null, text);
  const copy = button('Copy', 'pg-copy', async () => {
    const copied = await navigator.clipboard.writeText(text).then(() => true, () => false);
    copy.textContent = copied ? 'Copied' : 'Copy failed';
    setTimeout(() => { copy.textContent = 'Copy'; }, COPIED_MS);
  });
  copy.dataset.copy = text;
  copy.setAttribute('aria-label', `Copy ${label}`);
  chip.append(code, copy);
  return chip;
}

function petPicture(id: string, className: string): HTMLElement {
  const picture = el('span', `cat-portrait ${className}`);
  picture.dataset.cat = id;
  picture.innerHTML = portrait(id); // Petal's own pixel data, no outside text
  return picture;
}

// Arrow keys move the pick inside a radio group, as a native one would.
function radioGroup(label: string, className: string, items: HTMLButtonElement[]): HTMLElement {
  const group = el('div', className);
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  group.append(...items);
  group.addEventListener('keydown', (event) => {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!delta) return;
    event.preventDefault();
    const at = items.findIndex((item) => item === document.activeElement);
    const next = items[(at + delta + items.length) % items.length];
    next.focus();
    next.click();
  });
  return group;
}

function radio(selected: boolean, onPick: () => void, className: string): HTMLButtonElement {
  const b = button('', className, onPick);
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', String(selected));
  b.tabIndex = selected ? 0 : -1;
  return b;
}

// ── Cards ──

function welcomeBody(): HTMLElement {
  const row = el('div', 'pg-hello');
  row.append(...GUIDE_PETS.map((id) => petPicture(id, 'pg-hello-pet')));
  return row;
}

function petBody(): HTMLElement {
  return radioGroup('Pet', 'pg-pets', GUIDE_PETS.map((id) => {
    const pet = petWords(id);
    const tile = radio(cat === id, () => pickPet(id), 'pg-pet');
    tile.dataset.pet = id;
    tile.append(petPicture(id, 'pg-pet-picture'), el('span', 'pg-pet-name', pet.name), el('span', 'pg-pet-line', personality(id, pet)));
    return tile;
  }));
}

// Scene colours live under #cat in the scene stylesheets; the thumbnails borrow them once, still.
let thumbStyles = false;
function borrowSceneStyles(): void {
  if (thumbStyles) return;
  thumbStyles = true;
  const rules: string[] = [];
  for (const sheet of [...document.styleSheets]) {
    let list: CSSRuleList;
    try { list = sheet.cssRules; } catch { continue; }
    for (const rule of [...list]) {
      if (rule instanceof CSSStyleRule && /#cat \.(scene|sc-)/.test(rule.selectorText)) rules.push(rule.cssText.replaceAll('#cat ', '.pg-thumb '));
    }
  }
  document.head.append(el('style', null, rules.join('\n')));
}

function sceneThumb(id: string): HTMLElement {
  const thumb = el('span', 'pg-thumb');
  const stage = el('span', 'pg-thumb-stage');
  const layers = scenes.svg(id);
  const pet = el('span', 'pg-thumb-pet');
  pet.append(petPicture(cat, 'pg-thumb-picture'));
  stage.innerHTML = layers.back; // Petal's own scene art
  stage.append(pet);
  stage.insertAdjacentHTML('beforeend', layers.front);
  thumb.append(stage);
  return thumb;
}

function sceneBody(): HTMLElement {
  borrowSceneStyles();
  return radioGroup('Scene', 'pg-scenes', sceneChoices.map(([id, name]) => {
    const tile = radio(scene === id, () => pickScene(id), 'pg-scene');
    tile.dataset.scene = id;
    tile.append(sceneThumb(id), el('span', 'pg-scene-name', name));
    return tile;
  }));
}

function consentBody(): HTMLElement {
  const box = el('div', 'pg-consent');
  const said = el('div', 'pg-said');
  said.append(petPicture(cat, 'pg-said-pet'), el('p', 'pg-said-line', cardCopy('consent', words()).line));
  const more = el('details', 'pg-more');
  const list = el('ul', 'consent-reads');
  list.append(...consent.READS.map((line) => el('li', null, line)));
  more.append(el('summary', null, 'What exactly does Petal read?'), list,
    el('p', 'consent-line', 'Petal writes nothing there unless you ask it to. Not now keeps the terminal working; the reader stays empty.'));
  box.append(said, more);
  return box;
}

const BODIES: Record<CardStep, () => HTMLElement> = { welcome: welcomeBody, pet: petBody, scene: sceneBody, consent: consentBody };

function renderCard(card: CardStep): void {
  const copy = cardCopy(card, words());
  const pane = el('div', 'pg-card');
  pane.dataset.step = card;
  const number = CARD_STEPS.indexOf(card) + 1;
  const dots = el('p', 'pg-dots');
  dots.append(...CARD_STEPS.map((_, i) => el('span', i < number ? 'on' : null)), el('span', 'pg-dots-text', `Step ${number} of ${CARD_STEPS.length}`));
  pane.append(dots, el('h1', 'pg-title', copy.title));
  if (card !== 'consent') pane.append(el('p', 'pg-line', copy.line));
  pane.append(BODIES[card]());

  const footer = el('footer', 'pg-footer');
  const actions = el('div', 'pg-actions');
  if (card === 'consent') {
    actions.append(button('Allow', 'pg-primary pg-allow', () => void answerFolder('allowed')), button('Not now', 'pg-secondary pg-later', () => void answerFolder('declined')));
  } else {
    actions.append(button(card === 'welcome' ? 'Start' : 'Next', 'pg-primary pg-next', () => void advance(card)));
    const back = previousCard(card);
    if (back) actions.append(button('Back', 'pg-secondary pg-back', () => void show(back)));
  }
  footer.append(actions, button('Skip setup', 'pg-skip', () => void skip()));
  view.replaceChildren(pane, footer);
  pane.scrollTop = 0;
  // The folder card focuses itself, not Allow, so a stray Enter can't answer for her (as the old question did).
  const focus = card === 'consent' ? view : view.querySelector<HTMLElement>('[role="radio"][aria-checked="true"], .pg-next');
  focus?.focus({ preventScroll: true });
  announce(`${copy.title}. ${copy.line}`);
}

function repaintPicks(): void {
  if (step === 'pet' || step === 'scene') {
    const focused = document.activeElement instanceof HTMLElement && view.contains(document.activeElement) ? document.activeElement.dataset : null;
    renderCard(step);
    const again = focused?.pet ? view.querySelector<HTMLElement>(`[data-pet="${focused.pet}"]`) : focused?.scene ? view.querySelector<HTMLElement>(`[data-scene="${focused.scene}"]`) : null;
    again?.focus({ preventScroll: true });
  }
}

function pickPet(id: string): void {
  cat = id;
  window.pastel.look.setCat(id); // the corner pet changes live
  repaintPicks();
}

function pickScene(id: string): void {
  scene = id;
  window.pastel.look.setScene(id);
  repaintPicks();
}

async function answerFolder(choice: FolderChoice): Promise<void> {
  folder = choice;
  await consent.setChoice(choice); // the same answer, saved in the same place, as the old question
  await advance('consent');
}

async function advance(card: CardStep): Promise<void> {
  const next = nextCard(card, folder);
  await show(next === 'bubbles' ? startBubbles() : next);
}

function startBubbles(): BubbleStep {
  tabsAtAsk = tabs.ids().length;
  repliesAtStart = replyCount();
  return bubbleStep(facts());
}

// ── The bubble ──

const target = (s: BubbleStep): HTMLElement | null => ({
  'add-session': byId('add-session-button'),
  'type-claude': byId('terminal-pane'),
  'claude-setup': byId('terminal-pane'),
  ask: byId('composer'),
  celebrate: null,
})[s];

function bubbleBody(s: BubbleStep): { nodes: Node[]; focus: HTMLElement | null } {
  const claudeFound = getStarted.currentFacts().claudeInstalled;
  const copy = bubbleCopy(s, words(), { claudeFound, folder });
  const name = el('p', 'pb-name');
  name.append(petPicture(cat, 'pb-face'), el('span', null, words().name));
  const nodes: Node[] = [name, el('p', 'pb-say', copy.say)];
  if (copy.note) nodes.push(el('p', 'pb-note', copy.note));
  const actions = el('div', 'pb-actions');
  let focus: HTMLElement | null = null;
  if (s === 'type-claude' && typeClaudeHelp(claudeFound) === 'type') {
    const chip = copyChip('claude', 'claude');
    nodes.push(chip);
    focus = chip.querySelector('button');
  } else if (s === 'type-claude') {
    const chip = copyChip(INSTALL_COMMAND, 'the install command');
    nodes.push(chip);
    focus = chip.querySelector('button');
    actions.append(button('Check again', 'pb-recheck', () => void getStarted.recheckInstall().then(() => paintBubble(true))));
  }
  if ((s === 'claude-setup' || s === 'ask') && folder !== 'allowed') {
    const allow = button('Allow reading it', 'pb-allow', () => void consent.setChoice('allowed').then(() => { folder = 'allowed'; paintBubble(true); }));
    actions.append(allow);
    focus ??= allow;
  }
  if (s === 'celebrate') {
    const done = button('Yay!', 'pb-done', finish);
    actions.append(done);
    focus = done;
  } else actions.append(button('Skip setup', 'pb-skip', () => void skip()));
  nodes.push(actions);
  if (s === 'add-session') focus ??= target(s); // the button she's meant to press, so Enter does it
  return { nodes, focus };
}

let shownBubble: BubbleStep | null = null;
let shownKey = '';

// Draws the bubble for the current step; focus moves only when what it says changed.
function paintBubble(force = false): void {
  if (!step || isCardStep(step)) return;
  const s = step;
  const key = `${s}|${getStarted.currentFacts().claudeInstalled}|${folder}|${cat}`;
  if (!force && key === shownKey) { place(); return; }
  const changedStep = s !== shownBubble;
  shownBubble = s;
  shownKey = key;
  for (const old of document.querySelectorAll('.pg-target')) old.classList.remove('pg-target');
  target(s)?.classList.add('pg-target');
  const { nodes, focus } = bubbleBody(s);
  bubble.replaceChildren(...nodes);
  bubble.dataset.step = s;
  bubble.hidden = false;
  if (s === 'ask') primeReplyBox();
  if (s === 'celebrate') celebrate();
  place();
  if (changedStep && focus && s !== 'claude-setup') focus.focus({ preventScroll: true }); // Claude's own screens keep the keys
  announce(`${words().name} says: ${[...bubble.querySelectorAll('.pb-say, .pb-note')].map((p) => p.textContent).join(' ')}`);
}

// A Send-ready example in the reply box, unless she has started typing there.
function primeReplyBox(): void {
  const input = byId<HTMLTextAreaElement>('composer-input');
  if (input.value.trim()) return;
  input.value = EXAMPLE_ASK;
  input.dispatchEvent(new Event('input', { bubbles: true })); // the box grows to fit
}

function celebrate(): void {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  party.classList.toggle('still', still);
  party.replaceChildren(...Array.from({ length: still ? 5 : 14 }, (_, i) => {
    const bit = el('span', i % 3 ? 'pp-heart' : 'pp-star');
    bit.style.setProperty('--i', String(i));
    return bit;
  }));
  party.hidden = false;
  clearTimeout(celebrateTimer);
  celebrateTimer = setTimeout(finish, CELEBRATE_MS);
}

const visible = (box: DOMRect): boolean => box.width > 0 && box.height > 0;
const overlaps = (a: DOMRect, b: { left: number; top: number; right: number; bottom: number }): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// Beside the pet with its tail toward her, never over the thing it points at; the arrow sits by that thing.
function place(): void {
  const hide = step === null || isCardStep(step) || overlays.current() !== null;
  if (hide) {
    bubble.hidden = true;
    pointer.hidden = true;
    party.hidden = true;
    return;
  }
  bubble.hidden = false;
  const sprite = document.querySelector('#cat .cat-sprite')?.getBoundingClientRect();
  const area = byId('reader-area').getBoundingClientRect();
  const pet = sprite && visible(sprite) ? sprite : new DOMRect(area.right - 90, area.bottom - 90, 60, 60);
  const width = bubble.offsetWidth;
  const height = bubble.offsetHeight;
  const goal = shownBubble ? target(shownBubble)?.getBoundingClientRect() ?? null : null;
  const spots = [
    { side: 'right', left: pet.left - width - BUBBLE_GAP, top: pet.top + pet.height * 0.4 - height }, // left of her, tail right
    { side: 'bottom', left: pet.right - width, top: pet.top - height - BUBBLE_GAP }, // above her, tail down
    { side: 'top', left: pet.right - width, top: pet.bottom + BUBBLE_GAP }, // below her (docked in the header bar)
  ].map((spot) => ({
    ...spot,
    left: Math.max(8, Math.min(spot.left, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(spot.top, window.innerHeight - height - 8)),
  }));
  const box = (s: { left: number; top: number }) => ({ left: s.left, top: s.top, right: s.left + width, bottom: s.top + height });
  const spot = spots.find((s) => !overlaps(pet, box(s)) && !(goal && overlaps(goal, box(s)) && shownBubble !== 'type-claude' && shownBubble !== 'claude-setup'))
    ?? spots[0];
  bubble.dataset.tail = spot.side;
  bubble.style.left = `${Math.round(spot.left)}px`;
  bubble.style.top = `${Math.round(spot.top)}px`;
  // The tail points at her, wherever the bubble had to go.
  const tailAt = spot.side === 'right' ? pet.top + pet.height * 0.25 - spot.top : pet.left + pet.width / 2 - spot.left;
  bubble.style.setProperty('--tail', `${Math.round(Math.max(18, Math.min(tailAt, (spot.side === 'right' ? height : width) - 24)))}px`);
  placePointer(goal);
  if (shownBubble === 'celebrate') {
    party.hidden = false;
    party.style.left = `${Math.round(pet.left + pet.width / 2)}px`;
    party.style.top = `${Math.round(pet.top + pet.height / 2)}px`;
  }
}

// A bobbing pixel arrow just outside the target, pointing at it: below a dock button, above the terminal or reply box.
function placePointer(goal: DOMRect | null): void {
  if (!goal || !visible(goal) || shownBubble === 'celebrate' || shownBubble === 'claude-setup') {
    pointer.hidden = true;
    return;
  }
  pointer.hidden = false;
  const up = goal.top < window.innerHeight / 3; // a dock button: arrow below it, pointing up
  pointer.dataset.dir = up ? 'up' : 'down';
  const x = shownBubble === 'add-session' ? goal.left + goal.width / 2 - 12 : goal.left + 36;
  pointer.style.left = `${Math.round(x)}px`;
  pointer.style.top = `${Math.round(up ? goal.bottom + 6 : goal.top - 34)}px`;
}

// ── Steps ──

async function show(next: GuideStep): Promise<void> {
  step = next;
  clearTimeout(celebrateTimer);
  if (next !== 'celebrate') party.hidden = true;
  await save(stageToSave(next));
  if (isCardStep(next)) {
    bubble.hidden = true;
    pointer.hidden = true;
    clearTargets();
    if (!overlays.isOpen('pet-guide')) overlays.showLocked('pet-guide');
    renderCard(next);
    return;
  }
  if (overlays.isOpen('pet-guide')) {
    overlays.unlock('pet-guide');
    overlays.hide('pet-guide');
  }
  paintBubble(true);
}

const clearTargets = (): void => { for (const old of document.querySelectorAll('.pg-target')) old.classList.remove('pg-target'); };

function end(stage: 'done' | 'skipped'): void {
  step = null;
  shownBubble = null;
  shownKey = '';
  clearTimeout(celebrateTimer);
  void save(stage);
  overlays.unlock('pet-guide');
  overlays.hide('pet-guide');
  bubble.hidden = true;
  pointer.hidden = true;
  party.hidden = true;
  clearTargets();
}

function finish(): void {
  if (step !== 'celebrate') return;
  end('done');
  announce('Setup finished.');
  focusTerminal();
}

// Skip setup, or Esc: the guide ends for good (Help › Show setup again brings it back).
// Before the folder question is answered it still has to be asked once, so the old question follows.
export async function skip(): Promise<void> {
  if (step === null) return;
  const wasConsent = step === 'consent';
  end('skipped');
  announce('Setup skipped. Help, Show setup again brings it back.');
  if (wasConsent) await consent.setChoice('declined'); // Esc on the folder question always meant Not now
  else if (folder === 'unasked') consent.open();
  focusTerminal();
}

function announce(text: string): void {
  announcer.textContent = '';
  requestAnimationFrame(() => { announcer.textContent = text; }); // a fresh node change, so it's read again
}

// Tab, reply or install changes: the bubble follows what Petal sees.
export function refresh(): void {
  if (!step || isCardStep(step)) return;
  const next = bubbleStep(facts());
  if (next !== step) void show(next);
  else paintBubble();
}

async function loadState(): Promise<GuideStage | null> {
  const state = await window.pastel.config.get();
  if (isIpcError(state)) return null;
  savedStage = state.config.onboarding.step;
  folder = state.config.claudeFolder.choice;
  cat = state.look.cat;
  scene = state.look.scene;
  sceneChoices = state.choices.scenes;
  return state.config.onboarding.step;
}

// On launch: the guide's saved step on a new install, or false when it's over or predates this install.
export async function resumeIfStarted(): Promise<boolean> {
  const stage = await loadState();
  if (!stage) return false;
  tabsAtAsk = tabs.ids().length;
  repliesAtStart = replyCount();
  const at = resumeAt(stage, facts());
  if (!at) return false;
  await window.pastel.config.save({ welcome: { seen: true } }); // the old welcome screen never shows over it
  await show(at);
  return true;
}

// Help › Show setup again: from the hello card, whatever happened before.
export async function restart(): Promise<void> {
  if (!(await loadState())) return;
  overlays.hideCurrent();
  await show('welcome');
}

// Finished or skipped here: launches leave her alone, no checklist either.
export const endedHere = (): boolean => savedStage === 'done' || savedStage === 'skipped';

export const current = (): GuideStep | null => step;
export const isOpen = (): boolean => step !== null;

// Esc in a card or the bubble skips; Esc in the folder card is Not now as well (skip() saves it).
view.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.stopPropagation();
  void skip();
}, true);
bubble.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.stopPropagation();
  void skip();
});
byId('add-session-button').addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && step === 'add-session') void skip();
});

// She can move the pet, resize the window or open another view: the bubble follows, or waits while it's covered.
const replace = (): void => { if (step && !isCardStep(step)) place(); };
window.addEventListener('resize', replace);
new ResizeObserver(replace).observe(byId('reader-area'));
new MutationObserver(replace).observe(byId('reader'), { attributes: true, attributeFilter: ['hidden'] });
new MutationObserver(replace).observe(byId('cat'), { attributes: true, attributeFilter: ['class', 'style'] });
window.pastel.onClaudeFolder((allowed) => { if (allowed) folder = 'allowed'; else if (folder === 'allowed') folder = 'declined'; refresh(); });
window.pastel.onCat((id) => { cat = id; if (step && !isCardStep(step)) paintBubble(); });
window.pastel.onOpenPetGuide(() => void restart());
