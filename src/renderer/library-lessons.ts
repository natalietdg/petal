// Library › Lessons: how-to-work rules learned from sessions, one card each, waiting on her.
// Add to CLAUDE.md shows the exact lines first; only the second click writes, through main's preview token.
import * as customize from './customize';
import * as history from './history';
import { el, isIpcError } from './dom';
import type { DiffLine, Lesson, LessonPreview, LessonsList, LessonTarget } from '../shared/lessons';

export const panel = el('section', 'lsn');
panel.setAttribute('aria-label', 'Lessons');
panel.hidden = true;
const intro = el('p', 'lsn-intro', 'How to work with you, learned from your sessions: your corrections, Claude’s mistakes, approaches you approved. Nothing goes into a CLAUDE.md until you add it.');
const notice = el('div', 'lib-note lsn-notice');
notice.setAttribute('role', 'status');
const cards = el('ul', 'lsn-cards');
const empty = el('div', 'lib-empty lsn-empty');
const status = el('p', 'lsn-status');
status.setAttribute('role', 'status');
panel.append(intro, notice, status, cards, empty);

let data: LessonsList | null = null;
let onCount: (n: number) => void = () => undefined;
export const setCountListener = (listener: (n: number) => void): void => { onCount = listener; };

const errorOf = (result: unknown): string | null =>
  (isIpcError(result) ? String(result.error) : null);

const button = (label: string, className: string, onClick: () => unknown): HTMLButtonElement => {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', () => void onClick());
  return b;
};

const folderName = (cwd: string | null): string => (cwd ? cwd.split('/').filter(Boolean).at(-1) ?? cwd : '');
const scopeText = (lesson: Lesson): string => (lesson.scope === 'project' && lesson.cwd ? `Project · ${folderName(lesson.cwd)}` : 'All projects');
const dateText = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function drawNotice(): void {
  notice.replaceChildren();
  if (data && !data.allowed) {
    notice.append(el('span', null, 'Petal isn’t reading your Claude folder, so lessons can’t be learned or added to a CLAUDE.md.'),
      button('Allow', 'lib-link', () => window.dispatchEvent(new Event('petal:allow-folder'))));
  } else if (data && !data.learn && data.lessons.length) {
    notice.append(el('span', null, 'Learn lessons from sessions is off, so no new ones arrive.'), button('Turn it on', 'lib-link', () => customize.open('organizer')));
  }
  notice.hidden = !notice.childElementCount;
}

function drawEmpty(): void {
  empty.replaceChildren();
  empty.hidden = Boolean(data?.lessons.length);
  if (empty.hidden) return;
  if (!data) { empty.append(el('p', 'lib-empty-text', 'Opening lessons…')); return; }
  empty.append(el('p', 'lib-empty-title', 'No lessons waiting'));
  empty.append(el('p', 'lib-empty-text', data.learn
    ? 'When a session ends, Petal notes how to work with you here. Nothing yet.'
    : 'Turn on Learn lessons from sessions and Petal notes how to work with you after each session ends. It uses your Claude plan.'));
  if (!data.learn) empty.append(button('Open the setting', 'lib-read', () => customize.open('organizer')));
}

function diffBlock(preview: LessonPreview): HTMLElement {
  const pre = el('pre', 'lsn-diff');
  pre.setAttribute('aria-label', 'Lines to add');
  for (const line of preview.lines) pre.append(diffRow(line));
  return pre;
}
const diffRow = ({ kind, text }: DiffLine): HTMLElement => el('span', `lsn-diff-line lsn-diff-${kind}`, `${kind === 'add' ? '+ ' : '  '}${text || ' '}`);

// The add box: pick the file, see the lines, then confirm.
function addBox(lesson: Lesson, card: HTMLElement): HTMLElement {
  const box = el('section', 'lsn-add');
  box.setAttribute('aria-label', 'Add to CLAUDE.md');
  let target: LessonTarget = lesson.scope === 'project' && lesson.cwd ? 'project' : 'global';
  const choose = el('div', 'lib-sort lsn-targets');
  choose.setAttribute('role', 'group');
  choose.setAttribute('aria-label', 'Which CLAUDE.md');
  const body = el('div', 'lsn-add-body');
  const draw = async () => {
    for (const b of choose.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.target === target));
    body.replaceChildren(el('p', 'lsn-add-file', 'Reading CLAUDE.md…'));
    const preview = await window.pastel.library.previewLesson(lesson.id, target);
    const error = errorOf(preview);
    if (error || isIpcError(preview)) { body.replaceChildren(el('p', 'lsn-error', error ?? 'That didn’t work.')); return; }
    const confirm = button('Add these lines', 'lib-read lsn-confirm', async () => {
      confirm.disabled = true;
      const result = await window.pastel.library.addLesson(preview.token);
      const failed = errorOf(result);
      if (failed) { confirm.disabled = false; body.append(el('p', 'lsn-error', failed)); return; }
      status.textContent = `Added to ${preview.file}.`;
      card.remove();
      await load();
    });
    const file = el('p', 'lsn-add-file');
    file.append(el('span', null, preview.created ? 'New file ' : 'Adds to '), el('code', null, preview.file));
    body.replaceChildren(file, diffBlock(preview), actions(confirm, button('Cancel', 'lib-confirm-cancel', () => { box.remove(); })));
  };
  for (const [id, label] of [['global', 'Global CLAUDE.md'], ['project', `This project’s${lesson.cwd ? ` (${folderName(lesson.cwd)})` : ''}`]] as const) {
    const b = button(label, 'lib-sort-button', () => { target = id; void draw(); });
    b.dataset.target = id;
    b.disabled = id === 'project' && !lesson.cwd;
    choose.append(b);
  }
  box.append(choose, body);
  void draw();
  return box;
}

