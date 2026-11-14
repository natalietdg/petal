import { describe, expect, it } from 'vitest';
import { firstConcludeWarning, shouldCloseConcludedTab } from '../src/main/conclude-tab';

describe('shouldCloseConcludedTab', () => {
  it('closes the tab once claude exited, the shell is idle and other tabs remain', () => {
    expect(shouldCloseConcludedTab({ claudeClosed: true, tabsInWindow: 2, foregroundJob: false })).toBe(true);
  });

  it("keeps the window's last tab, showing the ended reader", () => {
    expect(shouldCloseConcludedTab({ claudeClosed: true, tabsInWindow: 1, foregroundJob: false })).toBe(false);
  });

  it('keeps the tab while a foreground job still runs in it', () => {
    expect(shouldCloseConcludedTab({ claudeClosed: true, tabsInWindow: 3, foregroundJob: true })).toBe(false);
  });

  it('keeps the tab when claude did not exit', () => {
    expect(shouldCloseConcludedTab({ claudeClosed: false, tabsInWindow: 3, foregroundJob: false })).toBe(false);
  });
});

describe('firstConcludeWarning', () => {
  it('asks before the first close of a tab', () => {
    const warning = firstConcludeWarning({ warned: false, tabsInWindow: 2 });
    expect(warning?.message).toBe('Conclude closes this tab after the summary. Close it?');
    expect(warning?.buttons).toEqual(['Close tab', 'Keep it open']);
  });

  it("says only Claude ends in the window's last tab", () => {
    expect(firstConcludeWarning({ warned: false, tabsInWindow: 1 })?.buttons).toEqual(['End session', 'Keep it running']);
  });

  it('never asks again once she said yes', () => {
    expect(firstConcludeWarning({ warned: true, tabsInWindow: 3 })).toBeNull();
  });
});
