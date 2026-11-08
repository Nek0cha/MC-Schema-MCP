import { describe, expect, it } from 'vitest';
import { applyReplacement, matchesAny, normalizeId } from '../../src/core/block-match.js';

const stairs = (facing: string, extra: Record<string, string> = {}) => ({
  id: 'minecraft:oak_stairs',
  properties: { facing, ...extra }
});

describe('normalizeId', () => {
  it('adds the minecraft namespace only when missing', () => {
    expect(normalizeId('stone')).toBe('minecraft:stone');
    expect(normalizeId('minecraft:stone')).toBe('minecraft:stone');
    expect(normalizeId('mod:thing')).toBe('mod:thing');
  });
});

describe('matchesAny', () => {
  it('supports * wildcards with an implied minecraft namespace', () => {
    expect(matchesAny(stairs('north'), [{ id: '*_stairs' }])).toBe(true);
    expect(matchesAny(stairs('north'), [{ id: 'minecraft:*_stairs' }])).toBe(true);
    expect(matchesAny({ id: 'minecraft:stone_bricks' }, [{ id: 'stone_brick*' }])).toBe(true);
    expect(matchesAny({ id: 'minecraft:stone' }, [{ id: 'stone_brick*' }])).toBe(false);
  });

  it('requires all listed properties to match', () => {
    expect(matchesAny(stairs('north'), [{ id: 'oak_stairs', properties: { facing: 'south' } }])).toBe(false);
    expect(matchesAny(stairs('north', { half: 'top' }), [{ id: 'oak_stairs', properties: { facing: 'north' } }])).toBe(
      true
    );
    expect(
      matchesAny(stairs('north'), [{ id: 'oak_stairs', properties: { facing: 'north', half: 'top' } }])
    ).toBe(false);
  });

  it('matches when any matcher matches and treats regex characters literally', () => {
    expect(matchesAny({ id: 'minecraft:stone' }, [{ id: 'dirt' }, { id: 'stone' }])).toBe(true);
    expect(matchesAny({ id: 'minecraft:stone' }, [])).toBe(false);
    expect(matchesAny({ id: 'minecraft:stone' }, [{ id: 'sto.e' }])).toBe(false);
  });
});

describe('applyReplacement', () => {
  it('keeps properties on auto when the block family matches', () => {
    expect(applyReplacement(stairs('east', { half: 'top' }), { id: 'minecraft:spruce_stairs' }, 'auto')).toEqual({
      id: 'minecraft:spruce_stairs',
      properties: { facing: 'east', half: 'top' }
    });
  });

  it('drops properties on auto when the family differs', () => {
    expect(applyReplacement(stairs('east'), { id: 'minecraft:stone_bricks' }, 'auto')).toEqual({
      id: 'minecraft:stone_bricks'
    });
  });

  it('does not keep properties between wall-mounted and standing variants', () => {
    expect(
      applyReplacement(
        { id: 'minecraft:oak_wall_sign', properties: { facing: 'east' } },
        { id: 'minecraft:oak_sign' },
        'auto'
      )
    ).toEqual({ id: 'minecraft:oak_sign' });
    expect(
      applyReplacement(
        { id: 'minecraft:wall_torch', properties: { facing: 'east' } },
        { id: 'minecraft:torch' },
        'auto'
      )
    ).toEqual({ id: 'minecraft:torch' });
  });

  it('overlays replacement properties on top of kept ones', () => {
    expect(
      applyReplacement(
        stairs('east', { half: 'top' }),
        { id: 'minecraft:spruce_stairs', properties: { half: 'bottom' } },
        true
      )
    ).toEqual({ id: 'minecraft:spruce_stairs', properties: { facing: 'east', half: 'bottom' } });
  });

  it('uses only replacement properties when keep is false', () => {
    expect(
      applyReplacement(stairs('east'), { id: 'minecraft:spruce_stairs', properties: { half: 'top' } }, false)
    ).toEqual({
      id: 'minecraft:spruce_stairs',
      properties: { half: 'top' }
    });
  });

  it('returns a fresh object and never mutates its inputs', () => {
    const source = stairs('east');
    const replacement = { id: 'minecraft:spruce_stairs' };
    const out = applyReplacement(source, replacement, true);
    expect(out).not.toBe(replacement);
    expect(out.properties).not.toBe(source.properties);
    expect(replacement).toEqual({ id: 'minecraft:spruce_stairs' });
    expect(source).toEqual(stairs('east'));
  });
});
