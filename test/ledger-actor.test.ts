import { describe, expect, it } from 'vitest';
import { whoOf } from '../src/renderer/ledger-actor';

describe('whoOf', () => {
  it('maps Claude and external to themselves', () => {
    expect(whoOf('Claude')).toBe('claude');
    expect(whoOf('claude (recommended)')).toBe('claude');
    expect(whoOf('external')).toBe('external');
    expect(whoOf(' External (recruiter)')).toBe('external');
  });

  it('treats any other name as the user', () => {
    for (const name of ['Alex', 'sam', 'Priya Raman', 'you']) expect(whoOf(name)).toBe('you');
  });
});
