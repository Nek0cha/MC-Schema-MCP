import { describe, expect, it } from 'vitest';
import { BuildProject } from '../../src/core/build-project.js';
import { cylinder } from '../../src/core/shapes.js';
import {
  findIsolatedConnectables,
  formatIsolatedWarning,
  resolveConnections
} from '../../src/schematic/connections.js';

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
    project.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:birch_fence' });
    project.setBlock({ x: 0, y: 0, z: 5 }, { id: 'minecraft:nether_brick_fence' });
    project.setBlock({ x: 1, y: 0, z: 5 }, { id: 'minecraft:nether_brick_fence' });

    const resolved = resolveConnections(project);

    expect(resolved.get(keyOf(0, 0, 0))?.properties).toMatchObject({ east: 'true', west: 'false' });
    expect(resolved.get(keyOf(1, 0, 0))?.properties).toMatchObject({ east: 'false', west: 'true' });
    expect(resolved.get(keyOf(0, 0, 5))?.properties).toMatchObject({ east: 'true' });
  });

  it('does not connect wooden fences to nether brick fences', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:oak_fence' });
    project.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:nether_brick_fence' });

    const resolved = resolveConnections(project);

    expect(resolved.get(keyOf(0, 0, 0))?.properties).toMatchObject({ east: 'false' });
    expect(resolved.get(keyOf(1, 0, 0))?.properties).toMatchObject({ west: 'false' });
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

describe('vanilla connection rules', () => {
  it('connects panes to glass blocks and walls, and fences to glass blocks', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:glass_pane' });
    project.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:glass' });
    project.setBlock({ x: -1, y: 0, z: 0 }, { id: 'minecraft:cobblestone_wall' });
    project.setBlock({ x: 10, y: 0, z: 0 }, { id: 'minecraft:oak_fence' });
    project.setBlock({ x: 10, y: 0, z: -1 }, { id: 'minecraft:tinted_glass' });

    const resolved = resolveConnections(project);

    expect(resolved.get(keyOf(0, 0, 0))?.properties).toMatchObject({ east: 'true', west: 'true' });
    expect(resolved.get(keyOf(10, 0, 0))?.properties).toMatchObject({ north: 'true' });
  });

  it('does not connect panes or fences to pumpkins, melons, leaves, shulker boxes or barriers', () => {
    const exceptions = [
      'minecraft:pumpkin',
      'minecraft:carved_pumpkin',
      'minecraft:jack_o_lantern',
      'minecraft:melon',
      'minecraft:oak_leaves',
      'minecraft:shulker_box',
      'minecraft:red_shulker_box',
      'minecraft:barrier'
    ];
    for (const id of exceptions) {
      for (const source of ['minecraft:glass_pane', 'minecraft:oak_fence', 'minecraft:cobblestone_wall']) {
        const project = new BuildProject('test');
        project.setBlock({ x: 0, y: 0, z: 0 }, { id: source });
        project.setBlock({ x: 1, y: 0, z: 0 }, { id });
        const east = resolveConnections(project).get(keyOf(0, 0, 0))?.properties?.east;
        expect(east, `${source} next to ${id}`).toBe(source.endsWith('_wall') ? 'none' : 'false');
      }
    }
  });

  it('connects walls to glass, panes and bars', () => {
    for (const id of ['minecraft:glass', 'minecraft:glass_pane', 'minecraft:iron_bars']) {
      const project = new BuildProject('test');
      project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:cobblestone_wall' });
      project.setBlock({ x: 1, y: 0, z: 0 }, { id });
      expect(resolveConnections(project).get(keyOf(0, 0, 0))?.properties?.east, id).not.toBe('none');
    }
  });

  it('treats copper bars like iron bars', () => {
    for (const id of ['minecraft:copper_bars', 'minecraft:waxed_oxidized_copper_bars']) {
      const project = new BuildProject('test');
      project.setBlock({ x: 0, y: 0, z: 0 }, { id });
      project.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:glass_pane' });
      const resolved = resolveConnections(project);
      expect(resolved.get(keyOf(0, 0, 0))?.properties, id).toMatchObject({ east: 'true' });
      expect(resolved.get(keyOf(1, 0, 0))?.properties, id).toMatchObject({ west: 'true' });
    }
  });

  it('does not treat chains as solid neighbors', () => {
    for (const id of ['minecraft:chain', 'minecraft:iron_chain', 'minecraft:copper_chain']) {
      const project = new BuildProject('test');
      project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:glass_pane' });
      project.setBlock({ x: 1, y: 0, z: 0 }, { id });
      expect(resolveConnections(project).get(keyOf(0, 0, 0))?.properties, id).toMatchObject({ east: 'false' });
    }
  });
});

