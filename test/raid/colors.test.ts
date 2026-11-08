import { describe, expect, it } from 'vitest';
import { makeColorOf, parseCssColor } from '../../src/raid/colors.js';

describe('raid colors', () => {
  it('parses hex and hsl css colors', () => {
    expect(parseCssColor('#8a8a8a')).toEqual([138, 138, 138]);
    expect(parseCssColor('hsl(0, 100%, 50%)')).toEqual([255, 0, 0]);
    expect(parseCssColor('hsl(120, 100%, 25%)')).toEqual([0, 128, 0]);
  });

  it('falls back to colorFor without assets', () => {
    const colorOf = makeColorOf(null);
    expect(colorOf({ id: 'minecraft:stone' })).toEqual([138, 138, 138]);
  });
});
