// Factory › Jobs: each repo's jobs, its ship mode and first-run card, and her buttons. The station editor folds below
// (workflow-factory.ts). Main does every git step and file write; this only asks.
import { el, isIpcError } from './dom';
import * as factoryJobs from './factory-jobs';
import { actionsFor, isFinished, isWaiting, type JobAction, type JobView, type JobsView, type RepoJobs, type ShipMode } from '../shared/factory-jobs';

const SHIP_NAMES: Record<ShipMode, string> = { 'local-merge': 'Merge into main on this computer', pr: 'Push the branch for a pull request' };
const ACTION_NAMES: Record<JobAction, string> = {
  approve: 'Approve', reject: 'Send back', guidance: 'Give guidance', resume: 'Resume', discard: 'Discard', 'undo-merge': 'Undo merge', 'take-over': 'Take over',
};
const NOTE_ACTIONS: readonly JobAction[] = ['reject', 'guidance'];
const CONFIRM: Partial<Record<JobAction, string>> = {
  discard: 'Discard this job? Its branch and copy are deleted, including changes you made there.',
  'undo-merge': 'Undo this merge? Petal adds a commit on main that reverses it.',
};
const EMPTY = 'No jobs yet. In any session, type /factory and what to build.';
const FINISHED_SHOWN = 8;

interface Open { jobId: string; action: JobAction }
interface State { view: JobsView; open: Open | null; note: { text: string; error: boolean } | null; busy: boolean }

const button = (className: string, text: string, onClick: () => void): HTMLButtonElement => {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};

