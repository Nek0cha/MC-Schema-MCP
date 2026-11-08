import { describe, expect, it } from 'vitest';
import { createRng, pickFromPalette } from '../../src/core/random.js';

describe('createRng', () => {
  it('is reproducible for the same seed', () => {
    expect(Array.from({ length: 5 }, createRng(42))).toEqual(Array.from({ length: 5 }, createRng(42)));
  });

  it('differs between seeds and stays within [0, 1)', () => {
    const a = Array.from({ length: 20 }, createRng(1));
    const b = Array.from({ length: 20 }, createRng(2));
    expect(a).not.toEqual(b);
    for (const v of [...a, ...b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('works without a seed', () => {
    const v = createRng()();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
});

describe('pickFromPalette', () => {
  it('returns a plain block unchanged', () => {
    const block = { id: 'minecraft:stone' };
    expect(pickFromPalette(block, createRng(1))).toEqual(block);
  });

  it('picks reproducibly and respects weights', () => {
    const palette = [
      { block: { id: 'minecraft:stone' }, weight: 9 },
      { block: { id: 'minecraft:dirt' }, weight: 1 }
    ];
    const draw = (seed: number) => {
      const rng = createRng(seed);
      return Array.from({ length: 1000 }, () => pickFromPalette(palette, rng).id);
    };
    expect(draw(7)).toEqual(draw(7));
    const stone = draw(7).filter((id) => id === 'minecraft:stone').length;
    expect(stone).toBeGreaterThan(800);
    expect(stone).toBeLessThan(980);
  });

  it('rejects an empty palette', () => {
    expect(() => pickFromPalette([], createRng(1))).toThrow(/at least one/);
  });
});
