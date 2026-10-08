import { describe, expect, it } from 'vitest';
import { isBareLink, linkLabel, shortUrlLabel } from '../src/shared/link-label';

const bare = (url: string): string | null => linkLabel(url, url);

describe('linkLabel: GitHub', () => {
  it('labels a pull request as repo #N', () => {
    expect(bare('https://github.com/acme-labs/Widget-Service/pull/17')).toBe('Widget-Service #17');
  });

  it('labels an issue, ignoring a trailing tab or anchor', () => {
    expect(bare('https://github.com/acme-labs/widgets/issues/402')).toBe('widgets #402');
    expect(bare('https://github.com/acme-labs/widgets/pull/9/files#diff-abc')).toBe('widgets #9');
  });

  it('labels a commit as repo@short-sha', () => {
    expect(bare('https://github.com/acme-labs/widgets/commit/4c698ba1f2e3d4c5b6a7980716253443')).toBe('widgets@4c698ba');
  });

  it('labels a repo root as org/repo', () => {
    expect(bare('https://github.com/acme-labs/widgets')).toBe('acme-labs/widgets');
    expect(bare('https://github.com/acme-labs/widgets/')).toBe('acme-labs/widgets');
  });

  it('falls back to host + path for other GitHub pages', () => {
    expect(bare('https://github.com/acme-labs/widgets/blob/main/src/very/deep/folder/index.ts')).toBe('github.com/…/index.ts');
  });
});

describe('linkLabel: Azure DevOps', () => {
  it('labels a work item by number', () => {
    expect(bare('https://dev.azure.com/AcmeOrg/Widgets/_workitems/edit/10429')).toBe('Work item 10429');
    expect(bare('https://acmeorg.visualstudio.com/Widgets/_workitems/edit/10429/')).toBe('Work item 10429');
  });

  it('labels a board link that names its work item', () => {
    expect(bare('https://dev.azure.com/AcmeOrg/Widgets/_boards/board/t/Team/Stories?workitem=10429')).toBe('Work item 10429');
  });
});

describe('linkLabel: plain URLs', () => {
  it('keeps a short URL as host + path', () => {
    expect(bare('https://example.com/docs/setup')).toBe('example.com/docs/setup');
    expect(bare('https://www.example.com/')).toBe('example.com');
  });

  it('folds a long path to its last segment', () => {
    expect(bare('https://example.com/a/very/long/path/that/keeps/going/forever.html')).toBe('example.com/…/forever.html');
  });

  it('drops a long query string behind an ellipsis', () => {
    const url = 'https://example.com/search?q=widgets&utm_source=newsletter&utm_campaign=autumn&session=abcdef0123456789';
    expect(bare(url)).toBe('example.com/search…');
    expect(bare('https://example.com/?token=abc')).toBe('example.com/…');
  });

  it('clips one very long segment', () => {
    expect(bare('https://example.com/an-extremely-long-single-slug-that-never-ends')).toBe('example.com/an-extremely-long-sin…');
  });
});

describe('linkLabel: left as written', () => {
  it('keeps a link that has its own label', () => {
    expect(linkLabel('https://github.com/acme-labs/widgets/pull/17', 'the widgets PR')).toBeNull();
  });

  it('keeps non-http schemes', () => {
    expect(linkLabel('mailto:someone@example.com', 'mailto:someone@example.com')).toBeNull();
    expect(linkLabel('file:///tmp/a.txt', 'file:///tmp/a.txt')).toBeNull();
    expect(shortUrlLabel('vscode://file/tmp/a.txt')).toBeNull();
  });

  it('treats www autolinks as bare', () => {
    expect(isBareLink('http://www.example.com', 'www.example.com')).toBe(true);
    expect(linkLabel('http://www.example.com/docs', 'www.example.com/docs')).toBe('example.com/docs');
  });
});
