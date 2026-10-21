// The PRs tab's diagram: one box per service with its PR numbers, arrows where one depends on another.
import type { ServiceLink } from './deploy-order';
import type { PrService, SessionPr } from './session-prs';

// Mermaid labels are quoted strings; these characters would end or restyle one.
const safe = (label: string): string => label.replace(/["`<>{}[\]|#;]/g, ' ').replace(/\s+/g, ' ').trim();

export function prsFlowMermaid(services: readonly PrService[], prs: readonly SessionPr[], links: readonly ServiceLink[]): string {
  const ids = new Map(services.map((service, i) => [service.key, `s${i}`]));
  const numbers = (service: PrService): string =>
    prs.filter((pr) => service.prUrls.includes(pr.url)).map((pr) => `PR ${pr.number}`).join(', ');
  const lines = ['flowchart LR'];
  for (const service of services) lines.push(`  ${ids.get(service.key)}["${safe(service.repo)}<br/>${safe(numbers(service))}"]`);
  for (const link of links) {
    const from = ids.get(link.from);
    const to = ids.get(link.to);
    if (!from || !to) continue;
    lines.push(link.label ? `  ${from} -->|"${safe(link.label)}"| ${to}` : `  ${from} --> ${to}`);
  }
  return lines.join('\n');
}
