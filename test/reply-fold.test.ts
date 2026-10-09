import { describe, expect, it } from 'vitest';
import { allOpen, isOpen, layoutReply, newFold, setAll, toggleSection, type BlockKind } from '../src/shared/reply-fold';

const reorder = (blocks: BlockKind[]): BlockKind[] => layoutReply(blocks).order.map((i) => blocks[i] as BlockKind);

describe('layoutReply', () => {
  it('leaves a reply without ## sections exactly as written', () => {
    const blocks: BlockKind[] = ['headline', 'paragraph', 'other', 'paragraph', 'strip'];
    expect(layoutReply(blocks)).toEqual({ order: [0, 1, 2, 3, 4], sections: 0 });
  });

  it('moves a strip from the end, after References, up under the abstract', () => {
    const blocks: BlockKind[] = ['headline', 'paragraph', 'heading', 'paragraph', 'heading', 'other', 'strip'];
    expect(layoutReply(blocks)).toEqual({ order: [0, 1, 6, 2, 3, 4, 5], sections: 2 });
  });

  it('pulls a strip out of the middle of a section', () => {
    const blocks: BlockKind[] = ['headline', 'paragraph', 'heading', 'paragraph', 'strip', 'paragraph'];
    expect(reorder(blocks)).toEqual(['headline', 'paragraph', 'strip', 'heading', 'paragraph', 'paragraph']);
  });

  it('puts the strip ahead of the rest of the intro, right after headline and abstract', () => {
    const blocks: BlockKind[] = ['headline', 'paragraph', 'paragraph', 'other', 'strip', 'heading', 'paragraph'];
    expect(layoutReply(blocks).order).toEqual([0, 1, 4, 2, 3, 5, 6]);
  });

  it('treats the first paragraph as the abstract when there is no headline', () => {
    const blocks: BlockKind[] = ['paragraph', 'paragraph', 'heading', 'strip'];
    expect(layoutReply(blocks).order).toEqual([0, 3, 1, 2]);
  });

  it('keeps a headline with no dek, and several strips in their order', () => {
    const blocks: BlockKind[] = ['headline', 'other', 'heading', 'strip', 'heading', 'strip'];
    expect(layoutReply(blocks).order).toEqual([0, 3, 5, 1, 2, 4]);
  });

  it('handles a reply that opens on a heading', () => {
    const blocks: BlockKind[] = ['heading', 'paragraph', 'strip', 'heading'];
    expect(layoutReply(blocks)).toEqual({ order: [2, 0, 1, 3], sections: 2 });
  });

  it('never drops or duplicates a block', () => {
    const blocks: BlockKind[] = ['strip', 'headline', 'paragraph', 'heading', 'strip', 'other', 'heading', 'paragraph', 'strip'];
    expect([...layoutReply(blocks).order].sort((a, b) => a - b)).toEqual(blocks.map((_, i) => i));
  });
});

describe('fold state', () => {
  it('starts with every section folded', () => {
    const state = newFold();
    expect([0, 1, 2].map((i) => isOpen(state, i))).toEqual([false, false, false]);
    expect(allOpen(state, 3)).toBe(false);
  });

  it('opens and closes one section at a time', () => {
    const state = newFold();
    toggleSection(state, 1);
    expect([0, 1, 2].map((i) => isOpen(state, i))).toEqual([false, true, false]);
    toggleSection(state, 1);
    expect(isOpen(state, 1)).toBe(false);
  });

  it('Expand all opens every section, including one that streams in later', () => {
    const state = newFold();
    setAll(state, true);
    expect(allOpen(state, 3)).toBe(true);
    expect(isOpen(state, 3)).toBe(true);
  });

  it('a section she closed after Expand all stays closed until Collapse all', () => {
    const state = newFold();
    setAll(state, true);
    toggleSection(state, 0);
    expect(isOpen(state, 0)).toBe(false);
    expect(allOpen(state, 2)).toBe(false);
    setAll(state, false);
    expect([0, 1].map((i) => isOpen(state, i))).toEqual([false, false]);
  });

  it('a later section arriving mid-stream stays folded and leaves opened ones open', () => {
    const state = newFold();
    toggleSection(state, 0);
    expect([0, 1].map((i) => isOpen(state, i))).toEqual([true, false]);
  });
});
