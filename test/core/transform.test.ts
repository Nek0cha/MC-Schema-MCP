import { describe, expect, it } from 'vitest';
import { transformBlockState, transformOffset, type Rotation, type Transform } from '../../src/core/transform.js';

const f = (facing: string, t: Transform) =>
  transformBlockState({ id: 'minecraft:oak_stairs', properties: { facing } }, t).properties!.facing;
const r = (v: number, t: Transform) =>
  transformBlockState({ id: 'minecraft:oak_sign', properties: { rotation: String(v) } }, t).properties!.rotation;
const prop = (id: string, properties: Record<string, string>, t: Transform, key: string) =>
  transformBlockState({ id, properties }, t).properties![key];

describe('transformBlockState: facing', () => {
  it('rotates clockwise seen from above', () => {
    expect(f('north', { rotate: 90 })).toBe('east');
    expect(f('west', { rotate: 270 })).toBe('south');
    const table: Record<Rotation, string[]> = {
      0: ['north', 'east', 'south', 'west'],
      90: ['east', 'south', 'west', 'north'],
      180: ['south', 'west', 'north', 'east'],
      270: ['west', 'north', 'east', 'south']
    };
    for (const rot of [0, 90, 180, 270] as const) {
      ['north', 'east', 'south', 'west'].forEach((dir, i) => expect(f(dir, { rotate: rot })).toBe(table[rot][i]));
    }
  });

  it('flips along the chosen axis only', () => {
    expect(f('east', { flip: 'x' })).toBe('west');
    expect(f('north', { flip: 'x' })).toBe('north');
    expect(f('north', { flip: 'z' })).toBe('south');
    expect(f('east', { flip: 'z' })).toBe('east');
  });

  it('flips before rotating', () => {
    expect(f('north', { flip: 'z', rotate: 90 })).toBe('west'); // north->south, then south->west
    expect(f('east', { flip: 'x', rotate: 90 })).toBe('north'); // east->west, then west->north
  });

  it('leaves up and down alone', () => {
    expect(f('up', { rotate: 90 })).toBe('up');
    expect(f('down', { flip: 'x' })).toBe('down');
  });

  it('keeps blocks without relevant properties unchanged but returns a new object', () => {
    const stone = { id: 'minecraft:stone' };
    const out = transformBlockState(stone, { rotate: 90 });
    expect(out).toEqual(stone);
    expect(out).not.toBe(stone);
    const slab = { id: 'minecraft:oak_slab', properties: { type: 'top', waterlogged: 'true' } };
    expect(transformBlockState(slab, { rotate: 90, flip: 'x' }).properties).toEqual({
      type: 'top',
      waterlogged: 'true'
    });
  });

  it('does not mutate the input', () => {
    const input = { id: 'minecraft:oak_stairs', properties: { facing: 'north' } };
    transformBlockState(input, { rotate: 90 });
    expect(input.properties.facing).toBe('north');
  });
});

describe('transformBlockState: rotation property', () => {
  it('rotates by 4 per quarter turn', () => {
    expect(r(0, { rotate: 90 })).toBe('4');
    expect(r(14, { rotate: 90 })).toBe('2');
    expect(r(3, { rotate: 180 })).toBe('11');
    expect(r(3, { rotate: 270 })).toBe('15');
  });

  it('mirrors across the north-south and east-west axes', () => {
    expect(r(0, { flip: 'z' })).toBe('8');
    expect(r(4, { flip: 'z' })).toBe('4');
    expect(r(4, { flip: 'x' })).toBe('12');
    expect(r(0, { flip: 'x' })).toBe('0');
  });

  it('maps all 16 values consistently', () => {
    for (let v = 0; v < 16; v++) {
      expect(r(v, { flip: 'z' })).toBe(String((8 - v + 16) % 16));
      expect(r(v, { flip: 'x' })).toBe(String((16 - v) % 16));
      expect(r(v, { flip: 'z', rotate: 90 })).toBe(String((((8 - v + 16) % 16) + 4) % 16));
    }
  });
});

