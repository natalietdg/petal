import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { folderName, NEW_SESSION, SESSION_LABEL_MAX, sessionLabelText, sessionTitle } from '../src/shared/session-label';
import { snapshot } from '../src/main/sessions-monitor';

describe('sessionTitle priority (History order)', () => {
  const all = { organizerTitle: 'Organizer title', title: 'Claude title', firstPrompt: 'first prompt', cwd: '/Users/n/BusinessLogic-Report' };

  it('prefers the organizer title', () => {
    expect(sessionTitle(all)).toBe('Organizer title');
  });

  it("then Claude Code's own title", () => {
    expect(sessionTitle({ ...all, organizerTitle: null })).toBe('Claude title');
    expect(sessionTitle({ ...all, organizerTitle: '   ' })).toBe('Claude title');
  });

  it('then the first prompt', () => {
    expect(sessionTitle({ ...all, organizerTitle: undefined, title: '' })).toBe('first prompt');
  });

  it('then the folder name and "new session"', () => {
    expect(sessionTitle({ cwd: '/Users/n/BusinessLogic-Report' })).toBe(`BusinessLogic-Report · ${NEW_SESSION}`);
    expect(sessionTitle({ cwd: '~/BusinessLogic-Report/' })).toBe(`BusinessLogic-Report · ${NEW_SESSION}`);
  });

  it('says "New session" with nothing at all', () => {
    expect(sessionTitle({})).toBe('New session');
  });

  it('flattens whitespace and drops the pasted-block tags', () => {
    expect(sessionTitle({ title: '  fix\n  the   dates ' })).toBe('fix the dates');
    expect(sessionTitle({ title: 'look <pasted_content id="1">huge log</pasted_content id="1"> here' })).toBe('look huge log here');
  });

  it('never returns the "<folder>-<id>" name Claude Code writes to its session file', () => {
    expect(sessionTitle({ cwd: '/Users/natalieleong' })).toBe('natalieleong · new session');
    expect(sessionTitle({ cwd: '/Users/natalieleong' })).not.toMatch(/^[\w.-]+-[0-9a-f]{2,}$/);
  });
});

describe('sessionLabelText truncation', () => {
  it('keeps short titles whole', () => {
    expect(sessionLabelText('Send countryCode to VN email')).toBe('Send countryCode to VN email');
  });

  it(`cuts long ones at ${SESSION_LABEL_MAX} characters with an ellipsis`, () => {
    const long = 'Fix settlement invoice dates and currency symbols across every report we send out monthly';
    const cut = sessionLabelText(long);
    expect(cut.length).toBeLessThanOrEqual(SESSION_LABEL_MAX);
    expect(cut.endsWith('…')).toBe(true);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
  });

  it('is the same cut for the same title, wherever it is called', () => {
    const long = 'x'.repeat(200);
    expect(sessionLabelText(long)).toBe(sessionLabelText(long));
  });
});

describe('folderName', () => {
  it('takes the last path part', () => {
    expect(folderName('/a/b/c')).toBe('c');
    expect(folderName('~/c/')).toBe('c');
    expect(folderName(null)).toBe('');
  });
});

describe('Sessions panel rows', () => {
  it("never use Claude Code's session-file name", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petal-label-'));
    const session = { pid: 1, sessionId: 'aaaaaaaa-0000-4000-8000-000000000001', cwd: '/Users/natalieleong', kind: 'interactive', status: 'idle', name: 'natalieleong-a7' };
    const [row] = snapshot({ detailed: true }, [session], () => dir).rows ?? [];
    expect(row?.name).toBe('natalieleong · new session');
    const named = snapshot({ detailed: true, nameOf: () => 'Traced stale fees spec' }, [session], () => dir).rows ?? [];
    expect(named[0]?.name).toBe('Traced stale fees spec');
  });
});

// Every place that names a session goes through the shared rule; nothing else builds a session label.
describe('one naming rule', () => {
  const root = path.join(__dirname, '..', 'src');
  const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
  const sources = (dir: string): string[] => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? sources(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []);
  const app = [...sources('main'), ...sources('renderer'), ...sources('shared')];

  const consumers: [file: string, uses: RegExp][] = [
    ['main/tabs.ts', /sessionTitleFor\(/], // terminal tabs, reader header label, response hook title
    ['main/sessions-ipc.ts', /sessionTitleFor\(/], // Sessions panel rows and Recently closed
    ['main/agents-ipc.ts', /sessionTitleFor\(/], // Agents panel session line
    ['main/workflow-ipc.ts', /sessionTitleFor\(/],
    ['main/workflow-common.ts', /sessionTitle\(/],
    ['main/handoff-ipc.ts', /sessionTitleFor\(/],
    ['main/flow-ipc.ts', /sessionTitleFor\(/],
    ['renderer/history-state.ts', /sessionTitle\(/], // History rows, preview header, rail, Favorites list
    ['renderer/history-list.ts', /sessionNameEl\(/],
    ['renderer/history-preview.ts', /sessionNameEl\(/],
    ['renderer/sessions-panel.ts', /sessionNameEl\(/],
    ['renderer/tabs.ts', /setSessionName\(/],
    ['renderer/reader.ts', /setSessionName\(/],
    ['renderer/agent-panel.ts', /setSessionName\(/],
  ];
  it.each(consumers)('%s uses the shared label', (file, uses) => {
    expect(read(file)).toMatch(uses);
  });

  const forbidden: [what: string, pattern: RegExp][] = [
    ["Claude Code's session-file name", /\b(?:s|session|row|live|file)\.name\s*\|\|/],
    ['an organizer-title fallback chain', /(?:organizer|labels\[[^\]]+\]|loadCached\(\)\[[^\]]+\])\??\.title\s*\|\|/],
    ['an "Untitled" label', /['"`]Untitled/],
    ['a folder basename as a label', /basename\(\s*(?:cwd|session\.cwd|s\.cwd)\s*\)\s*(?:\|\||:)/],
    ['a hard-coded "Shell" fallback', /\|\|\s*'Shell'/],
  ];
  it.each(forbidden)('no module builds %s', (_what, pattern) => {
    const hits = app.filter((file) => file !== path.join('shared', 'session-label.ts') && pattern.test(read(file)));
    expect(hits).toEqual([]);
  });
});
