import { describe, expect, it, vi } from 'vitest';
import { CAT_CHOICES } from '../src/main/menu';
import { CATS, PROPS, SITTING, spriteRows } from '../src/renderer/cat-art';
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

  it('a local cat may stand taller than 20 rows, up to the 48-row corner', () => {
    const tall = (rows: number): LocalCat => ({ ...cat(`tall${rows}`), pet: { ...CATS.mika, base: Array(rows).fill('.'.repeat(20)) } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(fromModules({ './a.ts': { default: tall(30) }, './b.ts': { default: tall(48) }, './c.ts': { default: tall(49) } }).map(({ id }) => id)).toEqual(['tall30', 'tall48']);
    warn.mockRestore();
    expect(spriteRows(tall(30).pet)).toBe(30);
    expect(spriteRows(CATS.mika)).toBe(SITTING.length);
  });

  it('whatever is in the folder on this Mac is listed after the built-in cats', () => {
    const tail = CAT_CHOICES.slice(CAT_CHOICES.length - LOCAL_CATS.length);
    expect(tail).toEqual(LOCAL_CATS.map(({ id, pet }) => [id, pet.name]));
  });
});
