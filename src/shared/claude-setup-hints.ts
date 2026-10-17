// The two setup lines the reader can show: how to install Claude Code, and the PATH line a shell is missing.

// From code.claude.com/docs/en/setup (native install, macOS and Linux); Get started shows the same command.
export const INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash';

// Her shell's rc file sets PATH without the folder claude is in, so Petal types claude's full path instead.
export interface PathTip {
  dir: string;
  rcFile: string; // where the line goes, for her login shell
  line: string; // what to add; Petal never edits the file itself
}

// Inside double quotes only these four still mean something to the shell.
const doubleQuoted = (text: string): string => text.replace(/["$`\\]/g, (ch) => `\\${ch}`);

export function pathTipFor(dir: string, shell: string | undefined): PathTip {
  const name = (shell ?? '').split('/').pop() ?? '';
  const rcFile = name === 'bash' ? '~/.bash_profile' : name === 'fish' ? '~/.config/fish/config.fish' : '~/.zshrc';
  const line = name === 'fish' ? `fish_add_path "${doubleQuoted(dir)}"` : `export PATH="${doubleQuoted(dir)}:$PATH"`;
  return { dir, rcFile, line };
}
