import { describe, expect, it } from 'vitest';
import { BuildProject } from '../../src/core/build-project.js';
import { resolveConnections } from '../../src/schematic/connections.js';

function keyOf(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

describe('resolveConnections', () => {
  it('omits non-connectable blocks from the override map', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });

    const resolved = resolveConnections(project);

    expect(resolved.has(keyOf(0, 0, 0))).toBe(false);
  });

  it('gives an isolated fence no connections', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:oak_fence' });

    const resolved = resolveConnections(project);

    expect(resolved.get(keyOf(0, 0, 0))).toEqual({
      id: 'minecraft:oak_fence',
      properties: { north: 'false', south: 'false', east: 'false', west: 'false' }
    });
  });

  it('connects two adjacent fences of different wood types', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:oak_fence' });
    project.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:nether_brick_fence' });

    const resolved = resolveConnections(project);

    expect(resolved.get(keyOf(0, 0, 0))?.properties).toMatchObject({ east: 'true', west: 'false' });
    expect(resolved.get(keyOf(1, 0, 0))?.properties).toMatchObject({ east: 'false', west: 'true' });
  });

  it('connects a fence to an adjacent fence gate', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:oak_fence' });
    project.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:oak_fence_gate' });

    const resolved = resolveConnections(project);

    expect(resolved.get(keyOf(0, 0, 0))?.properties).toMatchObject({ east: 'true' });
  });

  it('connects a fence to a solid full-cube neighbor', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:oak_fence' });
    project.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:stone' });

    const resolved = resolveConnections(project);

    expect(resolved.get(keyOf(0, 0, 0))?.properties).toMatchObject({ east: 'true' });
  });

  it('does not connect a fence to a non-full-cube neighbor like a slab', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:oak_fence' });
    project.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:stone_slab' });

    const resolved = resolveConnections(project);

    expect(resolved.get(keyOf(0, 0, 0))?.properties).toMatchObject({ east: 'false' });
  });

  it('does not connect a fence to a glass block', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:oak_fence' });
    project.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:glass' });

    const resolved = resolveConnections(project);

    expect(resolved.get(keyOf(0, 0, 0))?.properties).toMatchObject({ east: 'false' });
  });

  it('overwrites a manually-specified connection property', () => {
    const project = new BuildProject('test');
    project.setBlock(
      { x: 0, y: 0, z: 0 },
      { id: 'minecraft:oak_fence', properties: { north: 'true', south: 'false', east: 'false', west: 'false' } }
    );

    const resolved = resolveConnections(project);

    // No neighbors at all, so the hand-set north:true must be overwritten to false.
    expect(resolved.get(keyOf(0, 0, 0))?.properties).toMatchObject({ north: 'false' });
  });

  it('preserves unrelated properties like waterlogged', () => {
    const project = new BuildProject('test');
    project.setBlock(
      { x: 0, y: 0, z: 0 },
      { id: 'minecraft:oak_fence', properties: { waterlogged: 'true' } }
    );

    const resolved = resolveConnections(project);

    expect(resolved.get(keyOf(0, 0, 0))?.properties).toMatchObject({ waterlogged: 'true' });
  });

  it('connects glass panes of different colors to each other', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:red_stained_glass_pane' });
    project.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:blue_stained_glass_pane' });

    const resolved = resolveConnections(project);

    expect(resolved.get(keyOf(0, 0, 0))?.properties).toMatchObject({ east: 'true' });
  });

  it('connects a glass pane to adjacent iron bars', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:glass_pane' });
    project.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:iron_bars' });

    const resolved = resolveConnections(project);

    expect(resolved.get(keyOf(0, 0, 0))?.properties).toMatchObject({ east: 'true' });
  });

  it('does not connect a glass pane to a plain glass block', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:glass_pane' });
    project.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:glass' });

    const resolved = resolveConnections(project);

    expect(resolved.get(keyOf(0, 0, 0))?.properties).toMatchObject({ east: 'false' });
  });

  it('gives an isolated wall no connections and a pole-cap up', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:cobblestone_wall' });

    const resolved = resolveConnections(project);

    expect(resolved.get(keyOf(0, 0, 0))?.properties).toMatchObject({
      north: 'none',
      south: 'none',
      east: 'none',
      west: 'none',
      up: 'true'
    });
  });

  it('gives a straight north-south wall run a flat top (no pole)', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:cobblestone_wall' });
    project.setBlock({ x: 0, y: 0, z: -1 }, { id: 'minecraft:cobblestone_wall' });
    project.setBlock({ x: 0, y: 0, z: 1 }, { id: 'minecraft:cobblestone_wall' });

    const resolved = resolveConnections(project);

    expect(resolved.get(keyOf(0, 0, 0))?.properties).toMatchObject({
      north: 'tall',
      south: 'tall',
      up: 'false'
    });
  });

  it('gives a wall corner a pole even though it has two connections', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:cobblestone_wall' });
    project.setBlock({ x: 0, y: 0, z: 1 }, { id: 'minecraft:cobblestone_wall' });
    project.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:cobblestone_wall' });

    const resolved = resolveConnections(project);

    expect(resolved.get(keyOf(0, 0, 0))?.properties).toMatchObject({ up: 'true' });
  });

  it('marks a "low" wall connection against a solid full-cube neighbor', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:cobblestone_wall' });
    project.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:stone' });

    const resolved = resolveConnections(project);

    expect(resolved.get(keyOf(0, 0, 0))?.properties).toMatchObject({ east: 'low' });
  });

  it('does not force up:true when an explicit air block sits directly above', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:cobblestone_wall' });
    project.setBlock({ x: 0, y: 0, z: -1 }, { id: 'minecraft:cobblestone_wall' });
    project.setBlock({ x: 0, y: 0, z: 1 }, { id: 'minecraft:cobblestone_wall' });
    // Explicitly carved to air (e.g. by a fillBox carve), not merely unset.
    project.setBlock({ x: 0, y: 1, z: 0 }, { id: 'minecraft:air' });

    const resolved = resolveConnections(project);

    expect(resolved.get(keyOf(0, 0, 0))?.properties).toMatchObject({ up: 'false' });
  });

  it('forces up:true on a straight run when a block sits directly above', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:cobblestone_wall' });
    project.setBlock({ x: 0, y: 0, z: -1 }, { id: 'minecraft:cobblestone_wall' });
    project.setBlock({ x: 0, y: 0, z: 1 }, { id: 'minecraft:cobblestone_wall' });
    project.setBlock({ x: 0, y: 1, z: 0 }, { id: 'minecraft:lantern' });

    const resolved = resolveConnections(project);

    expect(resolved.get(keyOf(0, 0, 0))?.properties).toMatchObject({ up: 'true' });
  });
});
