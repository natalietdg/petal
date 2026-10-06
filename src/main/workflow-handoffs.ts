// Workflow, Handoffs tab: this past week's send / resume / fork hops between sessions, as a Mermaid graph.
import { label, titleOf, WEEK_MS } from './workflow-common';
import type { ListedSession } from './history';
import type { OrganizerStore } from './session-organizer';
import type { Link, LinkKind } from './links-store';

const EDGE: Record<LinkKind, string> = { send: '-->', resume: '-.->', fork: '==>' };

export interface HandoffData {
  total: number;
  counts: Record<LinkKind, number>;
  nodes: number;
  mermaid: string | null;
}

export function handoffData({ links, sessions, labels, now = Date.now() }: { links: Link[]; sessions: ListedSession[]; labels: OrganizerStore; now?: number }): HandoffData {
  const since = now - WEEK_MS;
  const recent = links.filter((l) => Date.parse(l.at) >= since);
  const counts = { send: 0, resume: 0, fork: 0 };
  for (const link of recent) counts[link.kind] += 1;
  if (!recent.length) return { total: 0, counts, mermaid: null, nodes: 0 };

  const titles = new Map(sessions.map((s) => [s.sessionId, titleOf(s, labels)]));
  const nameOf = (id: string | null) => (id ? titles.get(id) || labels[id]?.title || `Session ${id.slice(0, 8)}` : 'New tab');
  const ids = new Map<string, string>(); // sessionId (or "") -> mermaid node id
  const nodeFor = (id: string | null): string => {
    const key = id ?? '';
    let node = ids.get(key);
    if (!node) {
      node = `n${ids.size}`;
      ids.set(key, node);
    }
    return node;
  };
  // Repeats of the same hop collapse into one edge with a count.
  const edges = new Map<string, { from: string | null; to: string | null; kind: LinkKind; n: number }>();
  for (const { from, to, kind } of recent) {
    const key = `${from}|${to}|${kind}`;
    edges.set(key, { from, to, kind, n: (edges.get(key)?.n ?? 0) + 1 });
  }
  const edgeLines = [...edges.values()].map(({ from, to, kind, n }) =>
    `  ${nodeFor(from)} ${EDGE[kind]}|"${kind}${n > 1 ? ` ×${n}` : ''}"| ${nodeFor(to)}`);
  const nodeLines = [...ids].map(([id, node]) => (id ? `  ${node}["${label(nameOf(id))}"]` : `  ${node}(["New tab"])`));
  return { total: recent.length, counts, nodes: ids.size, mermaid: ['flowchart LR', ...nodeLines, ...edgeLines].join('\n') };
}
