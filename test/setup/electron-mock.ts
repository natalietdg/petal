// Every suite gets a fake electron: userData is whatever temp dir the test set, notifications are recorded.
import { vi } from 'vitest';

export interface ElectronStub {
  userData: string | null;
  notices: { title?: string; body?: string }[];
  notificationsSupported: boolean;
}

declare global {
  var __electronStub: ElectronStub;
}

globalThis.__electronStub = { userData: null, notices: [], notificationsSupported: true };

vi.mock('electron', () => {
  const stub = () => globalThis.__electronStub;
  class Notification {
    private readonly options: { title?: string; body?: string };
    constructor(options: { title?: string; body?: string }) {
      this.options = options;
    }
    static isSupported(): boolean {
      return stub().notificationsSupported;
    }
    show(): void {
      stub().notices.push(this.options);
    }
  }
  const app = {
    getPath: (name: string): string => {
      const dir = stub().userData;
      if (!dir) throw new Error(`test forgot to set a temp userData before app.getPath(${name})`);
      return dir;
    },
  };
  const BrowserWindow = { getAllWindows: (): unknown[] => [] }; // no windows in a test: broadcasts go nowhere
  return { app, Notification, BrowserWindow, default: { app, Notification, BrowserWindow } };
});
