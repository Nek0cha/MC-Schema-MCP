import { describe, expect, it } from 'vitest';
import { BuildProject } from '../../src/core/build-project.js';
import {
  MAX_REGION_CELLS,
  clearRegion,
  copyRegion,
  decayRegion,
  replaceInRegion,
  stackRegion,
  type StackDirection
} from '../../src/core/region-ops.js';
import { fillBox } from '../../src/core/shapes.js';
import { blockStateKey } from '../../src/core/types.js';

const AIR = { id: 'minecraft:air' };
const stone = { id: 'minecraft:stone' };

function dump(p: BuildProject): string[] {
  const out: string[] = [];
  p.forEachBlock((pos, block) => out.push(`${pos.x},${pos.y},${pos.z}=${blockStateKey(block as never)}`));
  return out.sort();
}

describe('copyRegion', () => {
  it('copies without transform', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 0, y: 0, z: 0 }, stone);
    p.setBlock({ x: 1, y: 1, z: 0 }, { id: 'minecraft:dirt' });
    const result = copyRegion(p, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 10, y: 0, z: 5 });
    expect(p.getBlock({ x: 10, y: 0, z: 5 })?.id).toBe('minecraft:stone');
    expect(p.getBlock({ x: 11, y: 1, z: 5 })?.id).toBe('minecraft:dirt');
    expect(result.changed).toBe(2);
    expect(result.bounds).toEqual({ min: { x: 10, y: 0, z: 5 }, max: { x: 11, y: 1, z: 5 } });
  });

  it('copies with rotation, moving and turning stairs together', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 0, y: 0, z: 0 }, stone);
    p.setBlock({ x: 2, y: 0, z: 0 }, { id: 'minecraft:oak_stairs', properties: { facing: 'north' } });
    const result = copyRegion(p, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 10, y: 0, z: 10 }, { rotate: 90 });
    expect(p.getBlock({ x: 10, y: 0, z: 10 })?.id).toBe('minecraft:stone');
    expect(p.getBlock({ x: 10, y: 0, z: 12 })).toEqual({
      id: 'minecraft:oak_stairs',
      properties: { facing: 'east' }
    });
    expect(result.bounds).toEqual({ min: { x: 10, y: 0, z: 10 }, max: { x: 10, y: 0, z: 12 } });
  });

  it('puts the minimum corner of a flipped and rotated region at dest', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 0, y: 0, z: 0 }, stone);
    p.setBlock({ x: 3, y: 0, z: 1 }, { id: 'minecraft:dirt' });
    const result = copyRegion(p, { x: 3, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, { x: 20, y: 5, z: 20 }, {
      flip: 'x',
      rotate: 270
    });
    // 4x1x2 region: flip x mirrors it in place, rotating 270 makes it 2 wide (x) and 4 long (z).
    expect(result.bounds).toEqual({ min: { x: 20, y: 5, z: 20 }, max: { x: 21, y: 5, z: 23 } });
    // Offsets from the source min corner: stone (0,0), dirt (3,1). Flip x -> (0,0), (-3,1);
    // three quarter turns of (x,z) -> (-z,x) -> (0,0) and (1,3).
    expect(p.getBlock({ x: 20, y: 5, z: 20 })?.id).toBe('minecraft:stone');
    expect(p.getBlock({ x: 21, y: 5, z: 23 })?.id).toBe('minecraft:dirt');
  });

  it('does not overwrite with unset cells but does with air', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 0, y: 0, z: 0 }, AIR);
    // (1,0,0) stays unset in the source
    p.setBlock({ x: 2, y: 0, z: 0 }, stone);
    p.setBlock({ x: 10, y: 0, z: 0 }, stone);
    p.setBlock({ x: 11, y: 0, z: 0 }, stone);
    copyRegion(p, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    expect(p.getBlock({ x: 10, y: 0, z: 0 })?.id).toBe('minecraft:air');
    expect(p.getBlock({ x: 11, y: 0, z: 0 })?.id).toBe('minecraft:stone');
    expect(p.getBlock({ x: 12, y: 0, z: 0 })?.id).toBe('minecraft:stone');
  });

  it('handles overlapping source and destination', () => {
    const p = new BuildProject('t');
    const ids = ['stone', 'dirt', 'gravel', 'sand', 'clay'];
    ids.forEach((id, x) => p.setBlock({ x, y: 0, z: 0 }, { id: `minecraft:${id}` }));
    copyRegion(p, { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    ids.forEach((id, i) => expect(p.getBlock({ x: i + 1, y: 0, z: 0 })?.id).toBe(`minecraft:${id}`));
    expect(p.getBlock({ x: 0, y: 0, z: 0 })?.id).toBe('minecraft:stone');
  });

  it('accepts corners in any order', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 1, y: 1, z: 1 }, stone);
    copyRegion(p, { x: 2, y: 2, z: 2 }, { x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
    expect(p.getBlock({ x: 11, y: 11, z: 11 })?.id).toBe('minecraft:stone');
  });
});

