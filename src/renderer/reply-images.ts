// Pictures in Claude's replies: a Markdown image or an image path becomes a thumbnail with its filename,
// Show in Finder and Open; a click opens it larger. Bytes come only through petal-img:// (main/reply-image.ts).
import { el, isIpcError } from './dom';
import { IMAGE_EXTENSION, findImageRefs } from '../shared/image-paths';
import { replyImageUrl, type ReplyImageStatus } from '../shared/reply-image-url';

const REMOTE = /^https?:\/\//i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// A relative path in prose needs a folder in it ("docs/shot.png"), so a bare "logo.png" stays words.
const RELATIVE_IN_TEXT = /(?<=^|[\s(])(?:\.{1,2}\/)?[\w@+-][\w@.+-]*(?:\/[\w@.+-]+)+\.(?:png|jpe?g|gif|webp)(?=$|[\s),.;:!?])/gi;
const SKIP_TEXT_IN = 'a, code, pre, figure, .reply-image, .status-block';
const BLOCKS = 'p, li, td, th, h1, h2, h3, h4, h5, h6, dd, dt, blockquote';
const INSIDE_BLOCKS = new Set(['LI', 'TD', 'TH', 'DD', 'BLOCKQUOTE']); // the picture goes at the end inside these, after the others

const fileName = (file: string): string => file.replace(/\/+$/, '').split('/').pop() || file;

// Inline code that is a whole image path: absolute, ~/, relative or file:.
function codePath(text: string): string | null {
  const path = text.trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!path || /\n/.test(path) || !IMAGE_EXTENSION.test(path)) return null;
  if (SCHEME.test(path) && !/^file:/i.test(path)) return null;
  return path;
}

// Image paths in one text node, in order: absolute and ~/ the way her bubbles read them, plus relative ones with a folder.
function textPaths(text: string): string[] {
  const found = findImageRefs(text).map((ref) => ({ at: ref.start, path: ref.path }));
  RELATIVE_IN_TEXT.lastIndex = 0;
  for (let match = RELATIVE_IN_TEXT.exec(text); match; match = RELATIVE_IN_TEXT.exec(text)) found.push({ at: match.index, path: match[0] });
  return found.sort((a, b) => a.at - b.at).map((f) => f.path);
}

// ---- One picture ----

function chip(figure: HTMLElement, path: string, status: ReplyImageStatus): void {
  const name = fileName(path);
  const text = status.status === 'refused' ? `image not shown: ${name}` : `image not found: ${name}`;
  const why = status.status === 'refused'
    ? status.reason === 'claude-folder' ? 'In your Claude folder, which Petal reads only once you allow it' : 'Outside your home folder and this session’s folder'
    : path;
  const note = el('span', 'reply-image-missing', text);
  note.title = why;
  figure.replaceChildren(note);
  figure.dataset.state = status.status === 'refused' ? 'refused' : 'missing';
}

async function explainFailure(figure: HTMLElement, path: string, cwd: string | null): Promise<void> {
  const result = await window.pastel.replyImage.status(path, cwd).catch(() => null);
  const status: ReplyImageStatus = !result || isIpcError(result) ? { status: 'missing' } : result;
  chip(figure, path, status.status === 'ok' ? { status: 'missing' } : status); // ok here means it vanished between the two asks
}

function actionButton(label: string, run: () => Promise<unknown>): HTMLButtonElement {
  const button = el('button', 'reply-image-action', label);
  button.type = 'button';
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    void run();
  });
  return button;
}

function imageFigure(path: string, alt: string, cwd: string | null): HTMLElement {
  const name = fileName(path);
  const figure = el('figure', 'reply-image');
  figure.dataset.state = 'loading';
  figure.dataset.path = path;
  const open = el('button', 'reply-image-open');
  open.type = 'button';
  open.setAttribute('aria-label', `Open ${name} larger`);
  const thumb = el('img', 'reply-image-thumb');
  thumb.alt = alt || name;
  thumb.loading = 'lazy';
  thumb.decoding = 'async';
  thumb.src = replyImageUrl(path, cwd);
  thumb.addEventListener('load', () => { figure.dataset.state = 'shown'; }, { once: true });
  thumb.addEventListener('error', () => void explainFailure(figure, path, cwd), { once: true });
  open.append(thumb);
  open.addEventListener('click', (event) => {
    event.stopPropagation();
    openLightbox(figure);
  });
  const caption = el('figcaption', 'reply-image-bar');
  const label = el('span', 'reply-image-name', name);
  label.title = path;
  caption.append(label,
    actionButton('Show in Finder', () => window.pastel.replyImage.reveal(path, cwd)),
    actionButton('Open', () => window.pastel.replyImage.open(path, cwd)));
  figure.append(open, caption);
  return figure;
}

// ---- Lightbox: Esc closes, arrows step through this reply's pictures ----

const groupOf = (figure: HTMLElement): HTMLElement[] => {
  const reply = figure.closest<HTMLElement>('.older-turn, #latest, .history-turn') ?? figure.closest<HTMLElement>('.prose') ?? figure;
  return [...reply.querySelectorAll<HTMLElement>('figure.reply-image')].filter((f) => f.dataset.state === 'shown' || f.dataset.state === 'loading');
};

