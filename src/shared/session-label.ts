// The one naming rule for a Claude session, used by every place that shows one (panel, tabs, History, reader, agents).
import { stripPasted } from './pasted-content';

// Where a name can come from, in History's priority order.
export interface SessionNameSources {
  organizerTitle?: string | null; // Petal's organizer, once it has labelled the session
  title?: string | null; // Claude Code's own ai-title, else its first prompt (as history.ts reads it)
  firstPrompt?: string | null; // her first prompt, while Claude Code has no title yet
  cwd?: string | null; // the session's folder, for the last fallback
}

export const SESSION_LABEL_MAX = 60; // every surface cuts here; the tooltip carries the full title
export const NEW_SESSION = 'new session';
export const NO_SESSION_LABEL = 'Shell'; // a tab with no Claude in it is not a session

const flat = (text: string | null | undefined): string => stripPasted(text ?? '').replace(/\s+/g, ' ').trim();

// "~/widget-service" or "/home/x/widget-service" -> "widget-service".
export const folderName = (cwd: string | null | undefined): string => (cwd ?? '').replace(/\/+$/, '').split('/').pop() ?? '';

// Full title: organizer, Claude Code's title, first prompt, then "<folder> · new session".
export function sessionTitle({ organizerTitle, title, firstPrompt, cwd }: SessionNameSources): string {
  const named = flat(organizerTitle) || flat(title) || flat(firstPrompt);
  if (named) return named;
  const folder = folderName(cwd);
  return folder ? `${folder} · ${NEW_SESSION}` : 'New session';
}

// What a surface shows: cut at one length everywhere, so a name reads the same in the panel, a tab and History.
export function sessionLabelText(fullTitle: string): string {
  const title = fullTitle.trim();
  return title.length > SESSION_LABEL_MAX ? `${title.slice(0, SESSION_LABEL_MAX - 1).trimEnd()}…` : title;
}