describe('transformBlockState: other properties', () => {
  it('swaps axis x/z on quarter turns only', () => {
    expect(prop('minecraft:oak_log', { axis: 'x' }, { rotate: 90 }, 'axis')).toBe('z');
    expect(prop('minecraft:oak_log', { axis: 'z' }, { rotate: 270 }, 'axis')).toBe('x');
    expect(prop('minecraft:oak_log', { axis: 'x' }, { rotate: 180 }, 'axis')).toBe('x');
    expect(prop('minecraft:oak_log', { axis: 'x' }, { flip: 'x' }, 'axis')).toBe('x');
    expect(prop('minecraft:oak_log', { axis: 'y' }, { rotate: 90 }, 'axis')).toBe('y');
  });

  it('swaps stair shape sides on flip but not on rotation', () => {
    const stair = (shape: string) => ({ facing: 'north', shape });
    expect(prop('minecraft:oak_stairs', stair('inner_left'), { flip: 'x' }, 'shape')).toBe('inner_right');
    expect(prop('minecraft:oak_stairs', stair('outer_right'), { flip: 'z' }, 'shape')).toBe('outer_left');
    expect(prop('minecraft:oak_stairs', stair('straight'), { flip: 'x' }, 'shape')).toBe('straight');
    expect(prop('minecraft:oak_stairs', stair('inner_left'), { rotate: 90 }, 'shape')).toBe('inner_left');
  });

  it('swaps door hinge, chest type and shelf side_chain on flip only', () => {
    expect(prop('minecraft:oak_door', { hinge: 'left' }, { flip: 'z' }, 'hinge')).toBe('right');
    expect(prop('minecraft:oak_door', { hinge: 'left' }, { rotate: 90 }, 'hinge')).toBe('left');
    expect(prop('minecraft:chest', { type: 'left' }, { flip: 'x' }, 'type')).toBe('right');
    expect(prop('minecraft:chest', { type: 'single' }, { flip: 'x' }, 'type')).toBe('single');
    expect(prop('minecraft:oak_slab', { type: 'top' }, { flip: 'x' }, 'type')).toBe('top');
    expect(prop('minecraft:oak_shelf', { side_chain: 'right' }, { flip: 'x' }, 'side_chain')).toBe('left');
  });

  it('rotates and flips rail shapes, normalizing the name', () => {
    expect(prop('minecraft:rail', { shape: 'north_east' }, { rotate: 90 }, 'shape')).toBe('south_east');
    expect(prop('minecraft:rail', { shape: 'ascending_north' }, { flip: 'z' }, 'shape')).toBe('ascending_south');
    expect(prop('minecraft:rail', { shape: 'north_south' }, { rotate: 90 }, 'shape')).toBe('east_west');
    expect(prop('minecraft:rail', { shape: 'east_west' }, { rotate: 270 }, 'shape')).toBe('north_south');
    expect(prop('minecraft:rail', { shape: 'ascending_east' }, { rotate: 90 }, 'shape')).toBe('ascending_south');
    expect(prop('minecraft:rail', { shape: 'south_west' }, { flip: 'x' }, 'shape')).toBe('south_east');
    expect(prop('minecraft:rail', { shape: 'north_west' }, { rotate: 90 }, 'shape')).toBe('north_east');
  });

  it('moves north/east/south/west values to the rotated side', () => {
    const vine = { north: 'true', east: 'false', south: 'false', west: 'false' };
    expect(transformBlockState({ id: 'minecraft:vine', properties: vine }, { rotate: 90 }).properties).toMatchObject({
      east: 'true',
      north: 'false'
    });
    expect(transformBlockState({ id: 'minecraft:vine', properties: vine }, { flip: 'z' }).properties).toMatchObject({
      south: 'true',
      north: 'false'
    });
    const wall = { north: 'tall', east: 'low', south: 'none', west: 'none', up: 'true' };
    expect(
      transformBlockState({ id: 'minecraft:cobblestone_wall', properties: wall }, { rotate: 180 }).properties
    ).toEqual({
      north: 'none',
      east: 'none',
      south: 'tall',
      west: 'low',
      up: 'true'
    });
  });
});

describe('transformOffset', () => {
  it('rotates clockwise seen from above', () => {
    expect(transformOffset({ x: 3, y: 1, z: -2 }, { rotate: 90 })).toEqual({ x: 2, y: 1, z: 3 });
    expect(transformOffset({ x: 1, y: 0, z: 0 }, { rotate: 90 })).toEqual({ x: 0, y: 0, z: 1 }); // east -> south
    expect(transformOffset({ x: 0, y: 0, z: -1 }, { rotate: 90 })).toEqual({ x: 1, y: 0, z: 0 }); // north -> east
  });

  it('round-trips through the inverse rotation', () => {
    for (const rot of [0, 90, 180, 270] as const) {
      const back = ((360 - rot) % 360) as Rotation;
      expect(transformOffset(transformOffset({ x: 3, y: 1, z: -2 }, { rotate: rot }), { rotate: back })).toEqual({
        x: 3,
        y: 1,
        z: -2
      });
    }
  });

  it('flips and is its own inverse', () => {
    expect(transformOffset({ x: 3, y: 1, z: -2 }, { flip: 'x' })).toEqual({ x: -3, y: 1, z: -2 });
    expect(transformOffset({ x: 3, y: 1, z: -2 }, { flip: 'z' })).toEqual({ x: 3, y: 1, z: 2 });
    for (const flip of ['x', 'z'] as const) {
      expect(transformOffset(transformOffset({ x: 3, y: 1, z: -2 }, { flip }), { flip })).toEqual({
        x: 3,
        y: 1,
        z: -2
      });
    }
  });

  it('flips before rotating and normalizes negative zero', () => {
    expect(transformOffset({ x: 3, y: 0, z: 0 }, { flip: 'x', rotate: 90 })).toEqual({ x: 0, y: 0, z: -3 });
    expect(Object.is(transformOffset({ x: 0, y: 0, z: 0 }, { rotate: 90 }).x, 0)).toBe(true);
    expect(Object.is(transformOffset({ x: 0, y: 0, z: 0 }, { flip: 'x' }).x, 0)).toBe(true);
  });
});
