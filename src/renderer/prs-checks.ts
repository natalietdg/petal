// The PRs tab's two on-click checks: "Is main safe for prod?" per repo, and the proposed prod deploy order.
import { el } from './dom';
import { timeOf } from './format';
import { checkMain, mainCheck, orderCheck, proposeOrder, type Check } from './prs-data';
import { VERDICT_TEXT, type MainSafe } from '../shared/main-safe';
import type { DeployOrder } from '../shared/deploy-order';
import type { PrService, SessionPrsView } from '../shared/session-prs';

const HOST_NAMES = { github: 'GitHub', azure: 'Azure DevOps' } as const;

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'flow-button prs-button', text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

// The newest of the cached answer (main as it is now) and one she just ran.
function latest<T extends { at: string }>(cached: T | null | undefined, check: Check<T> | null): Check<T> | null {
  if (check?.state === 'running' || check?.state === 'failed') return check;
  const ran = check?.state === 'done' ? check.value : null;
  const newest = [cached, ran].filter((x): x is T => Boolean(x)).sort((a, b) => b.at.localeCompare(a.at))[0];
  return newest ? { state: 'done', value: newest } : null;
}

function verdictBlock(answer: MainSafe): HTMLElement {
  const box = el('div', `prs-verdict prs-verdict-${answer.verdict ?? 'unknown'}`);
  const head = el('p', 'prs-verdict-head');
  head.append(el('strong', 'prs-verdict-word', answer.verdict ? VERDICT_TEXT[answer.verdict] : 'No verdict read'));
  const when = `Checked ${timeOf(answer.at)}${answer.mainSha ? ` · main ${answer.mainSha.slice(0, 7)}` : ''}`;
  head.append(el('span', 'prs-muted', when));
  box.append(head);
  if (answer.newestSafe) box.append(el('p', 'prs-line', `Newest safe commit: ${answer.newestSafe}`));
  if (answer.flagged.length) {
    const list = el('ul', 'prs-flagged');
    for (const f of answer.flagged) list.append(el('li', null, [f.category, f.where, f.status ? `${f.status}${f.note ? `: ${f.note}` : ''}` : f.note].filter(Boolean).join(' · ')));
    box.append(list);
  }
  if (!answer.verdict) box.append(el('p', 'prs-muted', 'Petal couldn’t read SAFE or NOT SAFE in the report. Its summary:'));
  if (!answer.verdict || !answer.flagged.length) box.append(el('p', 'prs-line', answer.summary));
  return box;
}

function serviceRow(view: SessionPrsView, service: PrService): HTMLElement {
  const row = el('li', 'prs-service');
  const numbers = view.prs.filter((pr) => service.prUrls.includes(pr.url)).map((pr) => `PR ${pr.number}`).join(', ');
  const head = el('div', 'prs-service-head');
  head.append(el('strong', 'prs-service-name', service.repo), el('span', 'prs-muted', `${HOST_NAMES[service.host]} · ${numbers}`));
  row.append(head);
  const check = latest(view.mainSafe[service.key], mainCheck(view.sessionId, service.key));
  if (!service.localPath) row.append(el('p', 'prs-muted', 'No local copy of this repo in the session, so main can’t be checked here.'));
  else if (check?.state === 'running') row.append(el('p', 'prs-muted prs-running', 'Checking main… this can take a few minutes.'));
  else {
    if (check?.state === 'done') row.append(verdictBlock(check.value));
    if (check?.state === 'failed') row.append(el('p', 'prs-error', check.note));
    row.append(button(check?.state === 'done' ? 'Check again' : 'Is main safe for prod?', () => void checkMain(view.sessionId, service.key)));
  }
  return row;
}

export function servicesSection(view: SessionPrsView): HTMLElement[] {
  const list = el('ul', 'prs-services');
  list.append(...view.services.map((service) => serviceRow(view, service)));
  return [el('h3', 'prs-heading', `Related services (${view.services.length})`), list];
}

function orderList(view: SessionPrsView, order: DeployOrder): HTMLElement {
  const list = el('ol', 'prs-order');
  for (const step of order.steps) {
    const pr = view.prs.find((p) => p.url === step.url);
    const item = el('li');
    item.append(el('strong', null, pr ? `${pr.repo} PR ${pr.number}` : step.url));
    if (pr?.title) item.append(el('span', 'prs-muted', ` · ${pr.title}`));
    item.append(el('p', 'prs-line', step.reason));
    list.append(item);
  }
  return list;
}

// An order she ran before a new PR showed up leaves that PR out, so it no longer counts.
function currentOrder(view: SessionPrsView): Check<DeployOrder> | null {
  const ran = orderCheck(view.sessionId);
  const covers = ran?.state !== 'done' || view.prs.every((pr) => ran.value.steps.some((step) => step.url === pr.url));
  return latest(view.order, covers ? ran : null);
}

export function orderSection(view: SessionPrsView): HTMLElement[] {
  const heading = el('h3', 'prs-heading', 'Prod deploy order ');
  heading.append(el('span', 'prs-inferred', 'inferred'));
  const check = currentOrder(view);
  if (check?.state === 'running') return [heading, el('p', 'prs-muted prs-running', 'Reading the PRs… this can take a minute or two.')];
  if (check?.state === 'done') return [heading, orderList(view, check.value)];
  const parts: HTMLElement[] = [heading];
  if (check?.state === 'failed') parts.push(el('p', 'prs-error', check.note));
  parts.push(button('Propose deploy order', () => void proposeOrder(view.sessionId)));
  return parts;
}

export const shownOrder = (view: SessionPrsView): DeployOrder | null => {
  const check = currentOrder(view);
  return check?.state === 'done' ? check.value : null;
};
