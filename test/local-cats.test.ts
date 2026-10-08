import { describe, expect, it, vi } from 'vitest';
import { CAT_CHOICES } from '../src/main/menu';
import { CATS, PROPS, SITTING, spriteCols, spriteRows } from '../src/renderer/cat-art';
import { fromModules, LOCAL_CATS, type LocalCat } from '../src/shared/local-cats';

const cat = (id: string): LocalCat => ({ id, pet: { ...CATS.mika, name: `Cat ${id}` }, prop: PROPS.mika });

describe('local cats', () => {
  it('an empty or missing folder adds nothing', () => {
    expect(fromModules({})).toEqual([]);
  });

  it('registers a well-formed file', () => {
    expect(fromModules({ './cats-local/a.ts': { default: cat('pixel') } }).map(({ id }) => id)).toEqual(['pixel']);
  });

  it('skips malformed files and ids a built-in or earlier file already took', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const found = fromModules({
      './a.ts': { default: cat('mika') },
      './b.ts': { default: { id: 'broken' } },
      './c.ts': {},
      './d.ts': { default: cat('Bad Id') },
      './e.ts': { default: cat('twin') },
      './f.ts': { default: cat('twin') },
    });
    expect(found.map(({ id }) => id)).toEqual(['twin']);
    expect(warn).toHaveBeenCalledTimes(5);
    warn.mockRestore();
  });

  it('a local cat may be taller and wider than 20, up to the 48x48 corner', () => {
    const sized = (cols: number, rows: number, ragged = false): LocalCat => ({
      ...cat(`s${cols}x${rows}${ragged ? 'r' : ''}`),
      pet: { ...CATS.mika, base: Array.from({ length: rows }, (_, y) => '.'.repeat(ragged && y === 1 ? cols - 1 : cols)) },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const found = fromModules({
      './a.ts': { default: sized(22, 26) }, './b.ts': { default: sized(48, 48) },
      './c.ts': { default: sized(20, 49) }, './d.ts': { default: sized(49, 20) }, './e.ts': { default: sized(24, 30, true) },
    });
    expect(found.map(({ id }) => id)).toEqual(['s22x26', 's48x48']);
    warn.mockRestore();
    expect([spriteCols(sized(22, 26).pet), spriteRows(sized(22, 26).pet)]).toEqual([22, 26]);
    expect([spriteCols(CATS.mika), spriteRows(CATS.mika)]).toEqual([20, SITTING.length]);
  });

  it('whatever is in the folder on this Mac is listed after the built-in cats', () => {
    const tail = CAT_CHOICES.slice(CAT_CHOICES.length - LOCAL_CATS.length);
    expect(tail).toEqual(LOCAL_CATS.map(({ id, pet }) => [id, pet.name]));
  });
});
