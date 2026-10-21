// What the deploy-order reviewer is asked: the PRs as the session left them, and the JSON shape to answer in.
import { serviceKey, type PrService, type SessionPr } from '../shared/session-prs';

function prBlock(pr: SessionPr, i: number, services: readonly PrService[]): string {
  const folder = pr.localPath ?? services.find((s) => s.key === serviceKey(pr))?.localPath ?? null;
  return [
    `${i + 1}. ${pr.url}`,
    `   repo: ${pr.repo} (${pr.repoId}); local folder: ${folder ?? 'not on this machine'}`,
    `   title: ${pr.title || 'unknown'}`,
    `   branch: ${pr.branch ?? 'unknown'}`,
  ].join('\n');
}

export function deployOrderPrompt(prs: readonly SessionPr[], services: readonly PrService[]): string {
  return `You are reviewing the pull requests from one coding session to propose the order to deploy them to production. You can only read; change nothing.

PRs:
${prs.map((pr, i) => prBlock(pr, i, services)).join('\n')}

Read what each PR changes: \`gh pr view <url> --json files,body\` and \`gh pr diff <url>\` for GitHub, or \`git log\` / \`git diff\` on its branch in its local folder. Work out what must reach production first: migrations and schema before the code that uses them, an API before its callers, a shared library before its consumers, config before the code that reads it.

Answer with JSON only, no prose:
{"order":[{"pr":"<url exactly as listed>","reason":"<one line, under 20 words>"}],"links":[{"from":"<repo>","to":"<repo>","label":"<2 to 4 words, e.g. calls its API>"}]}

"order" lists every PR above, the first to deploy first. "links" lists the dependencies you found between repos: "from" depends on "to". Leave "links" empty when the repos don't depend on each other.`;
}