describe('findIsolatedConnectables', () => {
  const isPane = (project: BuildProject, x: number, y: number, z: number) =>
    project.getBlock({ x, y, z })?.id.endsWith('_pane') ?? false;
  const hasNeighbor = (project: BuildProject, p: { x: number; y: number; z: number }) =>
    isPane(project, p.x + 1, p.y, p.z) ||
    isPane(project, p.x - 1, p.y, p.z) ||
    isPane(project, p.x, p.y, p.z + 1) ||
    isPane(project, p.x, p.y, p.z - 1);

  it('flags only the diagonal panes of a cylinder shell', () => {
    const project = new BuildProject('test');
    // On a wide enough shell the 45-degree cells touch their neighbors only diagonally.
    cylinder(project, { x: 0, y: 0, z: 0 }, 12, 1, { id: 'minecraft:glass_pane' }, true);

    const flagged = findIsolatedConnectables(project);
    const flaggedKeys = new Set(flagged.map((p) => keyOf(p.x, p.y, p.z)));

    expect(flagged.length).toBeGreaterThan(0);
    for (const p of flagged) expect(hasNeighbor(project, p)).toBe(false);
    let withNeighbor = 0;
    project.forEachBlock((p) => {
      if (hasNeighbor(project, p)) {
        withNeighbor++;
        expect(flaggedKeys.has(keyOf(p.x, p.y, p.z))).toBe(false);
      }
    });
    expect(withNeighbor).toBeGreaterThan(0);
  });

  it('does not flag a pane next to a glass block', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:glass_pane' });
    project.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:glass' });
    expect(findIsolatedConnectables(project)).toEqual([]);
  });

  it('flags lone panes and bars, ordered y then z then x', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 5, y: 1, z: 0 }, { id: 'minecraft:iron_bars' });
    project.setBlock({ x: 3, y: 0, z: 2 }, { id: 'minecraft:glass_pane' });
    project.setBlock({ x: 9, y: 0, z: 0 }, { id: 'minecraft:copper_bars' });
    expect(findIsolatedConnectables(project)).toEqual([
      { x: 9, y: 0, z: 0 },
      { x: 3, y: 0, z: 2 },
      { x: 5, y: 1, z: 0 }
    ]);
  });

  it('does not flag fences or walls standing alone', () => {
    const project = new BuildProject('test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:oak_fence' });
    project.setBlock({ x: 5, y: 0, z: 0 }, { id: 'minecraft:cobblestone_wall' });
    expect(findIsolatedConnectables(project)).toEqual([]);
  });
});

describe('formatIsolatedWarning', () => {
  it('caps the warning at 20 positions', () => {
    const text = formatIsolatedWarning(Array.from({ length: 23 }, (_, i) => ({ x: i * 3, y: 0, z: 0 })));
    expect(text).toMatch(/^Warning: 23 isolated .*\(\+3 more\)/);
    expect(text).toContain('(57,0,0)');
    expect(text).not.toContain('(60,0,0)');
    expect(formatIsolatedWarning([])).toBe('');
  });

  it('lists all positions when there are 20 or fewer', () => {
    const text = formatIsolatedWarning([{ x: 1, y: 2, z: 3 }]);
    expect(text).toMatch(/^Warning: 1 isolated pane\/bar\/fence block\(s\)/);
    expect(text).toContain('(1,2,3)');
    expect(text).not.toContain('more');
  });
});