describe('stackRegion', () => {
  it('stacks with a gap', () => {
    const p = new BuildProject('t');
    fillBox(p, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, stone);
    const result = stackRegion(p, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 'east', 3, 1);
    for (const x of [0, 1, 3, 4, 6, 7, 9, 10]) expect(p.getBlock({ x, y: 0, z: 0 })?.id).toBe('minecraft:stone');
    for (const x of [2, 5, 8, 11]) expect(p.getBlock({ x, y: 0, z: 0 })).toBeUndefined();
    expect(result.changed).toBe(6);
    expect(result.bounds).toEqual({ min: { x: 3, y: 0, z: 0 }, max: { x: 10, y: 0, z: 0 } });
  });

  it('stacks without a gap', () => {
    const p = new BuildProject('t');
    fillBox(p, { x: 0, y: 0, z: 0 }, { x: 9, y: 0, z: 0 }, stone);
    stackRegion(p, { x: 0, y: 0, z: 0 }, { x: 9, y: 0, z: 0 }, 'east', 3);
    expect(p.getBlock({ x: 39, y: 0, z: 0 })?.id).toBe('minecraft:stone');
    expect(p.getBlock({ x: 40, y: 0, z: 0 })).toBeUndefined();
  });

  it('stacks in all six directions', () => {
    const expected: Record<StackDirection, [number, number, number]> = {
      north: [0, 0, -1],
      south: [0, 0, 1],
      east: [1, 0, 0],
      west: [-1, 0, 0],
      up: [0, 1, 0],
      down: [0, -1, 0]
    };
    for (const [direction, [dx, dy, dz]] of Object.entries(expected) as [StackDirection, [number, number, number]][]) {
      const p = new BuildProject('t');
      p.setBlock({ x: 50, y: 50, z: 50 }, stone);
      p.setBlock({ x: 51, y: 50, z: 50 }, { id: 'minecraft:dirt' });
      stackRegion(p, { x: 50, y: 50, z: 50 }, { x: 51, y: 50, z: 50 }, direction, 2, 1);
      // Step is region length along the axis plus gap: x axis length 2 -> 3, otherwise 1 -> 2.
      const length = dx !== 0 ? 2 : 1;
      const step = length + 1;
      for (const n of [1, 2]) {
        expect(p.getBlock({ x: 50 + dx * step * n, y: 50 + dy * step * n, z: 50 + dz * step * n })?.id, direction).toBe(
          'minecraft:stone'
        );
        expect(p.getBlock({ x: 51 + dx * step * n, y: 50 + dy * step * n, z: 50 + dz * step * n })?.id, direction).toBe(
          'minecraft:dirt'
        );
      }
    }
  });

  it('rejects counts outside 1..256', () => {
    const p = new BuildProject('t');
    expect(() => stackRegion(p, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 'up', 0)).toThrow(/count/);
    expect(() => stackRegion(p, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 'up', 257)).toThrow(/count/);
  });
});

