import { describe, expect, it } from 'vitest';
import { bakeBlockState } from '../../../src/preview/models/bake.js';
import { renderTypeOf } from '../../../src/preview/models/render-type.js';
import type { BakedQuad, Face } from '../../../src/preview/models/types.js';
import { fixtureSource } from './fixture-source.js';

function normalOf(q: BakedQuad): [number, number, number] {
  const [a, b, c] = q.positions;
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const n: [number, number, number] = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(...n);
  return n.map((x) => Math.round((x / len) * 1000) / 1000 + 0) as [number, number, number];
}

const FACE_NORMALS: Record<Face, [number, number, number]> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0]
};

function extent(q: BakedQuad): { min: number[]; max: number[] } {
  const min = [0, 1, 2].map((i) => Math.min(...q.positions.map((p) => p[i])));
  const max = [0, 1, 2].map((i) => Math.max(...q.positions.map((p) => p[i])));
  return { min, max };
}

const round = (n: number) => Math.round(n * 1e6) / 1e6 + 0;

describe('bakeBlockState', () => {
  it('bakes a full cube with outward, counter-clockwise faces and cullfaces', () => {
    const m = bakeBlockState({ id: 'minecraft:stone' }, fixtureSource());
    expect(m.status).toBe('ok');
    expect(m.renderType).toBe('opaque');
    expect(m.quads).toHaveLength(6);
    for (const q of m.quads) {
      expect(q.texture).toBe('block/stone');
      expect(q.cullface).toBeDefined();
      expect(normalOf(q)).toEqual(FACE_NORMALS[q.cullface!]);
      expect(q.shadeFace).toBe(q.cullface);
    }
    expect([...m.fullFaces].sort()).toEqual(['down', 'east', 'north', 'south', 'up', 'west']);
  });

  it('uses vanilla default UVs (north face: u runs from high x to low x)', () => {
    const m = bakeBlockState({ id: 'minecraft:stone' }, fixtureSource());
    const north = m.quads.find((q) => q.cullface === 'north')!;
    // first vertex is the top-left as seen from outside: high x, high y → uv (0,0)
    expect(north.positions[0]).toEqual([1, 1, 0]);
    expect(north.uvs[0]).toEqual([0, 0]);
    expect(north.uvs[2]).toEqual([1, 1]);
  });

  it('matches variants regardless of property order and ignores unspecified properties', () => {
    const src = fixtureSource();
    const a = bakeBlockState({ id: 'minecraft:oak_stairs', properties: { shape: 'straight', half: 'bottom', facing: 'south' } }, src);
    const b = bakeBlockState({ id: 'minecraft:oak_stairs', properties: { facing: 'south', half: 'bottom', shape: 'straight', waterlogged: 'false' } }, src);
    expect(a.status).toBe('ok');
    expect(b.quads).toEqual(a.quads);
    const tint = bakeBlockState({ id: 'minecraft:grass_block' }, src); // no properties: first matching variant wins
    expect(tint.quads.find((q) => q.cullface === 'up')!.tint).toBe('grass');
    expect(tint.quads.find((q) => q.cullface === 'north')!.tint).toBe('none');
  });

  it('resolves parent chains and texture variables', () => {
    const m = bakeBlockState({ id: 'minecraft:oak_slab', properties: { type: 'bottom' } }, fixtureSource());
    expect(m.quads.every((q) => q.texture === 'block/oak_planks')).toBe(true);
    expect(m.fullFaces).toEqual(['down']);
  });

  it('rotates a variant by x=180 (top slab) including cullfaces', () => {
    const m = bakeBlockState({ id: 'minecraft:oak_slab', properties: { type: 'top' } }, fixtureSource());
    expect(m.fullFaces).toEqual(['up']);
    const top = m.quads.find((q) => q.cullface === 'up')!;
    expect(normalOf(top)).toEqual([0, 1, 0]);
    expect(extent(top).min[1]).toBe(1);
    const inner = m.quads.find((q) => q.cullface === undefined)!; // former top face now faces down at y=0.5
    expect(normalOf(inner)).toEqual([0, -1, 0]);
    expect(round(extent(inner).min[1])).toBe(0.5);
  });

  it('rotates stairs by y=90 so the back faces south, and reports full faces correctly', () => {
    const east = bakeBlockState({ id: 'minecraft:oak_stairs', properties: { facing: 'east', half: 'bottom', shape: 'straight' } }, fixtureSource());
    expect([...east.fullFaces].sort()).toEqual(['down', 'east']);
    const south = bakeBlockState({ id: 'minecraft:oak_stairs', properties: { facing: 'south', half: 'bottom', shape: 'straight' } }, fixtureSource());
    expect([...south.fullFaces].sort()).toEqual(['down', 'south']);
    for (const q of south.quads) {
      if (q.cullface) expect(normalOf(q)).toEqual(FACE_NORMALS[q.cullface]);
    }
  });

  it('keeps world-aligned UVs on the top face with uvlock', () => {
    const south = bakeBlockState({ id: 'minecraft:oak_stairs', properties: { facing: 'south', half: 'bottom', shape: 'straight' } }, fixtureSource());
    const top = south.quads.find((q) => q.cullface === 'up')!; // step top now covers z 0.5..1
    for (let i = 0; i < 4; i++) {
      const [x, , z] = top.positions[i];
      expect(top.uvs[i].map(round)).toEqual([round(x), round(z)]);
    }
  });

  it('combines multipart parts with OR and pipe-separated values', () => {
    const src = fixtureSource();
    const post = bakeBlockState({ id: 'minecraft:oak_fence', properties: { north: 'false', east: 'false', south: 'false', west: 'false' } }, src);
    expect(post.quads).toHaveLength(2);
    const ne = bakeBlockState({ id: 'minecraft:oak_fence', properties: { north: 'true', east: 'true', south: 'false', west: 'false' } }, src);
    expect(ne.quads).toHaveLength(4);
    const eastSide = ne.quads.filter((q) => q.cullface === 'east');
    expect(eastSide).toHaveLength(1);
    expect(normalOf(eastSide[0])).toEqual([1, 0, 0]);
    const viaOr = bakeBlockState({ id: 'minecraft:oak_fence', properties: { north: 'false', east: 'false', south: 'false', west: 'low' } }, src);
    expect(viaOr.quads).toHaveLength(3);
    expect(post.fullFaces).toEqual([]);
  });

  it('applies element rotation with rescale, face uv rotation and shade:false', () => {
    const m = bakeBlockState({ id: 'minecraft:tilted' }, fixtureSource());
    expect(m.quads).toHaveLength(1);
    const q = m.quads[0];
    expect(q.shadeFace).toBeNull();
    // 45° about y through the centre, rescaled: the plane now runs corner to corner
    const xs = q.positions.map((p) => round(p[0])).sort();
    const zs = q.positions.map((p) => round(p[2])).sort();
    expect(xs[0]).toBe(0);
    expect(xs[3]).toBe(1);
    expect(zs[0]).toBe(0);
    expect(zs[3]).toBe(1);
    // uv rotation 90: the top-left vertex samples the texture's bottom-left corner
    expect(q.uvs[0]).toEqual([0, 1]);
  });

  it('renders block entities as a slightly smaller particle-textured box', () => {
    const m = bakeBlockState({ id: 'minecraft:chest', properties: { facing: 'north' } }, fixtureSource());
    expect(m.status).toBe('entity');
    expect(m.quads).toHaveLength(6);
    expect(m.quads.every((q) => q.texture === 'block/oak_planks')).toBe(true);
    expect(m.fullFaces).toEqual([]);
    // sits on the floor but is inset by 1/16 on the sides and top
    const all = m.quads.flatMap((q) => q.positions);
    expect(Math.min(...all.map((p) => p[1]))).toBe(0);
    expect(Math.min(...all.map((p) => p[0]))).toBeCloseTo(1 / 16);
    expect(Math.max(...all.map((p) => p[1]))).toBeCloseTo(15 / 16);
  });

  it('renders fluids as a 14/16 box with their still texture', () => {
    const water = bakeBlockState({ id: 'minecraft:water', properties: { level: '0' } }, fixtureSource());
    expect(water.status).toBe('fluid');
    expect(water.renderType).toBe('translucent');
    expect(water.quads.every((q) => q.texture === 'block/water_still' && q.tint === 'water')).toBe(true);
    const top = water.quads.find((q) => normalOf(q)[1] === 1)!;
    expect(round(top.positions[0][1])).toBe(0.875);
    const lava = bakeBlockState({ id: 'minecraft:lava' }, fixtureSource());
    expect(lava.quads.every((q) => q.texture === 'block/lava_still' && q.tint === 'none')).toBe(true);
  });

  it('marks unknown ids and broken parent chains as unresolved unit cubes', () => {
    for (const id of ['minecraft:not_a_block', 'minecraft:broken_parent']) {
      const m = bakeBlockState({ id }, fixtureSource());
      expect(m.status).toBe('unresolved');
      expect(m.quads).toHaveLength(6);
      expect(m.quads.every((q) => q.texture === '#missing')).toBe(true);
      expect(m.fullFaces).toHaveLength(6);
    }
  });

  it('bakes air to nothing', () => {
    for (const id of ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air']) {
      const m = bakeBlockState({ id }, fixtureSource());
      expect(m.quads).toEqual([]);
      expect(m.fullFaces).toEqual([]);
    }
  });

  it('tints leaves with foliage and classifies render types', () => {
    const m = bakeBlockState({ id: 'minecraft:oak_leaves' }, fixtureSource());
    expect(m.renderType).toBe('cutout');
    expect(m.fullFaces).toEqual([]); // only opaque models occlude neighbours
    expect(renderTypeOf('minecraft:stone')).toBe('opaque');
    expect(renderTypeOf('minecraft:glass')).toBe('cutout');
    expect(renderTypeOf('minecraft:glass_pane')).toBe('cutout');
    expect(renderTypeOf('minecraft:red_stained_glass')).toBe('translucent');
    expect(renderTypeOf('minecraft:red_stained_glass_pane')).toBe('translucent');
    expect(renderTypeOf('minecraft:ice')).toBe('translucent');
    expect(renderTypeOf('minecraft:packed_ice')).toBe('opaque');
    expect(renderTypeOf('minecraft:oak_door')).toBe('cutout');
    expect(renderTypeOf('minecraft:poppy')).toBe('cutout');
  });

  it('caches results per source and state', () => {
    const src = fixtureSource();
    expect(bakeBlockState({ id: 'minecraft:stone' }, src)).toBe(bakeBlockState({ id: 'minecraft:stone' }, src));
  });
});
