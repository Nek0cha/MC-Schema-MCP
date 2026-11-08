import type { BlockOrPalette } from './shapes.js';
import type { BlockState } from './types.js';

/** Returns a number in [0, 1). */
export type Rng = () => number;

/**
 * mulberry32: a tiny seeded generator whose output depends only on integer
 * arithmetic, so the same seed gives the same sequence on every platform.
 */
export function createRng(seed?: number): Rng {
  let state = (seed === undefined ? Math.floor(Math.random() * 0x100000000) : Math.trunc(seed)) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Weighted pick, same rules as the palette handling in shapes.ts but driven by the given rng. */
export function pickFromPalette(value: BlockOrPalette, rng: Rng): BlockState {
  if (!Array.isArray(value)) return value;
  if (value.length === 0) {
    throw new Error('Palette must contain at least one entry.');
  }
  const totalWeight = value.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * totalWeight;
  for (const entry of value) {
    roll -= entry.weight;
    if (roll <= 0) return entry.block;
  }
  return value[value.length - 1].block;
}
