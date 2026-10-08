// Short readable labels for bare URLs in replies; the href itself is never changed.

const MAX_PATH_CHARS = 28;
const MAX_SEGMENT_CHARS = 22;
const SHA_CHARS = 7;
const ELLIPSIS = '…';

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);
const GITHUB_ITEM = /^\/([^/]+)\/([^/]+)\/(?:pull|issues)\/(\d+)(?:\/|$)/;
const GITHUB_COMMIT = /^\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{7,40})(?:\/|$)/i;
const GITHUB_REPO = /^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/;
const AZURE_WORK_ITEM = /\/_workitems\/edit\/(\d+)(?:\/|$)/;
const isAzureDevOps = (host: string): boolean => host === 'dev.azure.com' || host.endsWith('.visualstudio.com');

const stripScheme = (url: string): string => url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');

const decode = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}${ELLIPSIS}` : text);

// A link is bare when its visible text is just its own URL (with or without the scheme or a trailing slash).
export function isBareLink(href: string, text: string): boolean {
  const shown = text.trim();
  return /^https?:\/\//i.test(href) && shown !== '' && stripScheme(shown) === stripScheme(href);
}

function githubLabel(pathname: string): string | null {
  const item = GITHUB_ITEM.exec(pathname);
  if (item) return `${item[2]} #${item[3]}`;
  const commit = GITHUB_COMMIT.exec(pathname);
  if (commit) return `${commit[2]}@${(commit[3] ?? '').slice(0, SHA_CHARS)}`;
  const repo = GITHUB_REPO.exec(pathname);
  if (repo) return `${repo[1]}/${repo[2]}`;
  return null;
}

function azureLabel(url: URL): string | null {
  const id = AZURE_WORK_ITEM.exec(url.pathname)?.[1] ?? url.searchParams.get('workitem');
  return id && /^\d+$/.test(id) ? `Work item ${id}` : null;
}

// host + path, the middle folded to "…" when long; a dropped query or hash also shows as "…".
function genericLabel(url: URL): string {
  const host = url.hostname.replace(/^www\./, '');
  const segments = url.pathname.split('/').filter(Boolean).map(decode);
  const extra = url.search !== '' || url.hash !== '';
  if (segments.length === 0) return extra ? `${host}/${ELLIPSIS}` : host;

  const full = `/${segments.join('/')}`;
  if (full.length <= MAX_PATH_CHARS) return `${host}${full}${extra ? ELLIPSIS : ''}`;
  const last = segments[segments.length - 1] ?? '';
  const tail = clip(last, MAX_SEGMENT_CHARS);
  const folded = segments.length > 1 ? `/${ELLIPSIS}/${tail}` : `/${tail}`;
  return `${host}${folded}${extra && tail === last ? ELLIPSIS : ''}`;
}

// Short label for an http(s) URL, or null when the URL cannot be parsed or is not http(s).
export function shortUrlLabel(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (GITHUB_HOSTS.has(host)) return githubLabel(url.pathname) ?? genericLabel(url);
  if (isAzureDevOps(host)) return azureLabel(url) ?? genericLabel(url);
  return genericLabel(url);
}

// The label to show for a link: a short one for a bare URL, null to keep the author's text.
export function linkLabel(href: string, text: string): string | null {
  return isBareLink(href, text) ? shortUrlLabel(href) : null;
}
