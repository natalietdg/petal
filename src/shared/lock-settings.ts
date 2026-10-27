// The test lock's entry in her user-level ~/.claude/settings.json: one entry for every repo, added and removed without
// touching anything else. The script it runs is ~/.petal/test-lock.mjs. Pure.
export const LOCK_SCRIPT_NAME = 'test-lock.mjs';
const OURS = `.petal/${LOCK_SCRIPT_NAME}`; // in every form of the entry: an older per-repo one or today's
export const LEGACY_LOCK_COMMAND = `node "$CLAUDE_PROJECT_DIR/${OURS}"`; // resolved wrong from a monorepo subfolder

const shellQuote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;

// The script's absolute path, quoted for the shell.
export const lockCommand = (script: string): string => `node ${shellQuote(script)}`;
export const LOCK_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit|Bash';

type Json = Record<string, unknown>;
interface HookGroup { matcher?: string; hooks?: { type?: string; command?: string }[] }

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isOurs = (group: HookGroup): boolean => Array.isArray(group?.hooks) && group.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(OURS));

const preToolUse = (settings: Json): HookGroup[] => {
  const hooks = isRecord(settings.hooks) ? settings.hooks : {};
  return Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse as HookGroup[] : [];
};

const withPreToolUse = (settings: Json, groups: HookGroup[]): Json => {
  const hooks: Json = { ...(isRecord(settings.hooks) ? settings.hooks : {}) };
  if (groups.length) hooks.PreToolUse = groups; else delete hooks.PreToolUse;
  const next: Json = { ...settings, hooks };
  if (!Object.keys(hooks).length) delete next.hooks;
  return next;
};

// Either form of the lock's entry, the old $CLAUDE_PROJECT_DIR one or the absolute one.
export const hasLockHook = (settings: unknown): boolean => isRecord(settings) && preToolUse(settings).some(isOurs);

const isCurrent = (group: HookGroup, command: string): boolean => group.matcher === LOCK_MATCHER && group.hooks?.length === 1 && group.hooks[0]?.command === command;

// True when the lock's entry is there but not in today's form for this script.
export const lockHookStale = (settings: unknown, script: string): boolean =>
  isRecord(settings) && hasLockHook(settings) && !preToolUse(settings).some((g) => isCurrent(g, lockCommand(script)));

// Adds the lock once, replacing an older form of its entry; every other key and hook stays as it was.
export function mergeLockHook(settings: unknown, script: string): Json {
  const base = isRecord(settings) ? settings : {};
  const command = lockCommand(script);
  if (preToolUse(base).some((g) => isCurrent(g, command))) return base;
  return withPreToolUse(base, [...preToolUse(base).filter((g) => !isOurs(g)), { matcher: LOCK_MATCHER, hooks: [{ type: 'command', command }] }]);
}

// Removes only the lock's entry, and empty containers it leaves behind.
export function unmergeLockHook(settings: unknown): Json {
  const base = isRecord(settings) ? settings : {};
  return hasLockHook(base) ? withPreToolUse(base, preToolUse(base).filter((g) => !isOurs(g))) : base;
}
