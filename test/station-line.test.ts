// The factory Station line: parsing and the progress bar the strip and reply block show.
import { describe, expect, it } from 'vitest';
import { parseStation, parseStationLine, stationBarHtml, stationCaption } from '../src/shared/station-line';
import { parseStatus } from '../src/shared/status-lines';

describe('parseStationLine', () => {
  it('reads a full line', () => {
    expect(parseStationLine('**Station:** 3/7 Build · met')).toEqual({ index: 3, total: 7, name: 'Build', state: 'met' });
    expect(parseStationLine('**Station:** 2/7 Research & plan · not yet')).toEqual({ index: 2, total: 7, name: 'Research & plan', state: 'not yet' });
  });

  it('tolerates a missing state, extra spaces, other label forms and a trailing period', () => {
    expect(parseStationLine('**Station:** 3/7 Build')).toEqual({ index: 3, total: 7, name: 'Build', state: null });
    expect(parseStationLine('  **Station:**   3 / 7   Build   ·   not  yet  ')).toEqual({ index: 3, total: 7, name: 'Build', state: 'not yet' });
    expect(parseStationLine('**Station:** 3/7 Build · met.')).toEqual({ index: 3, total: 7, name: 'Build', state: 'met' });
    expect(parseStationLine('**Station:** 3/7 Build.')).toEqual({ index: 3, total: 7, name: 'Build', state: null });
    expect(parseStationLine('Station: 1/4 Intake · NOT YET')?.state).toBe('not yet');
    expect(parseStationLine('**Station**: 1/4 Intake')?.name).toBe('Intake');
  });

  it('rejects n above N, zero, and garbage', () => {
    expect(parseStationLine('**Station:** 8/7 Build · met')).toBeNull();
    expect(parseStationLine('**Station:** 0/7 Build · met')).toBeNull();
    expect(parseStationLine('**Station:** Build · met')).toBeNull();
    expect(parseStationLine('**Station:** 3/7')).toBeNull();
    expect(parseStationLine('**Station:** 3/7 Build · maybe')).toBeNull();
    expect(parseStationLine('The station: 3/7 Build')).toBeNull();
    expect(parseStationLine('')).toBeNull();
  });
});

describe('parseStation', () => {
  it('finds the line after the status lines, outside fences, without touching them', () => {
    const reply = '**Title.**\n\n**Doing:** a\n**Recommend:** b\n**Next:** c\n**Station:** 3/7 Build · met';
    expect(parseStation(reply)).toEqual({ index: 3, total: 7, name: 'Build', state: 'met' });
    expect(parseStatus(reply)).toEqual({ doing: 'a', recommend: 'b', next: 'c' });
    expect(parseStation('```\n**Station:** 3/7 Build\n```')).toBeNull();
  });
});

describe('stationBarHtml', () => {
  it('draws N segments with earlier ones done, the current one met or pending, and progressbar semantics', () => {
    const met = { index: 3, total: 7, name: 'Build', state: 'met' as const };
    const html = stationBarHtml(met);
    expect(stationCaption(met)).toBe('Build · 3/7');
    expect(html.match(/class="station-seg /g)).toHaveLength(7);
    expect(html.match(/station-seg done/g)).toHaveLength(2);
    expect(html).toContain('station-seg current met');
    expect(html.match(/station-seg todo/g)).toHaveLength(4);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="3"');
    expect(html).toContain('aria-valuemax="7"');
    expect(html).toContain('aria-label="Factory station"');
    expect(html).toContain('>Build · 3/7<');
    expect(stationBarHtml({ ...met, state: 'not yet' })).toContain('station-seg current pending');
    expect(stationBarHtml({ ...met, name: '<b>x</b>' })).not.toContain('<b>');
  });
});
