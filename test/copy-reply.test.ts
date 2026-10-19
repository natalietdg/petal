import { describe, expect, it } from 'vitest';
import { COPIED_STYLES, inlineStyle, nodeHtml, replyClipboard, type CopyElement, type CopyNode, type StyleMap } from '../src/renderer/copy-reply';

const node = (tag: string, style: StyleMap, children: CopyNode[] = [], attrs: StyleMap = {}): CopyElement => ({ tag, attrs, style, children });
const text = (value: string): CopyNode => ({ text: value });

const BODY = { color: 'rgb(20, 20, 20)', 'font-family': '"Newsreader Variable", Georgia, serif', 'font-size': '20px', 'line-height': '32px' };
const FRAME = { background: 'rgb(255, 247, 244)', style: BODY };
const MARKDOWN = '**Headline.**\n\n## Where it stands\n\nPlain ==marked== text.\n';

describe('copy reply: inline styles', () => {
  it('keeps only whitelisted properties', () => {
    const css = inlineStyle({ color: 'rgb(1, 2, 3)', position: 'absolute', display: 'grid', 'grid-template-columns': '1fr 1fr', 'background-color': 'rgb(9, 9, 9)' }, {});
    expect(css).toBe('color: rgb(1, 2, 3); background-color: rgb(9, 9, 9)');
    expect(COPIED_STYLES).not.toContain('position');
  });

  it('writes an inherited property only where it differs from the parent', () => {
    expect(inlineStyle({ color: 'rgb(20, 20, 20)', 'font-size': '20px' }, BODY)).toBe('');
    expect(inlineStyle({ color: 'rgb(200, 0, 80)', 'font-size': '20px' }, BODY)).toBe('color: rgb(200, 0, 80)');
  });

  it('drops own properties left at their defaults', () => {
    const css = inlineStyle({
      'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none', padding: '0px 0px',
      'border-top': '0px none rgb(20, 20, 20)', 'text-decoration': 'none solid rgb(20, 20, 20)', 'margin-top': '0px',
      'border-left': '4px solid rgb(120, 80, 200)',
    }, {});
    expect(css).toBe('border-left: 4px solid rgb(120, 80, 200)');
  });
});

describe('copy reply: html', () => {
  it('strips classes, ids and data attributes, keeps portable links', () => {
    const link = node('a', {}, [text('docs')], { class: 'bare-link', id: 'x', 'data-k': '1', href: 'https://example.com/a', title: 't' });
    expect(nodeHtml(link, {})).toBe('<a href="https://example.com/a">docs</a>');
    const local = node('a', {}, [text('file')], { href: 'petal://reply-image/x.png' });
    expect(nodeHtml(local, {})).toBe('<a>file</a>');
  });

  it('turns a picture with a local source into its alt text, and keeps a data image', () => {
    expect(nodeHtml(node('img', {}, [], { src: 'petal-image://x.png', alt: 'plot.png' }), {})).toBe('plot.png');
    expect(nodeHtml(node('img', {}, [], { src: 'data:image/png;base64,AAA', alt: 'Diagram', width: '320' }), {}))
      .toBe('<img src="data:image/png;base64,AAA" alt="Diagram" width="320">');
  });

  it('keeps a button’s text as a span and escapes text', () => {
    expect(nodeHtml(node('button', {}, [text('1')]), {})).toBe('<span>1</span>');
    expect(nodeHtml(node('p', {}, [text('<b>&</b>')]), {})).toBe('<p>&#60;b&#62;&#38;&#60;/b&#62;</p>');
  });

  it('escapes quotes in font names inside the style attribute', () => {
    expect(nodeHtml(node('p', { 'font-family': '"Fraunces Variable", serif' }), {})).toBe('<p style="font-family: &#34;Fraunces Variable&#34;, serif"></p>');
  });
});

describe('copy reply: the whole reply as one section', () => {
  const prose = node('div', BODY, [
    node('p', { ...BODY, 'font-weight': '700' }, [text('Headline.')]),
    node('section', BODY, [
      node('h2', { ...BODY, color: 'rgb(150, 40, 90)', 'font-family': '"Fraunces Variable", serif', 'font-size': '28px' }, [text('Where it stands')]),
      node('p', BODY, [text('Plain '), node('mark', { ...BODY, 'background-color': 'rgb(255, 230, 120)' }, [text('marked')]), text(' text.')]),
    ]),
  ]);
  const { html, text: plain } = replyClipboard([prose], MARKDOWN, FRAME);

  it('wraps it in one box carrying the page background and body text look', () => {
    expect(html.startsWith('<div style="color: rgb(20, 20, 20); font-family: &#34;Newsreader Variable&#34;, Georgia, serif; font-size: 20px; line-height: 32px; background-color: rgb(255, 247, 244); padding: 24px 28px">')).toBe(true);
    expect(html.endsWith('</div>')).toBe(true);
  });

  it('gives the heading its own colour and font, and the highlight its background', () => {
    expect(html).toContain('<h2 style="color: rgb(150, 40, 90); font-family: &#34;Fraunces Variable&#34;, serif; font-size: 28px">Where it stands</h2>');
    expect(html).toContain('<mark style="background-color: rgb(255, 230, 120)">marked</mark>');
    expect(html).toContain('<p style="font-weight: 700">Headline.</p>');
  });

  it('plain text is the markdown exactly as Claude wrote it', () => {
    expect(plain).toBe(MARKDOWN);
  });
});
