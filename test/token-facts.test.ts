import { describe, expect, it } from 'vitest';
import { TOKEN_OWN, TOKEN_USERS, styleLine, tokenLead } from '../src/shared/token-facts';

describe('token facts card', () => {
  it('gives the style range from the measured style sizes', () => {
    expect(styleLine()).toBe('A Petal reply style adds about 1,700 to 2,700 tokens of instructions to every turn, and replies run a little longer. Turn it off in Customize › Formatting.');
  });

  it('has no em dashes', () => {
    const all = [tokenLead(), styleLine(), TOKEN_OWN, ...TOKEN_USERS.flatMap((u) => [u.what, u.off])];
    for (const line of all) expect(line).not.toContain('—');
  });
});
