// The "/" menu's filter, trigger and insert rules.
import { describe, expect, it } from 'vitest';
import { BUILTINS, applySlash, exactMatchIndex, filterSlash, slashInsert, slashQuery, type SlashItem } from '../src/shared/slash';

const it_ = (kind: SlashItem['kind'], name: string, description = ''): SlashItem =>
  ({ kind, name, description, source: 'user', insert: slashInsert(kind, name) });
const ITEMS = [
  it_('skill', 'log-triage', 'Diagnose a pasted log line.'),
  it_('skill', 'code-quality', 'Audit the diff after writing code.'),
  it_('skill', 'qa:triage', 'Sort bugs.'),
  it_('command', 'frontend:component', 'Make a component.'),
  it_('agent', 'reviewer', 'Reviews pull requests.'),
];
const names = (items: SlashItem[]) => items.map((i) => i.name);

describe('filterSlash', () => {
  it('an empty query keeps every item in order', () => {
    expect(filterSlash(ITEMS, '  ')).toBe(ITEMS);
  });

  it('ranks prefix, then segment start, then substring, then subsequence, then description', () => {
    expect(names(filterSlash(ITEMS, 'tri'))).toEqual(['log-triage', 'qa:triage']);
    expect(names(filterSlash(ITEMS, 'comp'))).toEqual(['frontend:component']);
    expect(names(filterSlash(ITEMS, 'lgtr'))).toEqual(['log-triage']); // fuzzy subsequence
    expect(names(filterSlash(ITEMS, 'pull'))).toEqual(['reviewer']); // description only
    expect(names(filterSlash(ITEMS, 'code'))).toEqual(['code-quality']);
    expect(names(filterSlash(ITEMS, 'diff writing'))).toEqual(['code-quality']); // every word somewhere
  });

  it('is case-insensitive and drops non-matches', () => {
    expect(names(filterSlash(ITEMS, 'REVIEW'))).toEqual(['reviewer']);
    expect(filterSlash(ITEMS, 'zzzz')).toEqual([]);
  });

  it('an exact name beats a longer prefix match', () => {
    const items = [it_('builtin', 'context'), it_('skill', 'con')];
    expect(names(filterSlash(items, 'con'))).toEqual(['con', 'context']);
  });
});

describe('slashQuery', () => {
  it('opens only for a leading "/" with the caret inside the first word', () => {
    expect(slashQuery('/', 1)).toBe('');
    expect(slashQuery('/rev', 4)).toBe('rev');
    expect(slashQuery('/rev', 2)).toBe('rev');
    expect(slashQuery('/rev more', 9)).toBeNull();
    expect(slashQuery('hello /rev', 10)).toBeNull();
    expect(slashQuery('', 0)).toBeNull();
    expect(slashQuery('/rev', 0)).toBeNull();
  });
});

describe('applySlash', () => {
  it('replaces the typed word and keeps her arguments', () => {
    expect(applySlash('/rev', '/review ')).toBe('/review ');
    expect(applySlash('/rev 1234', '/review ')).toBe('/review 1234');
  });

  it('puts an agent mention or a browsed pick in front of what she wrote', () => {
    expect(applySlash('/rev', '@agent-reviewer ')).toBe('@agent-reviewer ');
    expect(applySlash('  check auth', '/code-quality ')).toBe('/code-quality check auth');
  });
});

describe('BUILTINS', () => {
  it('lists each command once, all inserting "/name "', () => {
    const list = names(BUILTINS);
    expect(new Set(list).size).toBe(list.length);
    expect(list).toEqual(expect.arrayContaining(['clear', 'compact', 'context', 'model', 'resume', 'mcp', 'memory', 'config', 'help', 'init']));
    expect(BUILTINS.every((b) => b.insert === `/${b.name} ` && b.description && !b.description.includes('\u2014'))).toBe(true);
  });
});

describe('exactMatchIndex', () => {
  it('finds the item named exactly as typed, even below fuzzy matches', () => {
    const shown = [it_('skill', 'cloudflare-one-migrations'), it_('skill', 'otp-sms-runbook', 'login fails'), ...BUILTINS]; // skills group renders first
    expect(shown[exactMatchIndex(shown, ' Login ')].name).toBe('login');
  });

  it('is -1 with no exact name or an empty query', () => {
    expect(exactMatchIndex(ITEMS, 'tri')).toBe(-1);
    expect(exactMatchIndex(ITEMS, '')).toBe(-1);
  });
});
