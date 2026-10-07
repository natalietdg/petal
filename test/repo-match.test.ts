import { describe, expect, it } from 'vitest';
import { fuzzyScore, matchesAnyName, parseRepoCommand, rankRepos } from '../src/shared/repo-match';

const repo = (name: string, shortPath: string, modifiedMs = 0) => ({ name, shortPath, modifiedMs });

describe('fuzzyScore', () => {
  it('matches subsequences case-insensitively and rejects the rest', () => {
    expect(fuzzyScore('pt', 'pastel-term')).not.toBeNull();
    expect(fuzzyScore('PT', 'pastel-term')).not.toBeNull();
    expect(fuzzyScore('tp', 'pastel-term')).toBeNull();
  });

  it('prefers a prefix and word starts over a scattered match', () => {
    expect(fuzzyScore('term', 'pastel-term')!).toBeGreaterThan(fuzzyScore('term', 'the-ultimate-rim')!);
    expect(fuzzyScore('pas', 'pastel')!).toBeGreaterThan(fuzzyScore('pas', 'happy-ass')!);
  });
});

describe('rankRepos', () => {
  const repos = [
    repo('admin-v3', '~/work/admin-v3', 1),
    repo('pastel-term', '~/CascadeProjects/pastel-term', 2),
    repo('sweep', '~/side/sweep', 3),
    repo('notes', '~/petal-notes/notes', 4),
  ];

  it('puts a name hit above a path-only hit', () => {
    expect(rankRepos('pet', repos).map((r) => r.name)).toEqual(['pastel-term', 'notes']);
  });

  it('ranks the tighter name match first', () => {
    expect(rankRepos('sweep', repos)[0]?.name).toBe('sweep');
    expect(rankRepos('adm', repos)[0]?.name).toBe('admin-v3');
  });

  it('with no query, lists the most recently touched first', () => {
    expect(rankRepos('  ', repos).map((r) => r.name)).toEqual(['notes', 'sweep', 'pastel-term', 'admin-v3']);
  });

  it('drops repos that match neither name nor path', () => {
    expect(rankRepos('zzz', repos)).toEqual([]);
  });

  it('matchesAnyName looks at names only', () => {
    expect(matchesAnyName('swp', repos)).toBe(true);
    expect(matchesAnyName('Cascade', repos)).toBe(false);
  });
});

describe('parseRepoCommand', () => {
  it('reads checkout and cd with one name, any case', () => {
    expect(parseRepoCommand('checkout pastel-term')).toBe('pastel-term');
    expect(parseRepoCommand('  CD  Petal ')).toBe('Petal');
    expect(parseRepoCommand('Checkout admin-v3')).toBe('admin-v3');
  });

  it('leaves paths, flags, variables and sentences to the shell or Claude', () => {
    for (const text of ['cd ..', 'cd ~/x', 'cd /tmp', 'cd src/main', 'cd -', 'cd $HOME', 'checkout', 'git checkout main', 'checkout the auth branch please', 'cdpetal']) {
      expect(parseRepoCommand(text)).toBeNull();
    }
  });
});
