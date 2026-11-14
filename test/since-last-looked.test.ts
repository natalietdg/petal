import { describe, expect, it } from 'vitest';
import { sinceLine } from '../src/shared/since-last-looked';
import type { ActivityEvent, ActivityKind } from '../src/shared/activity';

const at = (n: number, kind: ActivityKind): ActivityEvent => ({ id: `${kind}-${n}`, kind, at: n, sessionId: null, sessionName: null, branch: null, repo: null, text: '' });

describe('Since you last looked', () => {
  it('shows nothing the first time the Board opens', () => {
    expect(sinceLine([at(5, 'edits')], 0, '')).toBeNull();
  });

  it('counts only what came after the last look, by kind in feed order', () => {
    const events = [at(50, 'message'), at(40, 'edits'), at(30, 'edits'), at(20, 'conclusion'), at(5, 'test')];
    expect(sinceLine(events, 10, '2h ago')).toBe('Since you last looked, 2h ago: 2 rounds of edits · 1 conclusion · 1 message.');
  });

  it('says so when nothing changed', () => {
    expect(sinceLine([at(5, 'test')], 10, '3m ago')).toBe('Nothing new since you last looked, 3m ago.');
  });
});