describe('replaceInRegion', () => {
  it('replaces with wildcards and property filters, keeping stair facing on auto', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:oak_stairs', properties: { facing: 'north', half: 'top' } });
    p.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:oak_stairs', properties: { facing: 'south' } });
    p.setBlock({ x: 2, y: 0, z: 0 }, stone);
    const result = replaceInRegion(
      p,
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      [{ id: '*_stairs', properties: { facing: 'north' } }],
      { id: 'minecraft:spruce_stairs' }
    );
    expect(result.changed).toBe(1);
    expect(p.getBlock({ x: 0, y: 0, z: 0 })).toEqual({
      id: 'minecraft:spruce_stairs',
      properties: { facing: 'north', half: 'top' }
    });
    expect(p.getBlock({ x: 1, y: 0, z: 0 })?.id).toBe('minecraft:oak_stairs');
    expect(p.getBlock({ x: 2, y: 0, z: 0 })?.id).toBe('minecraft:stone');
  });

  it('honors the keepProperties modes', () => {
    const make = () => {
      const p = new BuildProject('t');
      p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:oak_stairs', properties: { facing: 'east' } });
      return p;
    };
    const run = (keep: 'auto' | boolean | undefined, replacement: string) => {
      const p = make();
      replaceInRegion(p, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, [{ id: 'oak_stairs' }], { id: replacement }, keep);
      return p.getBlock({ x: 0, y: 0, z: 0 });
    };
    expect(run(undefined, 'minecraft:stone_bricks')).toEqual({ id: 'minecraft:stone_bricks' });
    expect(run('auto', 'minecraft:stone_brick_stairs')).toEqual({
      id: 'minecraft:stone_brick_stairs',
      properties: { facing: 'east' }
    });
    expect(run(true, 'minecraft:stone_bricks')).toEqual({
      id: 'minecraft:stone_bricks',
      properties: { facing: 'east' }
    });
    expect(run(false, 'minecraft:stone_brick_stairs')).toEqual({ id: 'minecraft:stone_brick_stairs' });
  });

  it('skips unset cells and can match air explicitly', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 0, y: 0, z: 0 }, AIR);
    const result = replaceInRegion(p, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, [{ id: 'air' }], stone);
    expect(result.changed).toBe(1);
    expect(p.getBlock({ x: 0, y: 0, z: 0 })?.id).toBe('minecraft:stone');
    expect(p.getBlock({ x: 1, y: 0, z: 0 })).toBeUndefined();
  });

  it('replaces with a palette reproducibly for the same seed', () => {
    const palette = [
      { block: { id: 'minecraft:dirt' }, weight: 1 },
      { block: { id: 'minecraft:gravel' }, weight: 1 }
    ];
    const run = (seed: number) => {
      const p = new BuildProject('t');
      fillBox(p, { x: 0, y: 0, z: 0 }, { x: 9, y: 2, z: 9 }, stone);
      replaceInRegion(p, { x: 0, y: 0, z: 0 }, { x: 9, y: 2, z: 9 }, [{ id: 'stone' }], palette, 'auto', seed);
      return dump(p);
    };
    expect(run(11)).toEqual(run(11));
    expect(run(11)).not.toEqual(run(12));
    expect(new Set(run(11).map((s) => s.split('=')[1]))).toEqual(new Set(['minecraft:dirt', 'minecraft:gravel']));
  });
});

describe('clearRegion', () => {
  it('clears to unset by default', () => {
    const p = new BuildProject('t');
    fillBox(p, { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, stone);
    const result = clearRegion(p, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 });
    expect(result.changed).toBe(2);
    expect(p.getBlock({ x: 1, y: 0, z: 0 })).toBeUndefined();
    expect(p.getBlock({ x: 0, y: 0, z: 0 })?.id).toBe('minecraft:stone');
    expect(p.blockCount).toBe(2);
  });

  it('clears to explicit air when asked, including unset cells', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 0, y: 0, z: 0 }, stone);
    const result = clearRegion(p, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 'air');
    expect(p.getBlock({ x: 0, y: 0, z: 0 })?.id).toBe('minecraft:air');
    expect(p.getBlock({ x: 1, y: 0, z: 0 })?.id).toBe('minecraft:air');
    expect(result.changed).toBe(2);
  });

  it('rejects regions over 32,000,000 cells', () => {
    const p = new BuildProject('t');
    expect(MAX_REGION_CELLS).toBe(32_000_000);
    expect(() => clearRegion(p, { x: 0, y: 0, z: 0 }, { x: 999, y: 99, z: 999 })).toThrow(/32,000,000|32000000/);
    expect(() => copyRegion(p, { x: 0, y: 0, z: 0 }, { x: 999, y: 99, z: 999 }, { x: 0, y: 0, z: 0 })).toThrow(
      /32,000,000/
    );
  });
});