export function tokensText(n: number | null): string {
  if (!n) return ''; // nothing spent yet, or the Claude folder is off: no line
  if (n < 1000) return `${n} tokens`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k tokens`;
  return `${(n / 1_000_000).toFixed(1)}M tokens`;
}

export function agoText(at: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - at) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

// Waiting on her first, then stalled, working, queued; finished last.
const ORDER = (j: JobView): number => (j.waitReason ? 0 : j.state === 'stalled' ? 1 : j.state === 'queued' ? 3 : isFinished(j.state) ? 4 : 2);
const sorted = (jobs: readonly JobView[]): JobView[] => [...jobs].sort((a, b) => ORDER(a) - ORDER(b) || b.updatedAt - a.updatedAt);

export function renderJobs(view: JobsView): HTMLElement {
  const root = el('section', 'fj');
  root.setAttribute('aria-label', 'Factory jobs');
  const state: State = { view, open: null, note: null, busy: false };
  draw(root, state);
  const off = factoryJobs.onChange(() => {
    if (!root.isConnected) { off(); return; }
    const next = factoryJobs.current();
    if (next && !state.busy) { state.view = next; draw(root, state); }
  });
  return root;
}

function draw(root: HTMLElement, state: State): void {
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.focusKey;
  const repos = state.view.repos;
  const nodes: HTMLElement[] = [el('h2', 'fj-title', 'Jobs')];
  if (!repos.length) nodes.push(el('p', 'wf-empty fj-empty', 'Open a Claude session in a git repo, then type /factory and what to build.'));
  for (const repo of repos) nodes.push(repoBlock(root, state, repo));
  if (state.note) {
    const note = el('p', state.note.error ? 'wf-error fj-note' : 'fj-note', state.note.text);
    note.setAttribute('role', 'status');
    nodes.push(note);
  }
  root.replaceChildren(...nodes);
  if (focusKey) root.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
}

function repoBlock(root: HTMLElement, state: State, repo: RepoJobs): HTMLElement {
  const block = el('section', 'fj-repo');
  block.dataset.repo = repo.repo;
  const head = el('div', 'fj-repo-head');
  head.append(el('h3', 'fj-repo-name', repo.name), shipSwitch(root, state, repo));
  block.append(head);
  if (!repo.seen) block.append(firstRun(root, state, repo));
  const live = sorted(repo.jobs.filter((j) => !isFinished(j.state)));
  const finished = sorted(repo.jobs.filter((j) => isFinished(j.state))).slice(0, FINISHED_SHOWN);
  if (!live.length && !finished.length) block.append(el('p', 'wf-empty fj-empty', EMPTY));
  if (live.length) block.append(list(root, state, live, 'Jobs in progress'));
  if (finished.length) {
    block.append(el('h4', 'fj-sub', 'Finished'));
    block.append(list(root, state, finished, 'Finished jobs'));
  }
  return block;
}

function shipSwitch(root: HTMLElement, state: State, repo: RepoJobs): HTMLElement {
  const box = el('div', 'fj-ship');
  const bar = el('div', 'view-toggle fj-ship-toggle');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', `How ${repo.name} ships a finished job`);
  for (const mode of ['local-merge', 'pr'] as const) {
    const b = button('', mode === 'local-merge' ? 'Merge locally' : 'Pull request', async () => {
      if (repo.ship.mode === mode) return;
      const result = await window.pastel.factory.setShipMode(repo.repo, mode);
      if (isIpcError(result)) state.note = { text: result.error, error: true };
      else { factoryJobs.set(result); state.view = result; state.note = null; }
      draw(root, state);
    });
    b.dataset.ship = mode;
    b.dataset.focusKey = `ship-${repo.repo}-${mode}`;
    b.setAttribute('aria-pressed', String(repo.ship.mode === mode));
    b.title = SHIP_NAMES[mode];
    bar.append(b);
  }
  const why = repo.ship.saved && repo.ship.mode !== repo.ship.detected ? `You chose this. The remote suggests ${repo.ship.detected === 'pr' ? 'a pull request' : 'a local merge'}.` : repo.ship.saved ? 'You chose this.' : 'Picked from the repo’s remote.';
  box.append(bar, el('span', 'fj-ship-why', `${SHIP_NAMES[repo.ship.mode]}. ${why}`));
  return box;
}

function firstRun(root: HTMLElement, state: State, repo: RepoJobs): HTMLElement {
  const card = el('section', 'wf-card fj-first');
  card.setAttribute('aria-label', `Factory in ${repo.name}`);
  const shipping = repo.ship.mode === 'pr'
    ? 'Low-risk jobs push their branch for a pull request by themselves. Main is never touched.'
    : 'Low-risk jobs merge into main on this computer by themselves, and you can undo them. Nothing is pushed.';
  card.append(
    el('h4', 'wf-card-title', `How jobs run in ${repo.name}`),
    el('p', 'fj-first-text', `Jobs run on their own branch in a separate copy. ${shipping} You approve anything touching auth, payments, CI, migrations, email or new packages.`),
    button('cz-quiet-button fj-first-ok', 'Got it', async () => {
      const result = await window.pastel.factory.seen(repo.repo);
      if (isIpcError(result)) state.note = { text: result.error, error: true };
      else { factoryJobs.set(result); state.view = result; }
      draw(root, state);
    }),
  );
  return card;
}

function list(root: HTMLElement, state: State, jobs: readonly JobView[], label: string): HTMLElement {
  const ol = el('ol', 'fj-list');
  ol.setAttribute('aria-label', label);
  for (const job of jobs) ol.append(row(root, state, job));
  return ol;
}

function row(root: HTMLElement, state: State, job: JobView): HTMLLIElement {
  const li = el('li', `fj-job fj-job-${job.state}${job.waitReason ? ' fj-job-waiting' : ''}`);
  li.dataset.job = job.id;
  li.tabIndex = -1; // a Waiting row lands here, never on a button that merges
  const head = el('div', 'fj-job-head');
  head.append(el('span', 'fj-job-title', job.title), el('span', `fj-state fj-state-${isWaiting(job.state) || job.waitReason ? 'waiting' : job.state}`, job.label));
  li.append(head);
  if (job.waitReason && job.waitReason !== job.label) li.append(el('p', 'fj-reason', job.waitReason));
  const meta = [job.rework && job.state !== 'escalated' ? `Rework ${job.rework}/${job.reworkCap}` : '', tokensText(job.tokens), agoText(job.since)].filter(Boolean);
  li.append(el('p', 'fj-meta', meta.join(' · ')));
  if (job.verdicts.length) {
    const verdicts = el('ul', 'fj-verdicts');
    verdicts.setAttribute('aria-label', 'Verdicts this round');
    for (const v of job.verdicts) verdicts.append(el('li', `fj-verdict${/^FAIL/.test(v.line) ? ' fj-verdict-fail' : ''}`, `${v.name} · ${v.line}`));
    li.append(verdicts);
  }
  if (job.riskyHits.length > 1) li.append(el('p', 'fj-meta', `Also touches ${job.riskyHits.slice(1).map((h) => `${h.label} (${h.file})`).join(', ')}`));
  if (job.prUrl) {
    const link = el('a', 'fj-pr', 'Open the pull request page');
    link.href = job.prUrl;
    link.target = '_blank';
    link.rel = 'noreferrer';
    li.append(link);
  }
  // What she is approving, on the row: the spec, and at Approve the files the branch changed.
  if (job.spec) {
    const spec = el('details', 'fj-spec');
    spec.append(el('summary', 'fj-spec-summary', 'Read the spec'), el('pre', 'fj-spec-text', job.spec));
    if (job.state === 'spec') spec.open = true;
    li.append(spec);
  }
  if (job.changes?.length) {
    const changes = el('details', 'fj-spec fj-changes');
    const files = el('ul', 'fj-files');
    for (const file of job.changes) files.append(el('li', '', file));
    changes.append(el('summary', 'fj-spec-summary', `Changed files (${job.changes.length})`), files);
    li.append(changes);
  }
  const actions = actionsFor(job);
  if (actions.length) {
    const bar = el('div', 'fj-actions');
    for (const action of actions) {
      const name = buttonName(job, action);
      const b = button(`cz-quiet-button fj-act fj-act-${action}`, name, () => {
        if (NOTE_ACTIONS.includes(action) || CONFIRM[action]) { state.open = { jobId: job.id, action }; draw(root, state); return; }
        void act(root, state, job, action);
      });
      b.dataset.focusKey = `${job.id}-${action}`;
      b.disabled = state.busy;
      bar.append(b);
    }
    li.append(bar);
  }
  if (state.open?.jobId === job.id) li.append(openPanel(root, state, job, state.open.action));
  return li;
}

// The same action reads differently where it means something different.
function buttonName(job: JobView, action: JobAction): string {
  if (action === 'approve' && job.state === 'spec') return 'Build it';
  if (action === 'approve' && job.state === 'escalated') return 'I fixed it · review again';
  if (action === 'approve' && job.state === 'approve') return 'Approve merge';
  if (action === 'take-over' && job.state === 'approve') return 'See the changes';
  return ACTION_NAMES[action];
}

function openPanel(root: HTMLElement, state: State, job: JobView, action: JobAction): HTMLElement {
  const box = el('div', 'fx-confirm fj-open');
  const cancel = button('cz-quiet-button fj-cancel', 'Cancel', () => { state.open = null; draw(root, state); });
  if (NOTE_ACTIONS.includes(action)) {
    const label = el('label', 'fx-field fj-note-field');
    const input = el('textarea', 'fx-input fx-textarea fj-note-input');
    input.rows = 2;
    input.placeholder = action === 'guidance' ? 'What should the builder try?' : 'What should change?';
    label.append(el('span', 'fx-label', action === 'guidance' ? 'Guidance for the next try' : 'What to change'), input);
    box.append(label, button('cz-quiet-button fj-send', 'Send', () => void act(root, state, job, action, input.value)), cancel);
    setTimeout(() => input.focus(), 0);
    return box;
  }
  const yes = button('cz-quiet-button fj-confirm-yes', ACTION_NAMES[action], () => void act(root, state, job, action));
  box.append(el('span', '', CONFIRM[action] ?? ''), yes, cancel);
  setTimeout(() => yes.focus(), 0);
  return box;
}

async function act(root: HTMLElement, state: State, job: JobView, action: JobAction, note?: string): Promise<void> {
  state.busy = true;
  const result = await window.pastel.factory.jobAction({ repo: job.repo, id: job.id, action, ...(note !== undefined ? { note } : {}) });
  state.busy = false;
  if (isIpcError(result)) state.note = { text: result.error, error: true };
  else {
    state.open = null;
    const after = job.state === 'stalled' ? 'Resume' : job.state === 'escalated' ? 'I fixed it · review again' : null;
    state.note = action === 'take-over' ? { text: `Opened ${job.title} in a new tab.${after ? ` When you’re done, press ${after}.` : ''}`, error: false } : null;
  }
  const fresh = await factoryJobs.refresh();
  if (fresh) state.view = fresh;
  draw(root, state);
}
