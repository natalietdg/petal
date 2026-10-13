// A reply is every text Claude wrote in one turn. A text that follows one with ## sections starts a block of its own,
// so it never lands inside the last section above, which starts folded.
import { marked, type Tokens } from 'marked';

const hasSections = (text: string): boolean =>
  marked.lexer(text).some((token) => token.type === 'heading' && (token as Tokens.Heading).depth === 2);

// breaks: where each later text starts in markdown (Reply.breaks); without them the reply is one block.
export function replyBlocks(markdown: string, breaks: readonly number[] = []): string[] {
  const starts = [0, ...breaks];
  const blocks: string[][] = [[]];
  starts.forEach((start, i) => {
    const text = markdown.slice(start, starts[i + 1] ?? markdown.length).trim();
    const current = blocks.at(-1) ?? [];
    const afterSections = current.length > 0 && hasSections(current.at(-1) ?? '');
    if (afterSections) blocks.push([text]);
    else current.push(text);
  });
  return blocks.map((block) => block.join('\n\n'));
}
