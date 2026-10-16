// The shell guard for snapshot runs: no step's text is ever typed into, or run by, a real shell as her.
// Layer 1 (tabs.ts and friends): what the renderer would type is recorded, never written to a pty.
// Layer 2 (here): guarded runs spawn a stand-in zsh with its own HOME that runs only the harness's signed lines.
// Layer 3 (here + the harness's end check): every byte a shell prints is kept, and a leak sign fails the run.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fixtureFile, isSnapshotRun, snapshotOutDir } from './snapshot-mode';

// These modes, and the no-fixture default, drive a real claude in her own shell on purpose.
const LIVE_CLAUDE_MODES: readonly string[] = ['open', 'resume'];

export const isLiveClaudeRun = (): boolean => {
  if (!isSnapshotRun()) return false;
  const mode = process.env.PASTEL_SNAPSHOT_MODE;
  return mode ? LIVE_CLAUDE_MODES.includes(mode) : !fixtureFile();
};

// Every other snapshot run gets the stand-in shell.
export const guardsShell = (): boolean => isSnapshotRun() && !isLiveClaudeRun();

// Per run, so no fixture text can carry it by accident.
const SIGNATURE = `petal-${crypto.randomBytes(6).toString('hex')}`;
export const REFUSED_MARKER = 'petal-snapshot refused a typed line';

// A line the harness itself types; only a guarded shell needs it signed.
export const harnessLine = (command: string): string => (guardsShell() ? `${SIGNATURE} ${command}\r` : `${command}\r`);

export const shellHome = (): string => path.join(snapshotOutDir(), 'shell-home');

// accept-line and its siblings run a line only when it carries the signature; anything else is swapped for the marker.
const guardRc = (): string => `# Petal snapshot stand-in shell: runs only the harness's signed lines.
unset HISTFILE
SAVEHIST=0
PS1='petal-snapshot %# '
RPROMPT=''
petal_guard_accept() {
  local signed='${SIGNATURE} '
  if [[ $BUFFER == "$signed"* ]]; then
    BUFFER=\${BUFFER#"$signed"}
  elif [[ -n \${BUFFER//[[:space:]]/} ]]; then
    BUFFER="print -r -- '${REFUSED_MARKER}'"
  fi
  zle .accept-line
}
for widget in accept-line accept-and-hold accept-line-and-down-history accept-and-infer-next-history; do
  zle -N $widget petal_guard_accept
done
`;

export interface ShellSpawn { file: string; args: string[]; cwd: string; env: Record<string, string> }

// zsh -l still reads /etc/zprofile (PATH) and /etc/zshrc, but HOME and ZDOTDIR are the scratch folder, so her rc files and history are never read.
export function guardedShell(): ShellSpawn {
  const home = shellHome();
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, '.zshrc'), guardRc());
  for (const file of ['.zshenv', '.zprofile', '.zlogin']) fs.writeFileSync(path.join(home, file), '');
  return { file: '/bin/zsh', args: ['-l'], cwd: home, env: { HOME: home, ZDOTDIR: home, SHELL: '/bin/zsh' } };
}

// ---- Layer 3: what every guarded shell printed, kept per tab (closed tabs too) for the end-of-run scan.
export const shellOutput = new Map<string, string>(); // `${contentsId}:${tabId}` -> everything that tab's shell printed

export const recordShellOutput = (key: string, data: string): void => {
  shellOutput.set(key, (shellOutput.get(key) ?? '') + data);
};

// zsh's own errors mean it tried to run a line; the marker means the stand-in refused one.
const LEAK_SIGNS = /command not found|zsh: (?:no matches found|no such file or directory|parse error|bad pattern|unknown file attribute|permission denied|event not found)|petal-snapshot refused a typed line/i;

// eslint-disable-next-line no-control-regex -- stripping terminal escapes is the point
const ESCAPES = /\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>78DEHMc]/g;
// eslint-disable-next-line no-control-regex -- control characters are dropped, so a line zle wrapped still matches
const CONTROLS = /[\x00-\x1f\x7f]+/g;
export const plainText = (raw: string): string => raw.replace(ESCAPES, '').replace(CONTROLS, '');

// A write's text runs long enough to be unmistakable; key presses and terminal replies are shorter.
const MIN_RUN = 10;
const RUN_PREFIX = 40; // fits on the prompt line, so a wrapped or redrawn line still shows its start intact
// eslint-disable-next-line no-control-regex -- control characters split a write into its typed runs
const RUN_SPLIT = /\x1b\[20[01]~|[\x00-\x1f\x7f]+/;
export const typedRuns = (data: string): string[] =>
  data.split(RUN_SPLIT).map((run) => run.trim()).filter((run) => run.length >= MIN_RUN).map((run) => run.slice(0, RUN_PREFIX));

export interface ShellLeak { tab: string; what: string; context: string }

// Every leak in one transcript: a zsh error or refusal, or any of the given texts a step meant only to record.
export function leaksIn(tab: string, transcript: string, texts: readonly string[]): ShellLeak[] {
  const plain = plainText(transcript);
  const found: ShellLeak[] = [];
  const sign = LEAK_SIGNS.exec(plain);
  const around = (at: number) => plain.slice(Math.max(0, at - 60), at + 100).replace(/\s+/g, ' ');
  if (sign) found.push({ tab, what: sign[0], context: around(sign.index) });
  for (const text of new Set(texts)) {
    const at = plain.indexOf(text);
    if (at >= 0) found.push({ tab, what: text, context: around(at) });
  }
  return found;
}
