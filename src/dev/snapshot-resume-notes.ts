// Resume notes (PASTEL_SNAPSHOT_MODE=resume-notes): the write Petal's quit runs, on two fixture sessions and a shell.
// Notes land under the harness's home, never in a session's folder, with the resume line, where it stopped, and in budget.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { BrowserWindow } from 'electron';
import type { Kit, TabsDeps } from './snapshot';
import { assertFixtureOutsideClaude } from './snapshot-views';
import { extraTabFixtures } from '../main/snapshot-mode';
import { petalHome } from '../main/petal-home';
import { BUDGET_MS, captureTabs, resumeRoot, writeResumeNotes } from '../main/resume-notes';

const RUNNING_ID = '7e5e0001-0000-4000-8000-00000000a001';
const IDLE_ID = '7e5e0002-0000-4000-8000-00000000a002';
const AT = '2026-10-28T10:30:00.000Z';

const RUNNING_REPLY = [
  '**The export button is half built.**',
  '',
  'The button shows in the toolbar; the save dialog is next.',
  '',
  '**Doing:** wiring the export button to the save dialog',
  '**Recommend:** CSV first, JSON later',
  '**Next:** pick the file formats',
  '',
  '**Decide:** CSV only, or CSV and JSON?',
].join('\n');

const IDLE_REPLY = `${'The colour picker now lives in Settings. '.repeat(30)}The toolbar keeps only the three main buttons.`;

function writeLog(file: string, prompt: string, reply: string): void {
  assertFixtureOutsideClaude(file);
  const base = path.basename(file);
  const lines = [
    { type: 'user', uuid: `${base}-u`, timestamp: AT, isSidechain: false, message: { role: 'user', content: prompt } },
    { type: 'assistant', uuid: `${base}-a`, timestamp: AT, isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text: reply }] } },
  ];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
}

const within = (dir: string, root: string): boolean => {
  const rel = path.relative(fs.realpathSync(root), fs.realpathSync(dir));
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
};

