// Copy on each rendered reply: the whole reply as one styled section (text/html) plus its markdown (text/plain).
import { el } from './dom';
import { COPIED_STYLES, replyClipboard, type CopyElement, type CopyNode, type StyleMap } from './copy-reply';

const COPIED_MS = 1600;
const CONTROLS = '.fold-toggle, .fold-all, .fold-bar, .reply-image-action, .thread-ask, .reply-copy-bar'; // buttons with nothing to read
const NO_PAINT = new Set(['', 'transparent', 'rgba(0, 0, 0, 0)']);

const pick = (css: CSSStyleDeclaration, names: readonly string[]): StyleMap =>
  Object.fromEntries(names.map((name) => [name, css.getPropertyValue(name)]));

// The colour actually painted behind the reply: its own, or the nearest ancestor's.
function paintedBackground(node: Element): string {
  for (let at: Element | null = node; at; at = at.parentElement) {
    const colour = getComputedStyle(at).backgroundColor;
    if (!NO_PAINT.has(colour)) return colour;
  }
  return '';
}

// A drawn diagram travels as a picture; a PNG pastes almost everywhere, the SVG is the fallback.
function diagramImage(svg: SVGSVGElement, later: Promise<void>[]): CopyElement {
  const { width, height } = svg.getBoundingClientRect();
  const source = new XMLSerializer().serializeToString(svg);
  const image: CopyElement = {
    tag: 'img',
    attrs: { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`, alt: 'Diagram', width: String(Math.round(width)), height: String(Math.round(height)) },
    style: {},
    children: [],
  };
  later.push(pngOf(source, width, height).then((png) => { if (png) image.attrs = { ...image.attrs, src: png }; }));
  return image;
}

// Null when the canvas refuses (a diagram with HTML labels taints it).
function pngOf(source: string, width: number, height: number): Promise<string | null> {
  return new Promise((resolve) => {
    const picture = new Image();
    picture.onload = () => {
      try {
        const scale = window.devicePixelRatio || 1;
        const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(width * scale), height: Math.round(height * scale) });
        canvas.getContext('2d')?.drawImage(picture, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    picture.onerror = () => resolve(null);
    picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  });
}

function capture(node: Node, later: Promise<void>[]): CopyNode | null {
  if (node.nodeType === Node.TEXT_NODE) return { text: node.textContent ?? '' };
  if (!(node instanceof Element) || node.matches(CONTROLS)) return null;
  const css = getComputedStyle(node);
  if (css.display === 'none' || css.visibility === 'hidden') return null;
  if (node instanceof SVGSVGElement) return diagramImage(node, later);
  const attrs = Object.fromEntries([...node.attributes].map((a) => [a.name, a.value]));
  const children = [...node.childNodes].map((child) => capture(child, later)).filter((child): child is CopyNode => child !== null);
  return { tag: node.tagName.toLowerCase(), attrs, style: pick(css, COPIED_STYLES), children };
}

// Folded sections open just long enough to be read; all synchronous, so nothing flickers on screen.
function captureUnfolded(blocks: readonly HTMLElement[], later: Promise<void>[]): CopyNode[] {
  const folded = blocks.flatMap((block) => [...block.querySelectorAll('.story-section.folded')]);
  folded.forEach((section) => section.classList.remove('folded'));
  try {
    return blocks.map((block) => capture(block, later)).filter((node): node is CopyNode => node !== null);
  } finally {
    folded.forEach((section) => section.classList.add('folded'));
  }
}

export async function replyPayload(blocks: readonly HTMLElement[], markdown: string): Promise<{ html: string; text: string }> {
  const first = blocks[0];
  if (!first) return { html: '', text: markdown };
  const later: Promise<void>[] = [];
  const nodes = captureUnfolded(blocks, later);
  await Promise.all(later);
  const frame = { background: paintedBackground(first), style: pick(getComputedStyle(first), COPIED_STYLES) };
  return replyClipboard(nodes, markdown, frame);
}

// The copy event lets the page set both formats itself, so no IPC channel is needed when the async API refuses.
function copyEventWrite(html: string, text: string): boolean {
  let wrote = false;
  const onCopy = (event: ClipboardEvent): void => {
    if (!event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData('text/html', html);
    event.clipboardData.setData('text/plain', text);
    wrote = true;
  };
  document.addEventListener('copy', onCopy, { once: true });
  const ran = document.execCommand('copy');
  document.removeEventListener('copy', onCopy);
  return ran && wrote;
}

async function writeClipboard({ html, text }: { html: string; text: string }): Promise<boolean> {
  const item = new ClipboardItem({
    'text/html': new Blob([html], { type: 'text/html' }),
    'text/plain': new Blob([text], { type: 'text/plain' }),
  });
  return navigator.clipboard.write([item]).then(() => true, () => copyEventWrite(html, text));
}

// blocks: read at click time, so a reply that redrew while streaming copies what is on screen now.
export function copyReplyBar(markdown: string, blocks: () => readonly HTMLElement[]): HTMLDivElement {
  const bar = el('div', 'reply-copy-bar');
  const button = el('button', 'reply-copy', 'Copy');
  button.type = 'button';
  button.title = 'Copy this reply with its colours and fonts';
  button.setAttribute('aria-label', 'Copy this reply with its formatting');
  button.addEventListener('click', async () => {
    const copied = await replyPayload(blocks(), markdown).then(writeClipboard, () => false);
    button.textContent = copied ? 'Copied' : 'Copy failed';
    setTimeout(() => { button.textContent = 'Copy'; }, COPIED_MS);
  });
  bar.append(button);
  return bar;
}
