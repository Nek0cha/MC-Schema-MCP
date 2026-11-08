import { describe, expect, it } from 'vitest';
import type { BlockState } from "../../src/core/types.js";
import { BuildProject, chunkKey } from '../../src/core/build-project.js';

describe('BuildProject', () => {
  it('starts empty with no bounding box', () => {
    const project = new BuildProject('demo');
    expect(project.getBoundingBox()).toBeNull();
  });

  it('stores and retrieves a block by position', () => {
    const project = new BuildProject('demo');
    project.setBlock({ x: 1, y: 2, z: 3 }, { id: 'minecraft:stone' });
    expect(project.getBlock({ x: 1, y: 2, z: 3 })).toEqual({ id: 'minecraft:stone' });
    expect(project.getBlock({ x: 0, y: 0, z: 0 })).toBeUndefined();
  });

  it('computes the bounding box across all set blocks', () => {
    const project = new BuildProject('demo');
    project.setBlock({ x: -1, y: 0, z: 5 }, { id: 'minecraft:stone' });
    project.setBlock({ x: 3, y: 2, z: -2 }, { id: 'minecraft:dirt' });
    expect(project.getBoundingBox()).toEqual({
      min: { x: -1, y: 0, z: -2 },
      max: { x: 3, y: 2, z: 5 }
    });
  });

  it('counts blocks by id', () => {
    const project = new BuildProject('demo');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    project.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:stone' });
    project.setBlock({ x: 2, y: 0, z: 0 }, { id: 'minecraft:dirt' });
    expect(project.getBlockCounts()).toEqual({ 'minecraft:stone': 2, 'minecraft:dirt': 1 });
  });

  it('overwrites a block already set at the same position', () => {
    const project = new BuildProject('demo');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:dirt' });
    expect(project.getBlock({ x: 0, y: 0, z: 0 })).toEqual({ id: 'minecraft:dirt' });
    expect(project.blockCount).toBe(1);
  });

  it('reads and writes across negative chunk boundaries', () => {
    const p = new BuildProject('t');
    const stone = { id: 'minecraft:stone' };
    for (const x of [-17, -16, -1, 0, 15, 16]) p.setBlock({ x, y: -1, z: x }, stone);
    for (const x of [-17, -16, -1, 0, 15, 16]) expect(p.getBlock({ x, y: -1, z: x })).toEqual(stone);
    expect(p.getBlock({ x: -2, y: -1, z: -2 })).toBeUndefined();
    expect(p.blockCount).toBe(6);
    expect(p.getBoundingBox()).toEqual({ min: { x: -17, y: -1, z: -17 }, max: { x: 16, y: -1, z: 16 } });
  });

  it('treats blocks with the same id but different properties as distinct palette entries', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:oak_stairs', properties: { facing: 'north', half: 'bottom' } });
    p.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:oak_stairs', properties: { half: 'bottom', facing: 'north' } });
    p.setBlock({ x: 2, y: 0, z: 0 }, { id: 'minecraft:oak_stairs', properties: { facing: 'south', half: 'bottom' } });
    expect(p.getPalette().length).toBe(3); // null + 2 entries
    expect(p.getBlockCounts()).toEqual({ 'minecraft:oak_stairs': 3 });
  });

  it('stores air as a real block and removeBlock unsets a cell', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:air' });
    expect(p.getBlock({ x: 0, y: 0, z: 0 })).toEqual({ id: 'minecraft:air' });
    p.removeBlock({ x: 0, y: 0, z: 0 });
    expect(p.getBlock({ x: 0, y: 0, z: 0 })).toBeUndefined();
    expect(p.blockCount).toBe(0);
    expect(p.getBoundingBox()).toBeNull();
    expect(p.getBlockCounts()).toEqual({});
  });

  it('drops an emptied chunk but still reports it as dirty', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 20, y: 0, z: 0 }, { id: 'minecraft:stone' });
    p.clearDirty(p.getDirtyChunkKeys());
    p.removeBlock({ x: 20, y: 0, z: 0 });
    expect(p.getChunk(chunkKey(1, 0, 0))).toBeUndefined();
    expect(p.getDirtyChunkKeys()).toEqual([chunkKey(1, 0, 0)]);
  });

  it('invalidates the cached bounding box on write', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    expect(p.getBoundingBox()?.max.x).toBe(0);
    p.setBlock({ x: 5, y: 0, z: 0 }, { id: 'minecraft:stone' });
    expect(p.getBoundingBox()?.max.x).toBe(5);
  });

  it('throws once the palette exceeds 65535 states', () => {
    const p = new BuildProject('t');
    for (let i = 0; i < 65535; i++) {
      p.setBlock({ x: i, y: 0, z: 0 }, { id: 'minecraft:stone', properties: { n: String(i) } });
    }
    expect(() => p.setBlock({ x: 0, y: 1, z: 0 }, { id: 'minecraft:stone', properties: { n: 'over' } })).toThrow(/palette/i);
  });

  it('rebuilds counts from stored chunks', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 1, y: 2, z: 3 }, { id: 'minecraft:stone' });
    p.setBlock({ x: -40, y: 2, z: 3 }, { id: 'minecraft:dirt' });
    const chunks = new Map(p.getDirtyChunkKeys().map((k) => [k, p.getChunk(k)!.slice()]));
    const q = BuildProject.fromStored('t', [...p.getPalette()] as (BlockState | null)[], chunks);
    expect(q.blockCount).toBe(2);
    expect(q.getBlockCounts()).toEqual(p.getBlockCounts());
    expect(q.getBoundingBox()).toEqual(p.getBoundingBox());
    expect(q.getDirtyChunkKeys()).toEqual([]);
  });

  it('overwriting keeps counts consistent and forEachBlock visits each block once', () => {
    const p = new BuildProject('t');
    p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:dirt' });
    expect(p.getBlockCounts()).toEqual({ 'minecraft:dirt': 1 });
    const seen: string[] = [];
    p.forEachBlock((pos, b) => seen.push(`${pos.x},${pos.y},${pos.z}=${b.id}`));
    expect(seen).toEqual(['0,0,0=minecraft:dirt']);
  });
});
