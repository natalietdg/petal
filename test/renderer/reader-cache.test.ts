// @vitest-environment jsdom
// The reader re-parses only the reply that changed; unchanged replies keep their rendered nodes.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reply } from '../../src/shared/types';

const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('../../src/renderer/markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/markdown')>();
  render.mockImplementation(actual.render);
  return { ...actual, render };
});

// Every preload call answers "not available", the way main does when a read fails.
function stubBridge(): unknown {
  const call = (): unknown => new Proxy(() => Promise.resolve({ error: 'test' }), { get: (_t, key) => (key === 'then' ? undefined : call()) });
  return call();
}

type Reader = typeof import('../../src/renderer/reader');
let reader: Reader;

beforeAll(async () => {
  const html = fs.readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8');
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
  Object.assign(window, { pastel: stubBridge() });
  Element.prototype.scrollIntoView = () => undefined;
  Object.assign(globalThis, { ResizeObserver: class { observe(): void {} unobserve(): void {} disconnect(): void {} } }); // jsdom has no layout
  reader = await import('../../src/renderer/reader');
});

beforeEach(() => { render.mockClear(); });

const reply = (id: string, markdown: string): Reply => ({ id, timestamp: '2026-10-22T09:00:00.000Z', markdown, prompt: `Prompt ${id}` });
const shown = (replies: Reply[]) => ({ state: 'live' as const, replies, cwd: '/tmp', tabId: 'tab-1', sessionId: 'session-1', label: 'Test' });

describe('reader: incremental render', () => {
  it('re-parses only the reply whose text changed across two updates', () => {
    const older = [reply('r2', '## Older\n\nUnchanged text.'), reply('r1', 'Oldest reply.')];
    reader.update(shown([reply('r3', 'Streaming…'), ...older]));
    expect(render).toHaveBeenCalledTimes(3);
    const before = document.querySelector('[data-reply-id="r2"] .prose');

    render.mockClear();
    reader.update(shown([reply('r3', 'Streaming… now longer.'), ...older]));
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]?.[0]).toBe('Streaming… now longer.');
    expect(document.querySelector('[data-reply-id="r2"] .prose')).toBe(before);
  });

  it('shows the asking line without re-parsing any reply', () => {
    reader.update(shown([reply('a2', 'Newest.'), reply('a1', 'Earlier.')]));
    render.mockClear();
    reader.setAsking('question');
    expect(render).not.toHaveBeenCalled();
    expect(document.querySelector('#latest .reader-asking')?.textContent).toBe('Claude is asking you something · answer below');
    reader.setAsking(null);
    expect(document.querySelector('#latest .reader-asking')).toBeNull();
  });

  it('moves the newest reply into the earlier turns without re-parsing it', () => {
    reader.update(shown([reply('m1', 'First answer.')]));
    render.mockClear();
    reader.update(shown([reply('m2', 'Second answer.'), reply('m1', 'First answer.')]));
    expect(render.mock.calls.map((call) => call[0])).toEqual(['Second answer.']);
    expect(document.querySelector('#older [data-reply-id="m1"] .prose')?.textContent?.trim()).toBe('First answer.');
    expect(document.querySelector('#latest .prose')?.textContent?.trim()).toBe('Second answer.');
  });

  it('renders every reply afresh after a theme switch', () => {
    reader.update(shown([reply('t2', 'Two.'), reply('t1', 'One.')]));
    render.mockClear();
    reader.rerender();
    expect(render).toHaveBeenCalledTimes(2);
  });
});
