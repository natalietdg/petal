import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { KEY_ENTRIES, SHAPE_ENTRIES } from '../src/renderer/formatting-guide-entries';
import { STATUS_KEYS } from '../src/shared/status-lines';

// The reader's markdown pipeline: every class these files can put on a reply.
const RENDERER = ['markdown.ts', 'fold.ts', 'steps.ts', 'open-threads.ts', 'diagrams.ts'].map((file) => path.join(__dirname, '..', 'src', 'renderer', file));
const source = (file: string): string => fs.readFileSync(file, 'utf8');

// Wrappers and states with no shape of their own; each says why.
const NOT_A_SHAPE: Record<string, string> = {
  'prose': 'the root of every rendered reply',
  'callout': 'shared by every label callout; each label has its own row',
  'pill': "a callout's label chip, checked in each callout row",
  'rail': 'layout wrapper for quotes in a section; Customize keeps quotes in the flow',
  'headline-long': 'automatic size step of the headline',
  'headline-very-long': 'automatic size step of the headline',
  'done': 'set when a step is ticked; the snapshot ticks one',
};

const quoted = (text: string): string[] => [...text.matchAll(/['`]([^'`]*)['`]/g)].map((m) => m[1] ?? '');

// "callout-${key}" style templates expand to their real keys.
function expand(token: string, markdownSource: string): string[] {
  if (!token.includes('${')) return [token];
  const prefix = token.slice(0, token.indexOf('${'));
  if (prefix === 'status-') return STATUS_KEYS.map((key) => `status-${key}`);
  if (prefix === 'callout-') {
    const labels = /const LABELS[^{]*\{([^}]*)\}/.exec(markdownSource)?.[1] ?? '';
    return [...new Set([...labels.matchAll(/:\s*'([^']+)'/g)].map((m) => `callout-${m[1]}`))];
  }
  throw new Error(`unknown class template ${token}: teach this test its keys`);
}

function rendererClasses(): Set<string> {
  const markdownSource = source(RENDERER[0] ?? '');
  const tokens: string[] = [];
  for (const file of RENDERER) {
    const text = source(file);
    for (const m of text.matchAll(/className\s*=\s*([^;\n]+)/g)) tokens.push(...quoted(m[1] ?? ''));
    for (const m of text.matchAll(/classList\.(?:add|toggle)\(([^)]*)\)/g)) tokens.push(...quoted(m[1] ?? ''));
    for (const m of text.matchAll(/\bel\(\s*'[a-z0-9]+'\s*,\s*'([^']+)'/g)) tokens.push(m[1] ?? '');
    for (const m of text.matchAll(/class="([^"]+)"/g)) tokens.push(m[1] ?? '');
  }
  const classes = tokens.flatMap((t) => t.split(/\s+(?![^{]*\})/)).filter(Boolean).flatMap((t) => expand(t, markdownSource));
  return new Set(classes);
}

const classesIn = (selector: string): string[] => [...selector.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1] ?? '');
const guideClasses = new Set(SHAPE_ENTRIES.flatMap((entry) => entry.expects.flatMap(classesIn)));

describe('formatting guide', () => {
  const classes = rendererClasses();

  it('reads a real class list from the renderer', () => {
    expect(classes.size).toBeGreaterThan(30);
    for (const known of ['headline', 'story-head', 'lede', 'status-block', 'callout-decide', 'status-next', 'steps-section', 'step-badge', 'diagram', 'back-matter', 'bare-link']) expect(classes).toContain(known);
  });

  it('has a row for every treatment the renderer can apply', () => {
    const missing = [...classes].filter((c) => !guideClasses.has(c) && !(c in NOT_A_SHAPE));
    expect(missing).toEqual([]);
  });

  it('only expects classes the renderer really sets', () => {
    expect([...guideClasses].filter((c) => !classes.has(c))).toEqual([]);
    expect(Object.keys(NOT_A_SHAPE).filter((c) => !classes.has(c))).toEqual([]);
  });

  it('covers the elements the renderer makes without a class', () => {
    expect(source(RENDERER[0] ?? '')).toContain('<mark>');
    expect(SHAPE_ENTRIES.some((e) => e.expects.includes('mark'))).toBe(true);
    expect(source(RENDERER[0] ?? '')).toContain('escapeHtml(text)');
    expect(SHAPE_ENTRIES.some((e) => e.absent?.includes('br') && e.shows === '<br>')).toBe(true);
  });

  it('keeps every example tiny and every row distinct', () => {
    const ids = SHAPE_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of SHAPE_ENTRIES) {
      const lines = entry.markdown.split('\n').filter((line) => line.trim() && !line.startsWith('```'));
      expect(lines.length, entry.id).toBeLessThanOrEqual(4);
      expect(entry.use.length, entry.id).toBeLessThanOrEqual(90);
      expect(entry.expects.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('gives the lede example room for a drop cap (160+ characters)', () => {
    const lede = SHAPE_ENTRIES.find((e) => e.id === 'lede')?.markdown.split('\n\n')[2] ?? '';
    expect(lede.length).toBeGreaterThanOrEqual(160);
  });

  it('samples each colour label from its own shape row, with no empty example', () => {
    for (const entry of KEY_ENTRIES) {
      expect(entry.markdown, entry.id).not.toBe('');
      expect(SHAPE_ENTRIES.find((shape) => shape.id === entry.id)?.markdown, entry.id).toBe(entry.markdown);
    }
  });
});
