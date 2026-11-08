import { decode, Int, type TagMap } from '@enginehub/nbt-ts';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BuildProject } from '../../src/core/build-project.js';
import { DATA_VERSION, DATA_VERSIONS } from '../../src/schematic/data-version.js';
import { tileLayout, writeStructureTile } from '../../src/schematic/structure-writer.js';

interface DecodedBlock {
  pos: number[];
  state: number;
  name: string;
  properties?: Record<string, string>;
}

function read(buf: Buffer) {
  const root = decode(gunzipSync(buf), { useMaps: true }).value as TagMap;
  const palette = (root.get('palette') as TagMap[]).map((e) => ({
    name: e.get('Name') as string,
    properties: e.has('Properties') ? Object.fromEntries((e.get('Properties') as TagMap).entries()) : undefined
  }));
  const blocks: DecodedBlock[] = (root.get('blocks') as TagMap[]).map((b) => {
    const state = (b.get('state') as Int).value;
    return {
      pos: (b.get('pos') as Int[]).map((n) => n.value),
      state,
      name: palette[state].name,
      properties: palette[state].properties as Record<string, string> | undefined
    };
  });
  return {
    root,
    dataVersion: (root.get('DataVersion') as Int).value,
    size: (root.get('size') as Int[]).map((n) => n.value),
    palette,
    blocks,
    entities: root.get('entities')
  };
}

const stone = { id: 'minecraft:stone' };

describe('data versions', () => {
  it('maps target versions to DataVersion and keeps the legacy constant', () => {
    expect(DATA_VERSIONS['1.21.1']).toBe(3955);
    expect(DATA_VERSIONS['1.21.11']).toBe(4671);
    expect(DATA_VERSION).toBe(4671);
  });
});

describe('tileLayout', () => {
  it('covers the map with 48x48 tiles and shrinks the edge tiles', () => {
    const tiles = tileLayout([100, 20, 50]);
    expect(tiles).toHaveLength(3 * 2);
    expect(tiles[0]).toEqual({ tx: 0, tz: 0, x0: 0, z0: 0, sx: 48, sy: 20, sz: 48 });
    const last = tiles[tiles.length - 1];
    expect(last).toEqual({ tx: 2, tz: 1, x0: 96, z0: 48, sx: 4, sy: 20, sz: 2 });
  });

  it('gives an exact multiple a single full-size tile per 48 blocks', () => {
    const tiles = tileLayout([96, 5, 48]);
    expect(tiles.map((t) => [t.tx, t.tz, t.sx, t.sz])).toEqual([
      [0, 0, 48, 48],
      [1, 0, 48, 48]
    ]);
  });
});

describe('writeStructureTile', () => {
  it('writes DataVersion, size, palette, blocks with tile-relative positions and an empty entity list', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 50, y: 1, z: 2 }, stone);
    p.setBlock({ x: 51, y: 0, z: 3 }, { id: 'minecraft:oak_stairs', properties: { facing: 'north', half: 'bottom' } });
    const tile = tileLayout([100, 4, 48])[1];
    const out = read(writeStructureTile(p, tile, { dataVersion: 3955, includeAir: false }));
    expect(out.dataVersion).toBe(3955);
    expect(out.size).toEqual([48, 4, 48]);
    expect(out.root.get('DataVersion')).toBeInstanceOf(Int);
    expect(out.entities).toEqual([]);
    expect(out.blocks).toHaveLength(2);
    const stoneBlock = out.blocks.find((b) => b.name === 'minecraft:stone');
    expect(stoneBlock?.pos).toEqual([2, 1, 2]);
    const stairs = out.blocks.find((b) => b.name === 'minecraft:oak_stairs');
    expect(stairs?.pos).toEqual([3, 0, 3]);
    expect(stairs?.properties).toEqual({ facing: 'north', half: 'bottom' });
    // Blocks without properties must not carry a Properties compound.
    expect(out.palette.find((e) => e.name === 'minecraft:stone')?.properties).toBeUndefined();
  });

  it('writes unset cells as air when includeAir is true', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 1, y: 0, z: 1 }, stone);
    const tile = tileLayout([4, 3, 5])[0];
    const out = read(writeStructureTile(p, tile, { dataVersion: 3955, includeAir: true }));
    expect(out.blocks).toHaveLength(4 * 3 * 5);
    expect(out.blocks.filter((b) => b.name === 'minecraft:air')).toHaveLength(4 * 3 * 5 - 1);
    expect(out.blocks.find((b) => b.name === 'minecraft:stone')?.pos).toEqual([1, 0, 1]);
  });

  it('skips both explicit air and unset cells when includeAir is false', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 1, y: 0, z: 1 }, stone);
    p.setBlock({ x: 2, y: 0, z: 1 }, { id: 'minecraft:air' });
    p.setBlock({ x: 3, y: 0, z: 1 }, { id: 'minecraft:cave_air' });
    const tile = tileLayout([4, 3, 5])[0];
    const out = read(writeStructureTile(p, tile, { dataVersion: 3955, includeAir: false }));
    expect(out.blocks.map((b) => b.name)).toEqual(['minecraft:stone']);
    expect(out.palette.map((e) => e.name)).toEqual(['minecraft:stone']);
  });

  it('writes explicit air as air with includeAir true', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:air' });
    const out = read(writeStructureTile(p, tileLayout([1, 1, 1])[0], { dataVersion: 3955, includeAir: true }));
    expect(out.blocks).toHaveLength(1);
    expect(out.blocks[0].name).toBe('minecraft:air');
  });

  it('leaves out blocks that lie outside the tile', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 5, y: 0, z: 5 }, stone);
    p.setBlock({ x: 60, y: 0, z: 5 }, stone);
    p.setBlock({ x: 5, y: 9, z: 5 }, stone);
    p.setBlock({ x: -1, y: 0, z: 5 }, stone);
    const out = read(writeStructureTile(p, tileLayout([100, 4, 48])[0], { dataVersion: 3955, includeAir: false }));
    expect(out.blocks).toHaveLength(1);
  });

  it('resolves fence connections, including across a tile edge', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 47, y: 0, z: 0 }, { id: 'minecraft:oak_fence' });
    p.setBlock({ x: 48, y: 0, z: 0 }, { id: 'minecraft:oak_fence' });
    const tiles = tileLayout([96, 2, 48]);
    const left = read(writeStructureTile(p, tiles[0], { dataVersion: 3955, includeAir: false }));
    expect(left.blocks[0].properties).toMatchObject({ east: 'true', west: 'false', north: 'false', south: 'false' });
    const right = read(writeStructureTile(p, tiles[1], { dataVersion: 3955, includeAir: false }));
    expect(right.blocks[0].pos).toEqual([0, 0, 0]);
    expect(right.blocks[0].properties).toMatchObject({ west: 'true', east: 'false' });
  });
});
