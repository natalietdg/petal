// The PRs tab's open panel: services with their main check, the deploy order, how the services connect, and each PR with her notes.
import * as diagrams from './diagrams';
import { el } from './dom';
import { timeOf } from './format';
import { notesEditor } from './prs-notes';
import { orderSection, servicesSection, shownOrder } from './prs-checks';
import { prsFlowMermaid } from '../shared/pr-flow';
import type { SessionPr, SessionPrsView } from '../shared/session-prs';

const flowHost = el('div', 'prs-flow-figure'); // kept across repaints so mermaid redraws only when the diagram changes

async function drawFlow(source: string): Promise<void> {
  if (flowHost.dataset.source === source) return;
  flowHost.dataset.source = source;
  if (await diagrams.validate(source)) await diagrams.renderSource(flowHost, source);
  else flowHost.replaceChildren(el('pre', 'prs-muted', source));
}

function flowSection(view: SessionPrsView): HTMLElement[] {
  const order = shownOrder(view);
  void drawFlow(prsFlowMermaid(view.services, view.prs, order?.links ?? []));
  const caption = !order
    ? 'Propose a deploy order to draw how the services depend on each other.'
    : order.links.length ? 'Arrows point from a service to the one it depends on. Inferred, like the order.' : 'The reviewer found no dependencies between these services.';
  return [el('h3', 'prs-heading', 'How they connect'), flowHost, el('p', 'prs-muted', caption)];
}

function prCard(view: SessionPrsView, pr: SessionPr): HTMLElement {
  const card = el('article', 'prs-card');
  const title = el('a', 'prs-card-title', pr.title || `${pr.repo} PR ${pr.number}`);
  title.href = pr.url;
  const meta = [pr.repo, `PR ${pr.number}`, ...(pr.branch ? [pr.branch] : []), pr.created ? 'made here' : 'mentioned', ...(pr.at ? [timeOf(pr.at)] : [])];
  card.append(title, el('p', 'prs-muted', meta.join(' · ')), notesEditor(view.sessionId, pr.url, view.notes[pr.url]));
  return card;
}

export function panelParts(view: SessionPrsView): HTMLElement[] {
  return [
    ...servicesSection(view),
    ...orderSection(view),
    ...flowSection(view),
    el('h3', 'prs-heading', 'PRs and your notes'),
    ...view.prs.map((pr) => prCard(view, pr)),
  ];
}
