// The ismainsafe skill's report, read into a verdict, the newest safe commit and the findings still open.
export type MainSafeVerdict = 'safe' | 'safe-self' | 'not-safe';
export type FindingStatus = 'MISSING' | 'UNVERIFIED' | 'VERIFIED' | null;

export interface MainSafeFinding { category: string; where: string; status: FindingStatus; note: string }

export interface MainSafe {
  verdict: MainSafeVerdict | null; // null: the report had no verdict Petal could read
  newestSafe: string | null; // "<sha> <subject> (K of N commits)", "HEAD" or "none" as the skill wrote it
  flagged: MainSafeFinding[]; // MISSING and UNVERIFIED findings, in report order
  summary: string; // the Why paragraph; the report's opening when it has none
  mainSha: string | null; // the main commit it audited, as Petal read it before the run
  at: string;
}

const MAX_SUMMARY = 800;
const plain = (text: string): string => text.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
const fieldLine = (text: string, label: string): string | null => {
  const match = new RegExp(`^\\s*(?:[-*]\\s+)?\\**${label}:?\\**:?\\s*(.+)$`, 'im').exec(text);
  return match ? plain(match[1] as string) : null;
};

export function parseVerdict(text: string): MainSafeVerdict | null {
  const line = fieldLine(text, 'Verdict') ?? '';
  if (/\bNOT SAFE\b/i.test(line)) return 'not-safe';
  if (/\bSAFE\s*\(self-owned\)/i.test(line)) return 'safe-self';
  if (/\bSAFE\b/i.test(line)) return 'safe';
  return null;
}

// Text under a "## <name>" heading, up to the next heading of the same or a higher level.
function section(text: string, name: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^##\\s+${name}\\b`, 'i').test(line));
  if (start === -1) return '';
  const end = lines.findIndex((line, i) => i > start && /^#{1,2}\s/.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

const STATUS = /\*\*Status:\*\*\s*`?(MISSING|UNVERIFIED|VERIFIED)`?\s*(?:[-—–:]\s*)?(.*)$/i;
const WHERE = /^\s*[-*]\s+\*\*(?:File|Where):\*\*\s*(.+)$/i;

// Each finding is a "- **File:**" bullet under a "### <category>"; its Status line follows.
export function parseFindings(text: string): MainSafeFinding[] {
  const findings: MainSafeFinding[] = [];
  let category = '';
  let current: MainSafeFinding | null = null;
  for (const line of section(text, 'Findings').split(/\r?\n/)) {
    const heading = /^###\s+(.+)$/.exec(line);
    if (heading) { category = plain(heading[1] as string); current = null; continue; }
    const where = WHERE.exec(line);
    if (where) { current = { category, where: plain(where[1] as string), status: null, note: '' }; findings.push(current); continue; }
    const status = current && STATUS.exec(line);
    if (current && status) { current.status = (status[1] as string).toUpperCase() as FindingStatus; current.note = plain(status[2] ?? ''); }
  }
  return findings;
}

export function parseMainSafe(text: string, mainSha: string | null, at = new Date().toISOString()): MainSafe {
  const why = plain(section(text, 'Why'));
  return {
    verdict: parseVerdict(text),
    newestSafe: fieldLine(text, 'Newest safe commit'),
    flagged: parseFindings(text).filter((finding) => finding.status !== 'VERIFIED'),
    summary: (why || plain(text)).slice(0, MAX_SUMMARY),
    mainSha,
    at,
  };
}

export const VERDICT_TEXT: Record<MainSafeVerdict, string> = { safe: 'SAFE', 'safe-self': 'SAFE (your own changes)', 'not-safe': 'NOT SAFE' };
