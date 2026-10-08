import DOMPurify from 'dompurify';
import { marked, type Token, type TokenizerAndRendererExtension } from 'marked';
import { parseStatusLine, STATUS_TITLES, type StatusKey } from '../shared/status-lines';

const LABELS: Record<string, string> = { 'done': 'done', 'why': 'why', 'watch out': 'watch', 'decide': 'decide', 'next': 'next' };

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ==text== becomes a highlighter <mark>.
const highlight: TokenizerAndRendererExtension = {
  name: 'highlight',
  level: 'inline',
  start: (src) => src.indexOf('=='),
  tokenizer(src) {
    const match = /^==(?=\S)([\s\S]*?\S)==/.exec(src);
    if (!match) return undefined;
    return { type: 'highlight', raw: match[0], tokens: this.lexer.inlineTokens(match[1] ?? '') };
  },
  renderer(token) {
    return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`;
  },
};

// A run of Doing / Recommend / Next lines becomes one block of labelled rows.
const STATUS_START = /\n[ \t]*(?:\*\*|__)?(?:doing|recommend|next)(?:\*\*|__)?\s*:/i;
interface StatusRow { key: StatusKey; tokens: Token[] }
const statusBlock: TokenizerAndRendererExtension = {
  name: 'statusBlock',
  level: 'block',
  start(src) {
    const match = STATUS_START.exec(src);
    return match ? match.index + 1 : undefined;
  },
  tokenizer(src) {
    if (!this.lexer.state.top) return undefined;
    let length = 0;
    const rows: StatusRow[] = [];
    for (const line of src.split('\n')) {
      const status = parseStatusLine(line);
      if (!status) break;
      length += line.length + 1;
      rows.push({ key: status.key, tokens: this.lexer.inlineTokens(status.text) });
    }
    const raw = src.slice(0, length);
    return rows.length ? { type: 'statusBlock', raw, rows } : undefined;
  },
  renderer(token) {
    const rows = (token.rows as StatusRow[]).map(({ key, tokens }) =>
      `<div class="status-row status-${key}"><span class="status-chip">${STATUS_TITLES[key]}</span><span class="status-text">${this.parser.parseInline(tokens)}</span></div>`);
    return `<div class="status-block">${rows.join('')}</div>`;
  },
};

marked.use({
  gfm: true,
  extensions: [highlight, statusBlock],
  renderer: { html: ({ text }) => escapeHtml(text) }, // raw HTML shows as text
});

const HEADLINE_LONG_CHARS = 70;
const HEADLINE_VERY_LONG_CHARS = 130;
const LEDE_MIN_CHARS = 160; // a drop cap needs a paragraph long enough to wrap around it

const textOf = (node: Node): string => (node.textContent ?? '').trim();
const isElement = (node: Node | null | undefined, name: string): node is HTMLElement => node?.nodeName === name;

function labelKey(strong: Node): string | null {
  return LABELS[textOf(strong).replace(/:$/, '').toLowerCase()] ?? null;
}

// A block whose first child is a label like **Decide:** becomes a tinted callout with a pill.
function tagCallouts(root: HTMLElement): void {
  for (const block of root.querySelectorAll('p, li')) {
    const first = block.firstChild;
    if (!first || first.nodeName !== 'STRONG') continue;
    const key = labelKey(first);
    if (!key) continue;

    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = textOf(first).replace(/:$/, '');
    first.replaceWith(pill);
    const after = pill.nextSibling;
    if (after?.nodeType === Node.TEXT_NODE) after.textContent = (after.textContent ?? '').replace(/^:?\s*/, ' ');
    block.classList.add('callout', `callout-${key}`);
  }
}

// An opening paragraph that is bold all the way through reads as the headline.
// One that only starts bold ("**Abstract.** Hi…") is body text, not a headline.
function tagHeadline(root: HTMLElement): void {
  const first = root.firstElementChild;
  const bold = isElement(first, 'P') && first.firstChild?.nodeName === 'STRONG' ? first.firstChild : null;
  if (!first || !bold || textOf(bold) !== textOf(first)) return;
  first.classList.add('headline');
  // A long headline steps down a size so it never fills the screen.
  const length = textOf(first).length;
  if (length > HEADLINE_VERY_LONG_CHARS) first.classList.add('headline-very-long');
  else if (length > HEADLINE_LONG_CHARS) first.classList.add('headline-long');
}

const BACK_MATTER = /^(references|limitations|sources)$/i;
function tagBackMatter(root: HTMLElement): void {
  for (const h of root.querySelectorAll('h2')) if (BACK_MATTER.test(textOf(h))) h.classList.add('back-matter');
}

// Magazine parts: a blockquote opening with a bold title is a sidebar box, any other is a pull quote.
function tagQuotes(root: HTMLElement): void {
  for (const quote of root.querySelectorAll('blockquote')) {
    const first = quote.firstElementChild;
    const titled = isElement(first, 'P') && first.firstChild?.nodeName === 'STRONG';
    quote.classList.add(titled ? 'sidebar' : 'pull-quote');
  }
}

const isPlainParagraph = (node: Element): boolean => node.nodeName === 'P' && !node.classList.contains('callout')
  && !(node.childElementCount === 1 && node.firstElementChild?.nodeName === 'EM' && textOf(node) === textOf(node.firstElementChild));

// Lede: the first plain paragraph after the dek, which gets the drop cap.
function tagLede(root: HTMLElement): void {
  const dek = root.querySelector(':scope > .headline')?.nextElementSibling;
  if (dek?.nodeName !== 'P') return;
  for (let node = dek.nextElementSibling; node; node = node.nextElementSibling) {
    if (node.nodeName === 'H2' || node.nodeName === 'H3' || node.classList.contains('status-block')) continue;
    // A drop cap needs room: on a one- or two-line opener it hangs below the text.
    if (isPlainParagraph(node) && textOf(node).length >= LEDE_MIN_CHARS) node.classList.add('lede');
    return;
  }
}

// End mark on the story's last paragraph, before any back matter.
function tagEnd(root: HTMLElement): void {
  let node = root.querySelector(':scope > h2.back-matter')?.previousElementSibling ?? root.lastElementChild;
  while (node && !isPlainParagraph(node)) node = node.previousElementSibling;
  if (node && !node.classList.contains('headline')) node.classList.add('end-mark');
}

// Wrap headline + dek in a header and each h2 with its content in a section, so looks can style them as blocks.
function wrapStory(root: HTMLElement): void {
  const headline = root.querySelector(':scope > .headline');
  if (headline) {
    const head = document.createElement('header');
    head.className = 'story-head';
    const dek = headline.nextElementSibling?.nodeName === 'P' ? headline.nextElementSibling : null;
    headline.before(head);
    head.append(headline, ...(dek ? [dek] : []));
  }
  for (const h2 of [...root.querySelectorAll(':scope > h2')]) {
    // "1. Title": keep the number but wrap it, so a look can swap it for its own numbering.
    const lead = h2.firstChild;
    const number = lead?.nodeType === Node.TEXT_NODE ? /^\s*\d+\.\s+/.exec(lead.textContent ?? '') : null;
    if (lead && number) {
      lead.textContent = (lead.textContent ?? '').slice(number[0].length);
      const span = document.createElement('span');
      span.className = 'h-num';
      span.textContent = `${number[0].trim()} `;
      h2.prepend(span);
    }
    const section = document.createElement('section');
    section.className = h2.classList.contains('back-matter') ? 'story-section back' : 'story-section';
    h2.before(section);
    const body = document.createElement('div');
    body.className = 'section-body';
    const rail = document.createElement('aside');
    rail.className = 'rail';
    section.append(h2, body);
    for (let node = section.nextElementSibling; node && node.nodeName !== 'H2';) {
      const next = node.nextElementSibling;
      (node.matches('blockquote.pull-quote, blockquote.sidebar') ? rail : body).append(node);
      node = next;
    }
    if (rail.childElementCount) section.append(rail);
  }
}

export function render(markdownText: string): HTMLDivElement {
  const html = DOMPurify.sanitize(marked.parse(markdownText, { async: false }), { FORBID_ATTR: ['style'] });
  const root = document.createElement('div');
  root.className = 'prose';
  root.innerHTML = html;
  tagCallouts(root);
  tagHeadline(root); // after callouts, so a leading label is never the headline
  tagBackMatter(root);
  tagQuotes(root);
  tagLede(root);
  tagEnd(root);
  wrapStory(root); // last: the taggers above look at top-level siblings
  return root;
}
