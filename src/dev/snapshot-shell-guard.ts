// Dev-only end-of-run check: no step's text reached a shell, and no shell tried to run a line it wasn't given.
import { claudeStarts, handoffWrites, pasteWrites, ptyWrites, repoWrites, testingFixture } from '../main/snapshot-mode';
import { guardsShell, leaksIn, shellOutput, typedRuns } from '../main/snapshot-shell';
import type { Js, Log } from './snapshot';

// Texts a past leak typed into her real shell (2026-10-16), checked by name even if no step records them again.
const KNOWN_LEAKS = ['Does the History preview', '/qa-kit:triage', 'fork it please'];

// Everything the app would have typed that snapshot runs record instead.
function recordedTexts(): string[] {
  const writes = [
    ...pasteWrites.map((w) => w.data),
    ...ptyWrites.map((w) => w.data),
    ...handoffWrites.map((w) => w.data),
    ...claudeStarts.flatMap((s) => (s.prompt ? [s.prompt] : [])),
    ...repoWrites.map((w) => w.command),
    ...testingFixture.runs.map((r) => r.typed),
    ...testingFixture.loopStarts.map((l) => l.command),
  ];
  return [...KNOWN_LEAKS, ...writes.flatMap(typedRuns)];
}

const BUFFERS = `PastelTerm.tabs.ids().map((id) => {
  const b = PastelTerm.tabs.get(id).term.buffer.active;
  return [id, Array.from({ length: b.length }, (_, i) => b.getLine(i).translateToString(true)).join('\\n')];
})`;

export async function shellGuardCheck(js: Js, log: Log): Promise<void> {
  if (!guardsShell()) {
    log('note: shell guard skipped; this live-Claude run uses her own shell on purpose');
    return;
  }
  const texts = recordedTexts();
  const buffers: [string, string][] = await js(BUFFERS).catch(() => []);
  const leaks = [
    ...[...shellOutput].flatMap(([tab, output]) => leaksIn(`pty ${tab}`, output, texts)),
    ...buffers.flatMap(([tab, text]) => leaksIn(`buffer ${tab}`, text, texts)),
  ];
  log(`${leaks.length ? 'FAIL' : 'ok'} shell guard: no step text reached a shell and no shell ran an unsigned line: `
    + `${shellOutput.size} shells, ${buffers.length} open buffers, ${new Set(texts).size} texts${leaks.length ? `; leaks ${JSON.stringify(leaks.slice(0, 8))}` : ''}`);
}
