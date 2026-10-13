// Her message in a bubble: typed text as is, each pasted block quoted under a "Pasted" label, image paths as pictures.
// Text only, never HTML.
import { el } from './dom';
import { withImages } from './prompt-images';
import { parsePasted } from '../shared/pasted-content';

function textBlock(className: string, text: string): HTMLDivElement {
  const block = el('div', className);
  block.append(...withImages(text));
  return block;
}

function pastedBlock(text: string): HTMLDivElement {
  const block = el('div', 'prompt-pasted');
  block.append(el('span', 'prompt-pasted-label', 'Pasted'), textBlock('prompt-pasted-text', text));
  return block;
}

export function promptBubble(className: string, prompt: string): HTMLDivElement {
  const segments = parsePasted(prompt);
  if (!segments.some((s) => s.kind === 'pasted')) return textBlock(className, prompt);
  const bubble = el('div', className);
  bubble.append(...segments.map((s) => (s.kind === 'pasted' ? pastedBlock(s.text) : textBlock('prompt-typed', s.text))));
  return bubble;
}