export async function resumeNotesCheck(kit: Kit, { win, openTab, sessions }: Pick<TabsDeps, 'openTab' | 'sessions'> & { win: BrowserWindow }): Promise<void> {
  const { js, waitFor, log, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} resume notes: ${what}`);
  const dir = path.join(outDir, 'resume-notes');
  const repo = path.join(dir, 'sample repo'); // a space, so the cd is quoted
  const plain = path.join(dir, 'plain-folder');
  const root = resumeRoot();
  const rootExisted = fs.existsSync(root);
  const before = new Set(rootExisted ? fs.readdirSync(root) : []);
  const startTabs: string[] = await js('PastelTerm.tabs.ids()');
  const startActive: string | null = await js('PastelTerm.tabs.active()?.id ?? null');

  try {
    // A git folder on its own branch with one untracked file, and a plain folder.
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(plain, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'sample-branch'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'notes.txt'), 'draft\n');
    writeLog(path.join(dir, `${RUNNING_ID}.jsonl`), 'make the export button open the save dialog', RUNNING_REPLY);
    writeLog(path.join(dir, `${IDLE_ID}.jsonl`), 'move the colour picker out of the toolbar', IDLE_REPLY);

    extraTabFixtures.push(
      { sessionId: RUNNING_ID, transcript: path.join(dir, `${RUNNING_ID}.jsonl`), status: 'busy', cwd: repo },
      { sessionId: IDLE_ID, transcript: path.join(dir, `${IDLE_ID}.jsonl`), status: 'idle', cwd: plain },
    );
    openTab(win.webContents, { background: true });
    openTab(win.webContents, { background: true });
    const loaded = await waitFor(() => {
      const ids = [...sessions.values()].filter((s) => s.feed.shownReplies.length).map((s) => s.feed.session?.sessionId);
      return ids.includes(RUNNING_ID) && ids.includes(IDLE_ID) ? ids : null;
    }, 15000);
    check(loaded, `both fixture tabs read their logs: ${JSON.stringify(loaded)}`);
    openTab(win.webContents, { background: true }); // no fixture left: a plain shell
    const shellUp = await waitFor(() => (sessions.size >= startTabs.length + 3 ? true : null), 10000);
    check(shellUp, `a plain shell tab is open: ${sessions.size} tabs`);

    // The same write the quit runs, timed end to end.
    const started = Date.now();
    const result = await writeResumeNotes(captureTabs(sessions.values()));
    const took = Date.now() - started;
    check(took < BUDGET_MS && result.ms < BUDGET_MS, `finished in ${took}ms, under the ${BUDGET_MS}ms budget`);
    check(fs.existsSync(result.dir) && within(result.dir, petalHome()) && path.dirname(result.dir) === root, `folder under the harness home: ${result.dir}`);
    check(/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/.test(result.dir), 'folder named by date and time');

    const read = (name: string): string => { try { return fs.readFileSync(path.join(result.dir, name), 'utf8'); } catch { return ''; } };
    const fileOf = (id: string) => result.files.find((f) => f.endsWith(`-${id.slice(0, 8)}.md`)) ?? '';
    const runningFile = fileOf(RUNNING_ID);
    const idleFile = fileOf(IDLE_ID);
    const index = read('index.md');
    check(runningFile && idleFile, `one note per session: ${JSON.stringify(result.files)}`);
    check(index.includes(`](${runningFile})`) && index.includes(`](${idleFile})`), 'index.md links both sessions');
    check(/: shell, nothing to resume$/m.test(index), 'index.md lists the shell as nothing to resume');

    const running = read(runningFile);
    check(running.includes(`\`\`\`bash\ncd '${repo}' && claude --resume '${RUNNING_ID}'\n\`\`\``), 'resume command has the quoted folder and the right id');
    check(running.includes('- Branch: sample-branch'), 'branch read from the folder');
    check(running.includes('- State: Running'), 'busy session marked Running');
    check(running.includes('> make the export button open the save dialog'), 'Where it stopped has her last prompt');
    check(running.includes('Last reply: **The export button is half built.**'), 'Where it stopped has the headline');
    check(running.includes('- **Doing:** wiring the export button') && running.includes('- **Next:** pick the file formats'), 'Where it stopped has the status lines');
    check(running.includes('- **Decide:** CSV only, or CSV and JSON?'), 'Where it stopped has the open decision');
    check(running.includes('## Uncommitted') && running.includes('?? notes.txt'), 'Uncommitted lists the untracked file');

    const idle = read(idleFile);
    check(idle.includes('- State: Idle') && !idle.includes('Branch:') && !idle.includes('## Uncommitted'), 'plain folder: Idle, no branch or uncommitted section');
    check(idle.includes('End of the last reply:') && idle.includes('three main buttons.'), 'no status lines: the end of the last reply');

    const leaked = [repo, plain].flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.md')));
    check(!leaked.length, `nothing written into the sessions' folders: ${JSON.stringify(leaked)}`);

    // Out of time before git starts: the note still lands, with a one-line skip note.
    const late = await writeResumeNotes(captureTabs(sessions.values()), { root: path.join(dir, 'late'), budgetMs: 0 });
    const lateNote = fs.readFileSync(path.join(late.dir, fileOf(RUNNING_ID)), 'utf8');
    check(lateNote.includes('_Uncommitted files skipped: out of time at quit._') && lateNote.includes('## Resume'), 'a timed-out lookup is skipped with a note');

    fs.copyFileSync(path.join(result.dir, runningFile), path.join(outDir, 'resume-notes-sample.md'));
    log(`resume notes sample: ${path.join(outDir, 'resume-notes-sample.md')}`);
  } finally {
    extraTabFixtures.length = 0;
    const opened: string[] = (await js('PastelTerm.tabs.ids()')).filter((id: string) => !startTabs.includes(id));
    for (const id of opened) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(id)})`);
    const closedAgain = await waitFor(async () => ((await js('PastelTerm.tabs.ids()')).length === startTabs.length ? true : null), 8000);
    check(closedAgain, `test tabs closed again: ${JSON.stringify(await js('PastelTerm.tabs.ids()'))}`);
    if (startActive) await js(`PastelTerm.tabs.activate(${JSON.stringify(startActive)})`);
    if (!rootExisted) fs.rmSync(root, { recursive: true, force: true });
    else for (const name of fs.readdirSync(root)) if (!before.has(name)) fs.rmSync(path.join(root, name), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
