// Pictures in her message: a thumbnail per image path, its filename under it, a click opens it larger.
import { el, isIpcError } from './dom';
import { splitPromptImages } from '../shared/image-paths';
import type { PromptImage } from '../main/paste-image';

const CACHE_LIMIT = 40; // the reader redraws often; each picture is asked for once
const cache = new Map<string, Promise<PromptImage>>();

function load(file: string, prompt: string): Promise<PromptImage> {
  const key = `${file}\n${prompt}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const request = window.pastel.promptImage(file, prompt).then((result): PromptImage => (isIpcError(result) ? { status: 'refused' } : result));
  cache.set(key, request);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return request;
}

const fileName = (file: string): string => file.split('/').pop() || file;

function openLightbox(src: string, name: string, opener: HTMLElement): void {
  const box = el('div', 'image-lightbox');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', name);
  box.tabIndex = -1;
  const image = el('img', 'image-lightbox-image');
  image.src = src;
  image.alt = name;
  box.append(image);
  const close = () => {
    box.remove();
    document.removeEventListener('keydown', onKey, true);
    opener.focus({ preventScroll: true });
  };
  // Capture phase, so Esc closes only the picture and not History or an overlay behind it.
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  box.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.body.append(box);
  box.focus();
}

function show(figure: HTMLElement, file: string, raw: string, result: PromptImage): void {
  const name = fileName(file);
  if (result.status === 'refused') {
    // Not one Petal may show: the words stay as she wrote them, spaced from their neighbours.
    const before = figure.previousSibling?.textContent && !/\s$/.test(figure.previousSibling.textContent) ? ' ' : '';
    const after = figure.nextSibling?.textContent && !/^\s/.test(figure.nextSibling.textContent) ? ' ' : '';
    figure.replaceWith(`${before}${raw}${after}`);
    return;
  }
  if (result.status === 'missing') {
    const chip = el('span', 'prompt-image-missing', `Image no longer available · ${name}`);
    chip.title = file;
    figure.replaceChildren(chip);
    figure.dataset.state = 'missing';
    return;
  }
  const open = el('button', 'prompt-image-open');
  open.type = 'button';
  open.setAttribute('aria-label', `Open ${name}`);
  const thumb = el('img', 'prompt-image-thumb');
  thumb.alt = name;
  thumb.src = result.dataUrl;
  open.append(thumb);
  open.addEventListener('click', (event) => {
    event.stopPropagation();
    openLightbox(result.dataUrl, name, open);
  });
  figure.prepend(open);
  figure.dataset.state = 'shown';
}

function imageFigure(file: string, raw: string, prompt: string): HTMLElement {
  const figure = el('figure', 'prompt-image');
  figure.dataset.state = 'loading';
  const caption = el('figcaption', 'prompt-image-caption', fileName(file));
  caption.title = file;
  figure.append(caption);
  void load(file, prompt).then((result) => show(figure, file, raw, result));
  return figure;
}

// The text as nodes, each image path swapped for its picture; plain text when there are none.
export function withImages(text: string): (string | HTMLElement)[] {
  return splitPromptImages(text).map((part) => (part.kind === 'text' ? part.text : imageFigure(part.path, part.raw, text)));
}