describe('decayRegion', () => {
  const box = () => {
    const p = new BuildProject('t');
    fillBox(p, { x: 0, y: 0, z: 0 }, { x: 5, y: 5, z: 5 }, stone);
    return p;
  };
  const lo = { x: 0, y: 0, z: 0 };
  const hi = { x: 5, y: 5, z: 5 };

  it('decays nothing at intensity 0', () => {
    const p = box();
    const before = dump(p);
    const result = decayRegion(p, lo, hi, 0, { seed: 1 });
    expect(result.changed).toBe(0);
    expect(result.rubble).toBe(0);
    expect(dump(p)).toEqual(before);
  });

  it('decays everything unprotected at intensity 1 without top bias', () => {
    const p = box();
    p.setBlock({ x: 2, y: 2, z: 2 }, { id: 'minecraft:obsidian' });
    p.setBlock({ x: 3, y: 3, z: 3 }, AIR);
    const result = decayRegion(p, lo, hi, 1, {
      topBias: false,
      rubble: false,
      protect: [{ id: 'obsidian' }],
      seed: 1
    });
    expect(result.changed).toBe(6 * 6 * 6 - 2);
    expect(dump(p).sort()).toEqual(['2,2,2=minecraft:obsidian', '3,3,3=minecraft:air']);
  });

  it('is reproducible for the same seed', () => {
    const run = (seed: number) => {
      const p = box();
      const result = decayRegion(p, lo, hi, 0.5, { seed, rubbleChance: 0.5 });
      return { cells: dump(p), changed: result.changed, rubble: result.rubble };
    };
    expect(run(3)).toEqual(run(3));
    expect(run(3)).not.toEqual(run(4));
  });

  it('removes more from the top than the bottom when top bias is on', () => {
    const p = box();
    decayRegion(p, lo, hi, 0.6, { rubble: false, seed: 9 });
    let bottom = 0;
    let top = 0;
    p.forEachBlock((pos) => {
      if (pos.y <= 1) bottom++;
      if (pos.y >= 4) top++;
    });
    expect(bottom).toBeGreaterThan(top);
  });

  it('always rests rubble on something', () => {
    const p = box();
    const result = decayRegion(p, lo, hi, 0.7, {
      seed: 5,
      rubbleChance: 1,
      rubbleBlocks: { id: 'minecraft:gravel' }
    });
    expect(result.rubble).toBeGreaterThan(0);
    let gravel = 0;
    p.forEachBlock((pos, block) => {
      if (block.id !== 'minecraft:gravel') return;
      gravel++;
      const below = p.getBlock({ x: pos.x, y: pos.y - 1, z: pos.z });
      expect(below).toBeDefined();
      expect(below?.id).not.toBe('minecraft:air');
      expect(pos.y).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeLessThanOrEqual(5);
    });
    expect(gravel).toBe(result.rubble);
  });

  it('puts no rubble where there is nothing to land on', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 0, y: 3, z: 0 }, stone);
    const result = decayRegion(p, { x: 0, y: 0, z: 0 }, { x: 0, y: 5, z: 0 }, 1, {
      topBias: false,
      rubbleChance: 1,
      seed: 1
    });
    expect(result.changed).toBe(1);
    expect(result.rubble).toBe(0);
    expect(p.blockCount).toBe(0);
  });

  it('never decays protected blocks, even with wildcards', () => {
    const p = new BuildProject('t');
    fillBox(p, lo, hi, { id: 'minecraft:stone_bricks' });
    decayRegion(p, lo, hi, 1, { topBias: false, rubble: false, protect: [{ id: '*_bricks' }], seed: 2 });
    expect(p.blockCount).toBe(6 * 6 * 6);
  });
});
