import { describe, expect, it } from 'vitest';
import { BuildProject } from '../../src/core/build-project.js';
import { fillBox } from '../../src/core/shapes.js';
import type { BlockState } from '../../src/core/types.js';
import { buildWalkGrid, explore } from '../../src/raid/walk-grid.js';
import type { Pos } from '../../src/core/markers.js';

const STONE: BlockState = { id: 'minecraft:stone' };
const SIZE: Pos = [16, 8, 16];

/** A 16x16 stone floor at y=0; standing cells are at y=1. */
function floor(): BuildProject {
  const p = new BuildProject('t');
  fillBox(p, { x: 0, y: 0, z: 0 }, { x: 15, y: 0, z: 15 }, STONE);
  return p;
}

const set = (p: BuildProject, x: number, y: number, z: number, block: BlockState) => p.setBlock({ x, y, z }, block);
const reach = (p: BuildProject, from: Pos, to: Pos, wideOnly = false) => explore(buildWalkGrid(p, SIZE), from, { wideOnly }).reached(to);

describe('walk grid', () => {
  it('stands on a solid floor with two free cells above', () => {
    const g = buildWalkGrid(floor(), SIZE);
    expect(g.standable(3, 1, 3)).toBe(true);
    expect(g.level(3, 1, 3)).toBe(1);
    expect(g.standable(3, 0, 3)).toBe(false); // inside the floor
    expect(g.standable(3, 2, 3)).toBe(false); // floating
  });

  it('needs head room', () => {
    const p = floor();
    set(p, 3, 2, 3, STONE);
    expect(buildWalkGrid(p, SIZE).standable(3, 1, 3)).toBe(false);
  });

  it('walks across flat ground and up a 1-block step', () => {
    const p = floor();
    fillBox(p, { x: 8, y: 1, z: 0 }, { x: 15, y: 1, z: 15 }, STONE);
    expect(reach(p, [1, 1, 1], [12, 2, 12])).toBe(true);
  });

  it('cannot climb a 2-block step but can with a slab in between', () => {
    const p = floor();
    fillBox(p, { x: 8, y: 1, z: 0 }, { x: 15, y: 2, z: 15 }, STONE);
    expect(reach(p, [1, 1, 1], [12, 3, 12])).toBe(false);
    set(p, 7, 1, 5, { id: 'minecraft:stone_slab', properties: { type: 'bottom' } });
    set(p, 6, 1, 5, { id: 'minecraft:air' });
    // 1 → 1.5 (slab) → 3? no: 1.5 → 3 is 1.5. Use stairs-like run: slab at y=1 then full block at y=2 next to it
    expect(reach(p, [1, 1, 1], [12, 3, 12])).toBe(false);
    set(p, 7, 2, 6, { id: 'minecraft:stone_slab', properties: { type: 'bottom' } }); // 2.5
    set(p, 7, 1, 6, STONE);
    set(p, 6, 1, 6, { id: 'minecraft:stone_slab', properties: { type: 'bottom' } }); // 1.5
    // path: 1 → 1.5 (6,1,6) → 2.5 (7,2,6) → 3 (8,3,6)
    expect(reach(p, [1, 1, 1], [12, 3, 12])).toBe(true);
  });

  it('climbs two blocks with stairs', () => {
    const p = floor();
    fillBox(p, { x: 8, y: 1, z: 0 }, { x: 15, y: 2, z: 15 }, STONE);
    set(p, 6, 1, 4, { id: 'minecraft:oak_stairs', properties: { facing: 'east', half: 'bottom' } });
    set(p, 7, 1, 4, STONE);
    set(p, 7, 2, 4, { id: 'minecraft:oak_stairs', properties: { facing: 'east', half: 'bottom' } });
    expect(reach(p, [1, 1, 1], [12, 3, 12])).toBe(true);
  });

  it('does not walk over fences or walls, but through open gates and wooden doors', () => {
    const p = floor();
    for (let z = 0; z < 16; z++) set(p, 8, 1, z, { id: 'minecraft:oak_fence' });
    expect(reach(p, [1, 1, 1], [12, 1, 12])).toBe(false);
    set(p, 8, 1, 5, { id: 'minecraft:oak_fence_gate', properties: { open: 'false' } });
    expect(reach(p, [1, 1, 1], [12, 1, 12])).toBe(false);
    set(p, 8, 1, 5, { id: 'minecraft:oak_fence_gate', properties: { open: 'true' } });
    expect(reach(p, [1, 1, 1], [12, 1, 12])).toBe(true);
    for (let z = 0; z < 16; z++) set(p, 8, 1, z, { id: 'minecraft:cobblestone_wall' });
    expect(reach(p, [1, 1, 1], [12, 1, 12])).toBe(false);
  });

  it('passes wooden doors but not iron doors', () => {
    const p = floor();
    fillBox(p, { x: 8, y: 1, z: 0 }, { x: 8, y: 3, z: 15 }, STONE);
    set(p, 8, 1, 5, { id: 'minecraft:oak_door', properties: { half: 'lower' } });
    set(p, 8, 2, 5, { id: 'minecraft:oak_door', properties: { half: 'upper' } });
    expect(reach(p, [1, 1, 1], [12, 1, 12])).toBe(true);
    set(p, 8, 1, 5, { id: 'minecraft:iron_door', properties: { half: 'lower' } });
    set(p, 8, 2, 5, { id: 'minecraft:iron_door', properties: { half: 'upper' } });
    expect(reach(p, [1, 1, 1], [12, 1, 12])).toBe(false);
  });

  it('climbs ladders', () => {
    const p = floor();
    fillBox(p, { x: 8, y: 1, z: 0 }, { x: 15, y: 4, z: 15 }, STONE);
    for (let y = 1; y <= 4; y++) set(p, 7, y, 5, { id: 'minecraft:ladder', properties: { facing: 'west' } });
    expect(reach(p, [1, 1, 1], [12, 5, 12])).toBe(true);
  });

  it('avoids damaging blocks', () => {
    const p = floor();
    for (let z = 0; z < 16; z++) set(p, 8, 1, z, { id: 'minecraft:cactus' });
    expect(reach(p, [1, 1, 1], [12, 1, 12])).toBe(false);
  });

  it('does not stand on water or on a floating carpet', () => {
    const p = floor();
    set(p, 3, 1, 3, { id: 'minecraft:water' });
    const g = buildWalkGrid(p, SIZE);
    expect(g.standable(3, 2, 3)).toBe(false);
    set(p, 5, 3, 5, { id: 'minecraft:white_carpet' });
    expect(buildWalkGrid(p, SIZE).standable(5, 3, 5)).toBe(false);
    set(p, 6, 1, 6, { id: 'minecraft:white_carpet' });
    expect(buildWalkGrid(p, SIZE).standable(6, 1, 6)).toBe(true);
  });

  it('tells 1-wide from 2-wide corridors', () => {
    const p = floor();
    fillBox(p, { x: 0, y: 1, z: 0 }, { x: 15, y: 2, z: 15 }, STONE);
    // 1-wide corridor along x at z=3
    fillBox(p, { x: 0, y: 1, z: 3 }, { x: 15, y: 2, z: 3 }, { id: 'minecraft:air' });
    // 2-wide corridor along x at z=8..9
    fillBox(p, { x: 0, y: 1, z: 8 }, { x: 15, y: 2, z: 9 }, { id: 'minecraft:air' });
    const g = buildWalkGrid(p, SIZE);
    expect(g.wide(5, 1, 3)).toBe(false);
    expect(g.wide(5, 1, 8)).toBe(true);
    expect(reach(p, [0, 1, 3], [15, 1, 3])).toBe(true);
    expect(reach(p, [0, 1, 3], [15, 1, 3], true)).toBe(false);
    expect(reach(p, [0, 1, 8], [15, 1, 9], true)).toBe(true);
  });

  it('reports the nearest reached cell to an unreachable target', () => {
    const p = floor();
    for (let z = 0; z < 16; z++) set(p, 8, 1, z, { id: 'minecraft:oak_fence' });
    const r = explore(buildWalkGrid(p, SIZE), [1, 1, 1]);
    const near = r.nearest([12, 1, 5])!;
    expect(near.pos).toEqual([7, 1, 5]);
    expect(near.distance).toBe(5);
  });

  it('reaches nothing from a non-standable start', () => {
    const r = explore(buildWalkGrid(floor(), SIZE), [1, 5, 1]);
    expect(r.reached([1, 5, 1])).toBe(false);
    expect(r.nearest([2, 1, 2])).toBeNull();
  });
});
