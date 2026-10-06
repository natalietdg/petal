// One terminal tab in one window: its shell and the reader feed pinned to it.
import type { IPty } from 'node-pty';
import type { WebContents } from 'electron';
import type { ReaderFeed } from './reader-feed';
import type { TabId } from '../shared/types';

export interface TabSession {
  pty: IPty;
  feed: ReaderFeed;
  contentsId: number;
  tabId: TabId;
}

// `${webContents.id}:${tabId}` -> session
export type TabSessions = Map<string, TabSession>;

export type ActiveSession = (contentsId: number) => TabSession | undefined;

export type OpenTab = (contents: WebContents | undefined, options?: { command?: string }) => void;
