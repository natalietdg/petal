// Pull request links in text: GitHub and Azure DevOps web URLs, read into one shape.
export type PrHost = 'github' | 'azure';

export interface PrRef {
  host: PrHost;
  url: string; // canonical: no query, fragment or trailing tab such as /files
  repoId: string; // owner/repo on GitHub, org/project/repo on Azure DevOps
  repo: string; // the repo's own name, as people say it
  number: number;
}

export interface FoundLink { ref: PrRef; index: number; length: number }

const GITHUB = /https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/gi;
const AZURE = /https?:\/\/dev\.azure\.com\/([^/\s"'<>()[\]]+)\/([^/\s"'<>()[\]]+)\/_git\/([^/\s"'<>()[\]]+)\/pullrequest\/(\d+)/gi;

const decoded = (part: string): string => {
  try { return decodeURIComponent(part); } catch { return part; }
};

function githubRef([, owner, repo, number]: RegExpExecArray): PrRef {
  const name = (repo as string).replace(/\.git$/i, '');
  return { host: 'github', url: `https://github.com/${owner}/${name}/pull/${number}`, repoId: `${owner}/${name}`, repo: name, number: Number(number) };
}

function azureRef([, org, project, repo, number]: RegExpExecArray): PrRef {
  const path = `${org}/${project}/_git/${repo}`;
  return { host: 'azure', url: `https://dev.azure.com/${path}/pullrequest/${number}`, repoId: `${org}/${decoded(project as string)}/${decoded(repo as string)}`, repo: decoded(repo as string), number: Number(number) };
}

// Every PR link in the text, in order of appearance; the same PR twice is listed twice.
export function findPrLinks(text: string): FoundLink[] {
  const found: FoundLink[] = [];
  for (const match of text.matchAll(GITHUB)) found.push({ ref: githubRef(match), index: match.index, length: match[0].length });
  for (const match of text.matchAll(AZURE)) found.push({ ref: azureRef(match), index: match.index, length: match[0].length });
  return found.sort((a, b) => a.index - b.index);
}

// One PR across spellings: host and path case never make two entries.
export const prKey = (ref: Pick<PrRef, 'url'>): string => ref.url.toLowerCase();

// Azure DevOps prints its repo's web URL and the PR id separately; this joins them into the PR's page.
export function azurePrUrl(repoWebUrl: string, id: number): PrRef | null {
  const [first] = findPrLinks(`${repoWebUrl.replace(/\/+$/, '')}/pullrequest/${id}`);
  return first?.ref ?? null;
}
