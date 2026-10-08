/// <reference types="vite/client" />
// Private cats from the gitignored src/renderer/cats-local/: art for this Mac only, never committed or shipped in a public build.
// Each *.ts there default-exports a LocalCat; an empty or missing folder adds nothing.
// Her own base may be up to 48x48, so a standing figure shows whole.
import { CATS, MAX_SPRITE_CELLS, type Pet, type Prop } from '../renderer/cat-art';

export interface LocalCat {
  id: string;
  pet: Pet;
  prop: Prop;
  css?: string; // her coat and moves, scoped to [data-cat="<id>"]
}

type Modules = Record<string, { default?: unknown }>;

// Every row the same width, and no more than the 48x48 corner either way.
const fitsCorner = (rows: readonly string[]): boolean => rows.length <= MAX_SPRITE_CELLS
  && rows.every((row) => row.length === rows[0].length && row.length <= MAX_SPRITE_CELLS);

const isLocalCat = (value: unknown): value is LocalCat => {
  const cat = value as Partial<LocalCat> | undefined;
  return typeof cat?.id === 'string' && /^[a-z][a-z0-9-]*$/.test(cat.id)
    && typeof cat.pet?.name === 'string' && Array.isArray(cat.pet.sitting) && Array.isArray(cat.pet.eyesOpen)
    && typeof cat.prop?.name === 'string' && Array.isArray(cat.prop.rows)
    && (cat.pet.base === undefined || fitsCorner(cat.pet.base));
};

// Skips malformed files and ids already taken (built-in cats win), with a warning rather than a crash.
export function fromModules(modules: Modules): LocalCat[] {
  const taken = new Set(Object.keys(CATS));
  return Object.entries(modules).flatMap(([file, module]) => {
    const cat = module.default;
    if (!isLocalCat(cat) || taken.has(cat.id)) {
      console.warn(`local cat skipped: ${file}`);
      return [];
    }
    taken.add(cat.id);
    return [cat];
  });
}

export const LOCAL_CATS: readonly LocalCat[] = fromModules(import.meta.glob('../renderer/cats-local/*.ts', { eager: true }));
