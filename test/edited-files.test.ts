import { describe, expect, it } from 'vitest';
import { editedFiles } from '../src/main/transcript';

describe('editedFiles', () => {
  it('reads the paths of Edit and Write calls from an assistant entry', () => {
    const entry = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Editing now.' },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/r/a.ts' } },
          { type: 'tool_use', name: 'Write', input: { file_path: '/r/b.ts' } },
          { type: 'tool_use', name: 'Read', input: { file_path: '/r/c.ts' } },
        ],
      },
    };
    expect(editedFiles(entry)).toEqual(['/r/a.ts', '/r/b.ts']);
  });

  it('ignores user entries and plain text', () => {
    expect(editedFiles({ type: 'user', message: { role: 'user', content: 'hi' } })).toEqual([]);
    expect(editedFiles({ type: 'assistant', message: { role: 'assistant', content: 'text only' } })).toEqual([]);
  });
});
