// Her message in a bubble: typed text as is, each pasted block quoted under a "Pasted" label. Text only, never HTML.
import { el } from './dom';
import { parsePasted } from '../shared/pasted-content';

function pastedBlock(text: string): HTMLDivElement {
  const block = el('div', 'prompt-pasted');
  block.append(el('span', 'prompt-pasted-label', 'Pasted'), el('div', 'prompt-pasted-text', text));
  return block;
}

export function promptBubble(className: string, prompt: string): HTMLDivElement {
  const segments = parsePasted(prompt);
  if (!segments.some((s) => s.kind === 'pasted')) return el('div', className, prompt);
  const bubble = el('div', className);
  bubble.append(...segments.map((s) => (s.kind === 'pasted' ? pastedBlock(s.text) : el('div', 'prompt-typed', s.text))));
  return bubble;
}
