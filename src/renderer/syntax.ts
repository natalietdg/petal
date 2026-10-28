// Syntax colours for code: the Code review diff and fenced blocks in replies share one highlighter and palette.
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import python from 'highlight.js/lib/languages/python';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

for (const [name, language] of Object.entries({ bash, css, go, javascript, json, kotlin, python, swift, typescript, xml })) hljs.registerLanguage(name, language);

const MIN_GUESS_RELEVANCE = 5; // below this, a diff's language guess is noise; leave it plain

// Each language's aliases cover its extensions (ts, py, kt, sh, html...); anything else stays plain.
export function languageFor(file: string): string | null {
  const ext = /\.([\w]+)$/.exec(file)?.[1]?.toLowerCase();
  return ext && hljs.getLanguage(ext) ? ext : null;
}

// Highlighted HTML per line: open spans are closed at each newline and reopened on the next, so a block comment stays coloured.
export function highlightedLines(text: string, language: string): string[] {
  const html = hljs.highlight(text.replace(/\n$/, ''), { language, ignoreIllegals: true }).value;
  const lines: string[] = [];
  const open: string[] = [];
  let line = '';
  for (const part of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (part === '\n') { lines.push(line + '</span>'.repeat(open.length)); line = open.join(''); }
    else if (part.startsWith('<span')) { open.push(part); line += part; }
    else if (part === '</span>') { open.pop(); line += part; }
    else line += part;
  }
  lines.push(line);
  return lines;
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

type DiffKind = 'add' | 'del' | 'same' | 'meta';
const diffKind = (line: string): DiffKind =>
  /^(@@|\+\+\+ |--- |diff |index )/.test(line) ? 'meta' : line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'same';

// A ```diff block: each line tinted by its sign, and the code after the sign coloured in the language it looks like.
function diffHtml(source: string): string {
  const lines = source.replace(/\n$/, '').split('\n');
  const kinds = lines.map(diffKind);
  const codeLines = lines.filter((_, i) => kinds[i] !== 'meta').map((line) => (/^[+\- ]/.test(line) ? line.slice(1) : line));
  const guess = hljs.highlightAuto(codeLines.join('\n'));
  const coloured = guess.language && guess.relevance >= MIN_GUESS_RELEVANCE ? highlightedLines(codeLines.join('\n'), guess.language) : codeLines.map(escapeHtml);
  let next = 0;
  return lines.map((line, i) => {
    const kind = kinds[i];
    if (kind === 'meta') return `<span class="code-line code-meta">${escapeHtml(line)}</span>`;
    const sign = /^[+\- ]/.test(line) ? line[0] : ' ';
    return `<span class="code-line code-${kind}"><span class="code-sign">${sign}</span>${coloured[next++] || ' '}</span>`;
  }).join('');
}

// Fenced blocks in a rendered reply: ```diff gets add/remove tints, a known language gets token colours, the rest stays plain.
// Mermaid is left for diagrams.ts. hljs escapes the source text, so its markup is safe to insert.
export function highlightCodeBlocks(root: ParentNode): void {
  for (const code of root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')) {
    const language = /\blanguage-(\S+)/.exec(code.className)?.[1]?.toLowerCase() ?? '';
    const source = code.textContent ?? '';
    if (language === 'diff' || language === 'patch') {
      code.innerHTML = diffHtml(source);
      code.classList.add('code-syntax', 'code-diff');
    } else if (language !== 'mermaid' && hljs.getLanguage(language)) {
      code.innerHTML = hljs.highlight(source, { language, ignoreIllegals: true }).value;
      code.classList.add('code-syntax');
    }
  }
}
