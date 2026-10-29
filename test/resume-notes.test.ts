import { describe, expect, it } from 'vitest';
import {
  buildIndex, buildResumeNote, folderStamp, noteFileName, openDecide, PROMPT_CHARS, REPLY_TAIL_CHARS, resumeLine,
  STATUS_LINES_MAX, trimEnd, trimStart, trimStatus, whereItStopped, type ResumeSession,
} from '../src/main/resume-notes-text';

const REPLY = [
  '**The export button is half built.**',
  '',
  'The button shows in the toolbar; the save dialog is next.',
  '',
  '**Doing:** wiring the export button to the save dialog',
  '**Recommend:** CSV first',
  '**Next:** pick the file formats',
  '',
  '**Decide:** CSV only, or CSV and JSON?',
].join('\n');

const session = (over: Partial<ResumeSession> = {}): ResumeSession & { sessionId: string } => ({
  title: 'Export button',
  sessionId: '1234abcd-5678-90ef-aaaa-bbbbccccdddd',
  cwd: '/tmp/sample project',
  running: false,
  agent: false,
  lastActive: '2026-10-28T10:30:00.000Z',
  lastPrompt: 'make the export button work',
  lastReply: REPLY,
  waiting: [],
  ...over,
} as ResumeSession & { sessionId: string });

describe('noteFileName', () => {
  it('keeps letters and digits, dashes the rest, and adds the first 8 of the id', () => {
    expect(noteFileName('Fix: the "Export" / button!', '1234abcd-5678')).toBe('fix-the-export-button-1234abcd.md');
  });
  it('falls back when the title has nothing safe in it', () => {
    expect(noteFileName('???', 'abc')).toBe('session-abc.md');
  });
  it('never lets a path through', () => {
    const name = noteFileName('../../etc/passwd', '../../x');
    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
  });
  it('caps a long title', () => {
    expect(noteFileName('a'.repeat(200), '12345678').length).toBeLessThanOrEqual(60 + '-12345678.md'.length);
  });
});

describe('trimming', () => {
  it('leaves short text alone', () => {
    expect(trimStart('short', 10)).toBe('short');
    expect(trimEnd('short', 10)).toBe('short');
  });
  it('trims the start of a long prompt to about the limit, with an ellipsis', () => {
    const out = trimStart('word '.repeat(300), PROMPT_CHARS);
    expect(out.length).toBeLessThanOrEqual(PROMPT_CHARS + 1);
    expect(out.endsWith('…')).toBe(true);
  });
  it('keeps the end of a long reply', () => {
    const text = `${'early '.repeat(300)}the very end`;
    const out = trimEnd(text, REPLY_TAIL_CHARS);
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('the very end')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(REPLY_TAIL_CHARS + 1);
  });
  it('caps git status at the line limit with a count of the rest', () => {
    const lines = Array.from({ length: STATUS_LINES_MAX + 5 }, (_, i) => ` M file${i}.ts`).join('\n');
    const out = trimStatus(lines).split('\n');
    expect(out).toHaveLength(STATUS_LINES_MAX + 1);
    expect(out.at(-1)).toBe('… 5 more');
  });
});

describe('openDecide', () => {
  it('finds the newest reply’s Decide line while nothing answered it', () => {
    expect(openDecide(REPLY, [])).toBe('CSV only, or CSV and JSON?');
  });
  it('is closed once she sent a prompt after it', () => {
    expect(openDecide(REPLY, ['CSV only'])).toBeNull();
  });
  it('ignores a Decide inside code', () => {
    expect(openDecide('```md\n**Decide:** not real\n```', [])).toBeNull();
  });
});

describe('whereItStopped', () => {
  it('shows her prompt, the headline, the status lines and the open decision', () => {
    const out = whereItStopped(session());
    expect(out).toContain('> make the export button work');
    expect(out).toContain('Last reply: **The export button is half built.**');
    expect(out).toContain('- **Doing:** wiring the export button to the save dialog');
    expect(out).toContain('- **Recommend:** CSV first');
    expect(out).toContain('- **Next:** pick the file formats');
    expect(out).toContain('- **Decide:** CSV only, or CSV and JSON?');
    expect(out).not.toContain('save dialog is next'); // body text stays out when status lines exist
  });
  it('falls back to the end of the reply when it has no status lines', () => {
    const reply = `${'Plain words. '.repeat(100)}Final sentence.`;
    const out = whereItStopped(session({ lastReply: reply }));
    expect(out).toContain('End of the last reply:');
    expect(out).toContain('Final sentence.');
    expect(out).not.toContain('**Doing:**');
  });
  it('says when Claude hadn’t answered her newest prompt', () => {
    const out = whereItStopped(session({ lastPrompt: 'CSV only', waiting: ['CSV only'] }));
    expect(out).toContain('> CSV only');
    expect(out).toContain('Claude had not answered it yet.');
    expect(out).not.toContain('**Decide:**');
  });
  it('handles a session with nothing in it yet', () => {
    expect(whereItStopped(session({ lastPrompt: '', lastReply: '' }))).toBe('No prompts yet.');
  });
});

describe('buildResumeNote', () => {
  it('has the sections in order with the quoted resume command', () => {
    const note = buildResumeNote(session({ running: true }), { branch: 'feature-x', status: ' M src/a.ts\n?? notes.txt\n', notes: [] });
    const order = ['# Export button', '- Folder: /tmp/sample project', '- Branch: feature-x', '- State: Running', '- Last active:', '## Resume', '## Where it stopped', '## Uncommitted'];
    const at = order.map((part) => note.indexOf(part));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(note).toContain("```bash\ncd '/tmp/sample project' && claude --resume '1234abcd-5678-90ef-aaaa-bbbbccccdddd'\n```");
    expect(note).toContain('?? notes.txt');
  });
  it('leaves out Branch and Uncommitted outside git or when clean, and notes what was skipped', () => {
    const note = buildResumeNote(session(), { branch: null, status: '', notes: ['Uncommitted files skipped: out of time at quit.'] });
    expect(note).not.toContain('Branch:');
    expect(note).not.toContain('## Uncommitted');
    expect(note).toContain('- State: Idle');
    expect(note).toContain('_Uncommitted files skipped: out of time at quit._');
  });
  it('resumes without cd when the folder is unknown', () => {
    expect(resumeLine(null, 'abc')).toBe("claude --resume 'abc'");
    expect(resumeLine("it's", 'abc')).toBe(`cd 'it'\\''s' && claude --resume 'abc'`);
  });
});

describe('buildIndex', () => {
  it('links each session and lists shells as nothing to resume', () => {
    const index = buildIndex([
      { session: session(), file: 'export-button-1234abcd.md' },
      { session: session({ title: 'Shell', sessionId: null }), file: null },
    ], new Date(2026, 9, 28, 10, 30));
    expect(index).toContain('# Open in Petal at 2026-10-28 10:30');
    expect(index).toContain('- [Export button](export-button-1234abcd.md) · Idle · /tmp/sample project');
    expect(index).toContain('- Shell: shell, nothing to resume');
  });
  it('stamps the folder in local time', () => {
    expect(folderStamp(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02_03-04');
  });
});
