// The test lock's entry in a project's .claude/settings.local.json: added and removed without touching anything else. Pure.
export const LOCK_SCRIPT = '.petal/test-lock.mjs';
export const LOCK_COMMAND = `node "$CLAUDE_PROJECT_DIR/${LOCK_SCRIPT}"`;
export const LOCK_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit|Bash';

type Json = Record<string, unknown>;
interface HookGroup { matcher?: string; hooks?: { type?: string; command?: string }[] }

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isOurs = (group: HookGroup): boolean => Array.isArray(group?.hooks) && group.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(LOCK_SCRIPT));

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

export const hasLockHook = (settings: unknown): boolean => isRecord(settings) && preToolUse(settings).some(isOurs);

// Adds the lock once; every other key and hook stays as it was.
export function mergeLockHook(settings: unknown): Json {
  const base = isRecord(settings) ? settings : {};
  if (hasLockHook(base)) return base;
  return withPreToolUse(base, [...preToolUse(base), { matcher: LOCK_MATCHER, hooks: [{ type: 'command', command: LOCK_COMMAND }] }]);
}

// Removes only the lock's entry, and empty containers it leaves behind.
export function unmergeLockHook(settings: unknown): Json {
  const base = isRecord(settings) ? settings : {};
  return hasLockHook(base) ? withPreToolUse(base, preToolUse(base).filter((g) => !isOurs(g))) : base;
}
