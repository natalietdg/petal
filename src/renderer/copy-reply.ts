// DOM-free, so the node test suite can check it: a rendered reply, captured as plain nodes, becomes paste-ready HTML.
// Each element keeps only the whitelisted styles below, written inline, so Docs, Notion, Gmail and Pages keep the look.

export type StyleMap = Readonly<Record<string, string>>;
export interface CopyText { text: string }
export interface CopyElement { tag: string; attrs: StyleMap; style: StyleMap; children: CopyNode[] }
export type CopyNode = CopyText | CopyElement;

// Passed down from parent to child, so a child writes one only where it differs from its parent.
const INHERITED = [
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-transform', 'text-align', 'white-space', 'list-style-type', 'border-collapse',
] as const;
// Set on the element itself; written only when not the browser default.
const OWN = [
  'background-color', 'background-image', 'text-decoration',
  'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius',
  'padding', 'margin-top', 'margin-bottom',
] as const;
export const COPIED_STYLES: readonly string[] = [...INHERITED, ...OWN];

const INHERITED_SET = new Set<string>(INHERITED);
const BLANK = new Set(['', 'none', 'normal', 'auto', 'transparent', 'rgba(0, 0, 0, 0)']);
const SECTION_PADDING = '24px 28px';
const FRAME_STYLES = ['color', 'font-family', 'font-size', 'line-height'];

// "0px", "0px 0px", "0px none rgb(…)" (no border) and "none solid rgb(…)" (no underline) all mean nothing to write.
const isBlank = (value: string): boolean =>
  BLANK.has(value) || value.split(' ').every((part) => part === '0px') || /^(0px|none)\s/.test(value);

// Only portable links and pictures survive: a petal:// thumbnail means nothing in another app.
const KEPT_ATTRS: Record<string, (value: string) => boolean> = {
  href: (v) => /^(https?:|mailto:)/i.test(v),
  src: (v) => /^(https?:|data:image\/)/i.test(v),
  alt: () => true,
  width: (v) => /^\d+(\.\d+)?$/.test(v),
  height: (v) => /^\d+(\.\d+)?$/.test(v),
  colspan: (v) => /^\d+$/.test(v),
  rowspan: (v) => /^\d+$/.test(v),
  start: (v) => /^\d+$/.test(v),
};
const VOID_TAGS = new Set(['img', 'br', 'hr']);
const RENAMED: Record<string, string> = { button: 'span' }; // step badges and thread cards keep their text, lose the control

const escapeText = (text: string): string => text.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
const escapeAttr = (text: string): string => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// The style attribute for one element: whitelisted, inherited ones only where they change, own ones only when set.
export function inlineStyle(style: StyleMap, parent: StyleMap): string {
  return COPIED_STYLES
    .map((name) => [name, (style[name] ?? '').trim()] as const)
    .filter(([name, value]) => value && (INHERITED_SET.has(name) ? value !== (parent[name] ?? '').trim() : !isBlank(value)))
    .map(([name, value]) => `${name}: ${value}`)
    .join('; ');
}

function attrsHtml(node: CopyElement): string {
  return Object.entries(node.attrs)
    .filter(([name, value]) => KEPT_ATTRS[name]?.(value))
    .map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
    .join('');
}

// What a child inherits: the parent's look with this element's own inherited values on top.
const inheritedFrom = (parent: StyleMap, style: StyleMap): StyleMap =>
  Object.fromEntries(INHERITED.map((name) => [name, style[name] || parent[name] || '']));

export function nodeHtml(node: CopyNode, parent: StyleMap): string {
  if ('text' in node) return escapeText(node.text);
  const tag = RENAMED[node.tag] ?? node.tag;
  if (tag === 'img' && !KEPT_ATTRS.src?.(node.attrs.src ?? '')) return escapeText(node.attrs.alt ?? '');
  const css = inlineStyle(node.style, parent);
  const open = `<${tag}${attrsHtml(node)}${css ? ` style="${escapeAttr(css)}"` : ''}>`;
  if (VOID_TAGS.has(tag)) return open;
  const inner = node.children.map((child) => nodeHtml(child, inheritedFrom(parent, node.style))).join('');
  return `${open}${inner}</${tag}>`;
}

// frame: the page behind the reply (its painted background) and the reply column's text look.
export interface CopyFrame { background: string; style: StyleMap }

// The whole reply as one section: a tinted box holding every rendered block; plain text is the markdown as Claude wrote it.
export function replyClipboard(blocks: readonly CopyNode[], markdown: string, frame: CopyFrame): { html: string; text: string } {
  const base = Object.fromEntries(FRAME_STYLES.map((name) => [name, frame.style[name] ?? '']));
  const wrapper = { ...base, 'background-color': frame.background, padding: SECTION_PADDING };
  const css = Object.entries(wrapper).filter(([, value]) => value).map(([name, value]) => `${name}: ${value}`).join('; ');
  const inner = blocks.map((block) => nodeHtml(block, base)).join('');
  return { html: `<div style="${escapeAttr(css)}">${inner}</div>`, text: markdown };
}
