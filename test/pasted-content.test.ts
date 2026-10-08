// Claude Code's paste wrapper: split from typed text, never shown as tags.
import { describe, expect, it } from 'vitest';
import { parsePasted, stripPasted } from '../src/shared/pasted-content';

const URL_A = 'https://example.test/org/project/_workitems/edit/1234?view=a-very-long-query-string-that-never-breaks';
const URL_B = 'https://example.test/org/project/_git/repo?path=/src/deeply/nested/module/file-name.ts&version=GBmain';

describe('parsePasted', () => {
  it('returns typed text alone when there is no wrapper', () => {
    expect(parsePasted('just a question')).toEqual([{ kind: 'typed', text: 'just a question' }]);
    expect(parsePasted('')).toEqual([]);
  });

  it('splits a single block with text before and after', () => {
    const text = `look at these\n<pasted_content id="2233">\n${URL_A}\n${URL_B}\n</pasted_content id="2233">\nwhich api is used?`;
    expect(parsePasted(text)).toEqual([
      { kind: 'typed', text: 'look at these' },
      { kind: 'pasted', text: `${URL_A}\n${URL_B}` },
      { kind: 'typed', text: 'which api is used?' },
    ]);
  });

  it('handles several blocks', () => {
    const text = '<pasted_content id="1">one</pasted_content id="1"> and <pasted_content id="2">two</pasted_content id="2">';
    expect(parsePasted(text)).toEqual([
      { kind: 'pasted', text: 'one' },
      { kind: 'typed', text: 'and' },
      { kind: 'pasted', text: 'two' },
    ]);
  });

  it('accepts a plain closer and no id at all', () => {
    expect(parsePasted('<pasted_content>abc</pasted_content> done')).toEqual([
      { kind: 'pasted', text: 'abc' },
      { kind: 'typed', text: 'done' },
    ]);
    expect(parsePasted('<pasted_content id="9">abc</pasted_content>')).toEqual([{ kind: 'pasted', text: 'abc' }]);
  });

  it('treats an unclosed block as pasted to the end', () => {
    expect(parsePasted('see <pasted_content id="7">\nrest of it\nmore')).toEqual([
      { kind: 'typed', text: 'see' },
      { kind: 'pasted', text: 'rest of it\nmore' },
    ]);
  });

  it('keeps a pasted copy of the wrapper inside its own block', () => {
    const inner = '<pasted_content id="b">x</pasted_content id="b">';
    expect(parsePasted(`<pasted_content id="a">${inner}</pasted_content id="a">tail`)).toEqual([
      { kind: 'pasted', text: inner },
      { kind: 'typed', text: 'tail' },
    ]);
  });

  it('accepts ids with any characters, quoted either way or bare', () => {
    expect(parsePasted('<pasted_content id="a>b c/../é">p</pasted_content id="a>b c/../é">')).toEqual([{ kind: 'pasted', text: 'p' }]);
    expect(parsePasted("<pasted_content id='x.y'>p</pasted_content id='x.y'>")).toEqual([{ kind: 'pasted', text: 'p' }]);
    expect(parsePasted('<pasted_content id=42>p</pasted_content id=42>')).toEqual([{ kind: 'pasted', text: 'p' }]);
  });

  it('leaves look-alike tags and markup as typed text', () => {
    expect(parsePasted('<pasted_contents>x</pasted_contents>')).toEqual([{ kind: 'typed', text: '<pasted_contents>x</pasted_contents>' }]);
    expect(parsePasted('<script>alert(1)</script>')).toEqual([{ kind: 'typed', text: '<script>alert(1)</script>' }]);
  });
});

describe('stripPasted', () => {
  it('drops the tags and keeps the words', () => {
    const plain = stripPasted(`<pasted_content id="2233">\n${URL_A}\n</pasted_content id="2233">\nCan u figure it out`);
    expect(plain).not.toContain('pasted_content');
    expect(plain).toBe(`${URL_A}\n\nCan u figure it out`);
  });
});
