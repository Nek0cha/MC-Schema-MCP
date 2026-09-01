import { describe, expect, it } from 'vitest';
import { colorFor } from '../../src/preview/block-colors.js';

describe('colorFor', () => {
  it('returns the manually-mapped color for a well-known block', () => {
    expect(colorFor('minecraft:stone')).toBe('#8a8a8a');
  });

  it('returns a dedicated color for air', () => {
    expect(colorFor('minecraft:air')).toBe('#2a2a2a');
  });

  it('returns a deterministic hash-based color for an unmapped block', () => {
    const first = colorFor('minecraft:some_unlisted_block');
    const second = colorFor('minecraft:some_unlisted_block');

    expect(first).toBe(second);
    expect(first).toMatch(/^hsl\(\d+, 55%, 55%\)$/);
  });

  it('returns different colors for different unmapped blocks', () => {
    const a = colorFor('minecraft:block_alpha');
    const b = colorFor('minecraft:block_beta');

    expect(a).not.toBe(b);
  });
});
