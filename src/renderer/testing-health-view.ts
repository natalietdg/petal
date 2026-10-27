// Suite health in the Testing tab: flaky, never-failing, slowest and duplicate-looking tests from the run history,
// and a fast core stage to run first. Recommendations only; nothing here deletes or skips a test.
import { el } from './dom';
import { duration } from './testing-view';
import { testLabel } from '../shared/testing-history';
import { CORE_STAGE_ID, STEADY_RUNS, type SuiteHealth } from '../shared/suite-health';

export interface HealthHandlers { addCore: (command: string) => void }

function group(title: string, hint: string, rows: { name: string; meta: string; tone?: string }[]): HTMLElement | null {
  if (!rows.length) return null;
  const box = el('section', 'tst-health-group');
  box.setAttribute('aria-label', title);
  const head = el('h4', 'tst-sub tst-health-head');
  head.append(el('span', null, title), el('span', 'tst-crit-count', String(rows.length)));
  const list = el('ul', 'tst-health-list');
  for (const row of rows) {
    const item = el('li', `tst-health-row${row.tone ? ` is-${row.tone}` : ''}`);
    item.append(el('span', 'tst-health-name', row.name), el('span', 'tst-health-meta', row.meta));
    list.append(item);
  }
  box.append(head, el('p', 'tst-muted tst-health-hint', hint), list);
  return box;
}

export function healthPanel(health: SuiteHealth, stages: readonly { id: string; command: string }[], handlers: HealthHandlers, busy: boolean): HTMLElement {
  const box = el('div', 'tst-health');
  if (!health.runsRead) {
    box.append(el('p', 'tst-muted', 'No runs yet. Suite health reads your runs and Claude’s once there are some.'));
    return box;
  }
  box.append(el('p', 'tst-muted tst-health-about', `From ${health.runsRead} run${health.runsRead === 1 ? '' : 's'}. Suggestions only: nothing is deleted or skipped.`));

  // The core stage first: what to run before everything else.
  const core = el('section', 'tst-health-core');
  core.setAttribute('aria-label', 'Core stage');
  const head = el('h4', 'tst-sub tst-health-head');
  head.append(el('span', null, 'Core stage'), el('span', 'tst-crit-count', `${health.core.length} test${health.core.length === 1 ? '' : 's'}`));
  core.append(head);
  if (!health.core.length) {
    core.append(el('p', 'tst-muted', 'Nothing failed recently and no tested file changed this week, so there is no core to run first.'));
  } else {
    const failed = health.core.filter((t) => t.why !== 'changed').length;
    const changed = health.core.filter((t) => t.why !== 'failed').length;
    core.append(el('p', 'tst-muted tst-health-hint', [failed && `${failed} failed recently`, changed && `${changed} touch${changed === 1 ? 'es' : ''} files changed this week`].filter(Boolean).join(' · ')));
    if (health.command) {
      core.append(el('code', 'tst-command tst-health-command', health.command));
      const existing = stages.find((s) => s.id === CORE_STAGE_ID);
      const same = existing?.command === health.command;
      const add = el('button', 'tst-button tst-health-add', same ? 'Core stage is first' : existing ? 'Update core stage' : 'Add core stage');
      add.type = 'button';
      add.disabled = same || busy;
      add.title = 'Puts it first in the repo’s suite. A new command still asks before its first run.';
      add.addEventListener('click', () => handlers.addCore(health.command as string));
      core.append(add);
    }
    if (health.unfiltered.length) core.append(el('p', 'tst-muted tst-health-hint', `No filter Petal can build for ${health.unfiltered.join(', ')}; those tests stay in their own stage.`));
  }
  box.append(core);

  const groups = [
    group('Flaky', 'Passed and failed close together, or kept changing. Fix or quarantine before trusting a red run.', health.flaky.map((t) => ({ name: testLabel(t), meta: `${t.passes} pass · ${t.fails} fail`, tone: 'flaky' }))),
    group('Slowest', 'Median time per run.', health.slowest.map((t) => ({ name: testLabel(t), meta: duration(t.medianMs) }))),
    group('Never failed', `Passed in every one of ${STEADY_RUNS}+ runs. Keep them, but they need not run first.`, health.steady.map((t) => ({ name: testLabel(t), meta: `${t.runs} runs` }))),
    group('Look duplicated', 'The same test name in more than one file.', health.duplicates.map((d) => ({ name: d.title, meta: d.files.map((f) => f.split('/').pop()).join(', ') }))),
  ].filter((g): g is HTMLElement => g !== null);
  if (groups.length) box.append(...groups);
  else box.append(el('p', 'tst-muted', 'No flaky, slow or duplicate-looking tests yet.'));
  return box;
}