const actions = (...buttons: HTMLElement[]): HTMLElement => {
  const row = el('div', 'lsn-actions');
  row.append(...buttons);
  return row;
};

function mergeBox(lesson: Lesson, other: Lesson): HTMLElement {
  const box = el('section', 'lsn-add lsn-merge');
  box.append(el('p', 'lsn-add-file', `Fold “${other.rule}” into this lesson? Its evidence comes along; the other card goes.`),
    actions(button('Merge', 'lib-read', async () => {
      const failed = errorOf(await window.pastel.library.mergeLessons(lesson.id, other.id));
      if (failed) { box.append(el('p', 'lsn-error', failed)); return; }
      status.textContent = 'Merged the two lessons.';
      await load();
    }), button('Keep both', 'lib-confirm-cancel', () => box.remove())));
  return box;
}

function makeCard(lesson: Lesson, similar: Lesson | null): HTMLLIElement {
  const card = el('li', 'lsn-card');
  card.dataset.id = lesson.id;
  card.append(el('p', 'lsn-rule', lesson.rule));
  if (lesson.why) card.append(el('p', 'lsn-why', lesson.why));
  if (lesson.evidence) card.append(el('blockquote', 'lsn-evidence', lesson.evidence));
  const meta = el('p', 'lsn-meta');
  meta.append(el('span', 'lib-chip', scopeText(lesson)), el('span', null, ` ${dateText(lesson.at)} · `));
  const sessionId = lesson.sessionIds[0];
  if (sessionId) meta.append(button('Open the session', 'lib-link lsn-open', () => history.open().then(() => history.select(sessionId))));
  card.append(meta);
  const swap = (box: HTMLElement) => { card.querySelector('.lsn-add')?.remove(); card.append(box); };
  const add = button('Add to CLAUDE.md', 'lib-read lsn-add-button', () => swap(addBox(lesson, card)));
  add.disabled = !data?.allowed;
  if (add.disabled) add.title = 'Allow reading your Claude folder first';
  const row = actions(add);
  if (similar) row.append(button('Merge with similar', 'lib-confirm-cancel lsn-merge-button', () => swap(mergeBox(lesson, similar))));
  row.append(button('Dismiss', 'lib-confirm-cancel lsn-dismiss', async () => {
    const failed = errorOf(await window.pastel.library.dismissLesson(lesson.id));
    if (failed) { status.textContent = failed; return; }
    status.textContent = 'Dismissed. It won’t come back.';
    await load();
  }));
  card.append(row);
  return card;
}

function draw(): void {
  drawNotice();
  drawEmpty();
  const lessons = data?.lessons ?? [];
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const partner = new Map<string, Lesson>();
  for (const [a, b] of data?.similar ?? []) {
    const la = byId.get(a);
    const lb = byId.get(b);
    if (la && lb) { partner.set(a, lb); partner.set(b, la); }
  }
  cards.replaceChildren(...lessons.map((l) => makeCard(l, partner.get(l.id) ?? null)));
  onCount(lessons.length);
}

export async function load(): Promise<void> {
  const result = await window.pastel.library.lessons();
  data = isIpcError(result) ? { allowed: false, learn: false, lessons: [], similar: [] } : result;
  draw();
}

export const isOpen = (): boolean => !panel.hidden;
export function open(): void {
  panel.hidden = false;
  status.textContent = '';
  void load();
}
export const close = (): void => { panel.hidden = true; };

export const state = () => ({
  open: isOpen(),
  cards: [...cards.querySelectorAll<HTMLElement>('.lsn-card')].map((c) => ({
    id: c.dataset.id ?? '', rule: c.querySelector('.lsn-rule')?.textContent ?? '', merge: Boolean(c.querySelector('.lsn-merge-button')),
  })),
  diff: [...panel.querySelectorAll('.lsn-diff-line')].map((l) => l.textContent ?? ''),
  file: panel.querySelector('.lsn-add-file code')?.textContent ?? '',
  error: panel.querySelector('.lsn-error')?.textContent ?? '',
  status: status.textContent ?? '',
  empty: empty.hidden ? '' : empty.textContent ?? '',
});

window.pastel.library.onLessonsChanged(() => { if (isOpen()) void load(); else void window.pastel.library.lessons().then((r) => { if (!isIpcError(r)) onCount(r.lessons.length); }); });
