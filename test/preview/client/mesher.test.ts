import { describe, expect, it } from 'vitest';
import { FACE_SHADE, meshChunk, type MeshInput } from '../../../src/preview/client/mesher.js';
import { bakeBlockState } from '../../../src/preview/models/bake.js';
import type { BakedModel } from '../../../src/preview/models/types.js';
import { fixtureSource } from '../models/fixture-source.js';

const src = fixtureSource();
const STONE = 1;
const GLASS = 2;
const SLAB = 3;
const WATER = 4;
const GRASS = 5;

function glassModel(): BakedModel {
  const stone = bakeBlockState({ id: 'minecraft:stone' }, src);
  return { ...stone, renderType: 'cutout', fullFaces: [], quads: stone.quads.map((q) => ({ ...q, texture: 'block/glass' })) };
}

const models: (BakedModel | null)[] = [
  null,
  bakeBlockState({ id: 'minecraft:stone' }, src),
  glassModel(),
  bakeBlockState({ id: 'minecraft:oak_slab', properties: { type: 'bottom' } }, src),
  bakeBlockState({ id: 'minecraft:water' }, src),
  bakeBlockState({ id: 'minecraft:grass_block' }, src)
];
const cullGroups = [null, null, 'minecraft:glass', null, 'minecraft:water', null];

const idx = (x: number, y: number, z: number) => (y * 16 + z) * 16 + x;

function input(cells: Uint16Array, extra: Partial<MeshInput> = {}): MeshInput {
  return {
    cx: 0,
    cy: 0,
    cz: 0,
    cells,
    neighbors: {},
    models,
    cullGroups,
    uvRect: (t) => (t === 'block/stone' ? [0, 0, 0.5, 0.5] : [0.5, 0.5, 1, 1]),
    tintColor: (t) => (t === 'grass' ? [0.5, 1, 0.25] : [1, 1, 1]),
    ...extra
  };
}

const quadCount = (b: { indices: Uint32Array }) => b.indices.length / 6;

describe('meshChunk', () => {
  it('culls the shared faces of two adjacent stone blocks', () => {
    const cells = new Uint16Array(4096);
    cells[idx(0, 0, 0)] = STONE;
    cells[idx(1, 0, 0)] = STONE;
    const out = meshChunk(input(cells));
    expect(quadCount(out.opaque)).toBe(10);
    expect(out.opaque.positions.length).toBe(10 * 4 * 3);
    expect(quadCount(out.cutout) + quadCount(out.translucent)).toBe(0);
  });

  it('culls faces between two glass blocks but not between glass and air or glass and stone', () => {
    const cells = new Uint16Array(4096);
    cells[idx(0, 0, 0)] = GLASS;
    cells[idx(1, 0, 0)] = GLASS;
    expect(quadCount(meshChunk(input(cells)).cutout)).toBe(10);
    cells[idx(2, 0, 0)] = STONE;
    // glass at x=1 loses its east face to the full stone; stone keeps its west face (glass is not opaque)
    const out = meshChunk(input(cells));
    expect(quadCount(out.cutout)).toBe(9);
    expect(quadCount(out.opaque)).toBe(6);
  });

  it('keeps the top face of a bottom slab under a stone block but drops the stone bottom', () => {
    const cells = new Uint16Array(4096);
    cells[idx(0, 0, 0)] = SLAB;
    cells[idx(0, 1, 0)] = STONE;
    const out = meshChunk(input(cells));
    // slab: 6 faces (its up face has no cullface); stone: 6 (the slab has no full up face to hide the stone's bottom)
    expect(quadCount(out.opaque)).toBe(12);
  });

  it('draws the cut face at clipY and nothing above it', () => {
    const cells = new Uint16Array(4096);
    for (let y = 0; y < 4; y++) cells[idx(0, y, 0)] = STONE;
    const out = meshChunk(input(cells, { clipY: 1 }));
    // two blocks (y=0,1) as one column: 4 sides x 2 + top + bottom
    expect(quadCount(out.opaque)).toBe(10);
    const ys = [];
    for (let i = 1; i < out.opaque.positions.length; i += 3) ys.push(out.opaque.positions[i]);
    expect(Math.max(...ys)).toBe(2);
  });

  it('uses neighbor chunks for culling and treats missing neighbors as air', () => {
    const cells = new Uint16Array(4096);
    cells[idx(15, 0, 0)] = STONE;
    expect(quadCount(meshChunk(input(cells)).opaque)).toBe(6);
    const east = new Uint16Array(4096);
    east[idx(0, 0, 0)] = STONE;
    expect(quadCount(meshChunk(input(cells, { neighbors: { east } })).opaque)).toBe(5);
  });

  it('places vertices in world coordinates', () => {
    const cells = new Uint16Array(4096);
    cells[idx(3, 2, 1)] = STONE;
    const out = meshChunk(input(cells, { cx: -1, cy: 1, cz: 2 }));
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    for (let i = 0; i < out.opaque.positions.length; i += 3) {
      xs.push(out.opaque.positions[i]);
      ys.push(out.opaque.positions[i + 1]);
      zs.push(out.opaque.positions[i + 2]);
    }
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([-13, -12]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([18, 19]);
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([33, 34]);
  });

  it('maps quad uvs into the atlas rectangle', () => {
    const cells = new Uint16Array(4096);
    cells[idx(0, 0, 0)] = STONE;
    const out = meshChunk(input(cells));
    for (const v of out.opaque.uvs) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0.5);
    }
  });

  it('applies face shade and tint to vertex colors', () => {
    expect(FACE_SHADE).toEqual({ up: 1, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 });
    const cells = new Uint16Array(4096);
    cells[idx(0, 0, 0)] = GRASS;
    const out = meshChunk(input(cells));
    const colors = new Set<string>();
    for (let i = 0; i < out.opaque.colors.length; i += 3) {
      colors.add([...out.opaque.colors.slice(i, i + 3)].map((c) => Math.round(c * 100) / 100).join(','));
    }
    expect(colors).toContain('0.5,1,0.25'); // tinted top, shade 1.0
    expect(colors).toContain('0.5,0.5,0.5'); // bottom, untinted
    expect(colors).toContain('0.6,0.6,0.6'); // east/west
  });

  it('puts water in the translucent buffer and culls water against water', () => {
    const cells = new Uint16Array(4096);
    cells[idx(0, 0, 0)] = WATER;
    cells[idx(1, 0, 0)] = WATER;
    const out = meshChunk(input(cells));
    expect(quadCount(out.translucent)).toBe(10);
  });

  it('uses the fallback rect and color when a texture is not in the atlas', () => {
    const cells = new Uint16Array(4096);
    cells[idx(0, 0, 0)] = STONE;
    const out = meshChunk(
      input(cells, {
        uvRect: () => undefined,
        fallback: { rect: [0.9, 0.9, 1, 1], color: () => [0.2, 0.4, 0.6] }
      })
    );
    expect(Math.min(...out.opaque.uvs)).toBeGreaterThanOrEqual(0.9 - 1e-6); // Float32 rounding
    const ratios = new Set<string>();
    for (let i = 0; i < out.opaque.colors.length; i += 3) {
      ratios.add((out.opaque.colors[i + 2] / out.opaque.colors[i]).toFixed(2));
    }
    expect([...ratios]).toEqual(['3.00']);
  });
});
