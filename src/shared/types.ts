// Data shapes that cross the IPC boundary between main and the renderer.
import type { PendingQuestion } from './prompt-answer';

export interface LabelColors {
  pill: string;
  ink: string;
  wash: string;
}

export type OutcomeLabel = 'done' | 'why' | 'watch' | 'decide' | 'next';

export interface Theme {
  label: string;
  dark: boolean;
  terminal: {
    background: string;
    foreground: string;
    cursor: string;
    selectionBackground: string;
    ansi: string[];
  };
  reader: {
    background: string;
    foreground: string;
    muted: string;
    link: string;
    codeBackground: string;
    highlight: string;
    highlightInk: string;
    rule: string;
    labels: Record<OutcomeLabel, LabelColors>;
  };
}

export type Themes = Record<string, Theme>;

// One reply in the reader: all assistant text between two of her prompts.
export interface Reply {
  id: string | undefined;
  timestamp: string | undefined;
  markdown: string;
  prompt: string;
}

// One of her prompts from the transcript, before Claude has written any text for it.
export interface WaitingPrompt {
  id: string | undefined;
  timestamp: string | undefined;
  prompt: string;
}

export type ReaderState = 'none' | 'live' | 'ended';

// main -> renderer on 'reader:replies'; tabId and label are added per tab.
export interface ReaderUpdate {
  state: ReaderState;
  replies: Reply[];
  waiting: WaitingPrompt[]; // her prompts Claude hasn't answered with text yet
  promptCount: number; // her prompts in this session so far
  busy: boolean;
  sessionId: string | null;
  cwd: string | null;
  question: PendingQuestion | null; // an AskUserQuestion waiting for her answer
}

export interface TabReaderUpdate extends ReaderUpdate {
  tabId: string;
  label: string;
}

export type TabId = string;

export interface TermSize {
  cols: number;
  rows: number;
}

// [id, label] pairs for menus and Customize chips.
export type Choice = readonly [id: string, label: string];

// Which session a flow request is about.
export type FlowTarget = { kind: 'current' } | { kind: 'history'; sessionId: string };

// Handlers wrapped by the IPC guard return this instead of throwing.
export interface IpcError {
  error: string;
}