function openLightbox(start: HTMLElement): void {
  const group = groupOf(start);
  let index = Math.max(0, group.indexOf(start));
  const opener = start.querySelector<HTMLElement>('.reply-image-open');

  const box = el('div', 'reply-lightbox');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.tabIndex = -1;
  const image = el('img', 'reply-lightbox-image');
  const caption = el('p', 'reply-lightbox-caption');
  caption.setAttribute('aria-live', 'polite');
  const prev = el('button', 'reply-lightbox-step reply-lightbox-prev', '‹');
  const next = el('button', 'reply-lightbox-step reply-lightbox-next', '›');
  const closeButton = el('button', 'reply-lightbox-close', '×');
  prev.setAttribute('aria-label', 'Previous picture');
  next.setAttribute('aria-label', 'Next picture');
  closeButton.setAttribute('aria-label', 'Close');
  for (const button of [prev, next, closeButton]) button.type = 'button';
  const several = group.length > 1;
  prev.hidden = !several;
  next.hidden = !several;
  box.append(image, caption, prev, next, closeButton);

  const show = (at: number) => {
    index = (at + group.length) % group.length;
    const thumb = group[index]?.querySelector<HTMLImageElement>('img.reply-image-thumb');
    const name = fileName(group[index]?.dataset.path ?? '');
    image.src = thumb?.src ?? '';
    image.alt = thumb?.alt ?? name;
    caption.textContent = several ? `${name} · ${index + 1} of ${group.length}` : name;
    box.setAttribute('aria-label', name);
  };
  const close = () => {
    box.remove();
    document.removeEventListener('keydown', onKey, true);
    opener?.focus({ preventScroll: true });
  };
  // Capture phase, so Esc and the arrows act here and not on History, focus mode or the reader behind.
  const onKey = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (event.key === 'Escape') close();
    else if (step && several) show(index + step);
    else if (event.key === 'Tab') trapTab(event, box);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  prev.addEventListener('click', (event) => { event.stopPropagation(); show(index - 1); });
  next.addEventListener('click', (event) => { event.stopPropagation(); show(index + 1); });
  closeButton.addEventListener('click', (event) => { event.stopPropagation(); close(); });
  image.addEventListener('click', (event) => event.stopPropagation());
  box.addEventListener('click', close); // the veil around the picture
  document.addEventListener('keydown', onKey, true);
  show(index);
  document.body.append(box);
  box.focus();
}

// Tab stays on the lightbox's own buttons while it is open.
function trapTab(event: KeyboardEvent, box: HTMLElement): void {
  const buttons = [...box.querySelectorAll<HTMLButtonElement>('button:not([hidden])')];
  if (!buttons.length) return;
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const step = event.shiftKey ? -1 : 1;
  buttons[(at + step + buttons.length) % buttons.length]?.focus();
}

// ---- Finding the pictures in a rendered reply ----

// Under the block that names it; several from one paragraph stay in the order they were named.
function placeAfter(anchor: Element, figure: HTMLElement, root: HTMLElement): void {
  const block = anchor.closest(BLOCKS);
  if (!block || !root.contains(block)) {
    root.append(figure);
    return;
  }
  if (INSIDE_BLOCKS.has(block.nodeName)) {
    block.append(figure);
    return;
  }
  let last: Element = block;
  while (last.nextElementSibling?.matches('figure.reply-image[data-named]')) last = last.nextElementSibling;
  figure.dataset.named = '';
  last.after(figure);
}

// A remote image stays a link, never loaded; any other scheme keeps only its words.
function replaceRemote(img: HTMLImageElement, src: string): void {
  const alt = img.getAttribute('alt') ?? '';
  if (REMOTE.test(src)) {
    const link = el('a', 'reply-image-link', alt || src);
    link.href = src;
    img.replaceWith(link);
  } else img.replaceWith(alt);
}

// root: one rendered reply (.prose); cwd: the session's folder, for relative paths.
export function inlineImages(root: HTMLElement, cwd: string | null): void {
  const shown = new Map<Element, Set<string>>(); // block -> paths already pictured there
  const seen = (anchor: Element, path: string): boolean => {
    const block = anchor.closest(BLOCKS) ?? root;
    const paths = shown.get(block) ?? new Set<string>();
    shown.set(block, paths);
    if (paths.has(path)) return true;
    paths.add(path);
    return false;
  };

  for (const img of [...root.querySelectorAll<HTMLImageElement>('img')]) {
    const src = img.getAttribute('src') ?? '';
    img.removeAttribute('src'); // nothing loads from Claude's own src; the thumbnail asks petal-img://
    if (!src || (SCHEME.test(src) && !/^file:/i.test(src))) {
      replaceRemote(img, src);
      continue;
    }
    const block = img.closest(BLOCKS);
    const figure = imageFigure(src, img.getAttribute('alt') ?? '', cwd);
    seen(img, src);
    if (block && block.nodeName === 'P' && block.textContent?.trim() === (img.getAttribute('alt') ?? '').trim() && block.querySelectorAll('img').length === 1) {
      block.replaceWith(figure); // an image on its own line takes the paragraph's place
    } else img.replaceWith(figure);
  }

  for (const code of [...root.querySelectorAll<HTMLElement>('code')]) {
    if (code.closest('pre')) continue;
    const path = codePath(code.textContent ?? '');
    if (path && !seen(code, path)) placeAfter(code, imageFigure(path, '', cwd), root);
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest(SKIP_TEXT_IN) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
  for (const text of texts) {
    const anchor = text.parentElement;
    if (!anchor) continue;
    for (const path of textPaths(text.data)) if (!seen(anchor, path)) placeAfter(anchor, imageFigure(path, '', cwd), root);
  }
}
