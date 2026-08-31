import { describe, expect, it } from 'vitest';
import { BuildProject } from '../../src/core/build-project.js';
import { fillBox, outlineBox, line, wall } from '../../src/core/shapes.js';

const STONE = { id: 'minecraft:stone' };

describe('fillBox', () => {
  it('fills every position in the box, inclusive of both corners', () => {
    const project = new BuildProject('demo');
    fillBox(project, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }, STONE);
    expect(project.getBlockCounts()).toEqual({ 'minecraft:stone': 4 });
  });

  it('works regardless of corner order', () => {
    const project = new BuildProject('demo');
    fillBox(project, { x: 1, y: 1, z: 1 }, { x: 0, y: 0, z: 0 }, STONE);
    expect(project.getBoundingBox()).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } });
  });
});

describe('outlineBox', () => {
  it('only sets blocks on the shell of a 3x3x3 box', () => {
    const project = new BuildProject('demo');
    outlineBox(project, { x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }, STONE);
    // 3x3x3 = 27 total, minus the single interior cell (1,1,1) = 26 on the shell.
    expect(project.getBlockCounts()).toEqual({ 'minecraft:stone': 26 });
    expect(project.getBlock({ x: 1, y: 1, z: 1 })).toBeUndefined();
    expect(project.getBlock({ x: 0, y: 0, z: 0 })).toEqual(STONE);
  });
});

describe('line', () => {
  it('draws a straight axis-aligned line inclusive of both ends', () => {
    const project = new BuildProject('demo');
    line(project, { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, STONE);
    expect(project.getBlockCounts()).toEqual({ 'minecraft:stone': 5 });
    for (let x = 0; x <= 4; x++) {
      expect(project.getBlock({ x, y: 0, z: 0 })).toEqual(STONE);
    }
  });

  it('draws a diagonal line', () => {
    const project = new BuildProject('demo');
    line(project, { x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }, STONE);
    expect(project.getBlock({ x: 0, y: 0, z: 0 })).toEqual(STONE);
    expect(project.getBlock({ x: 1, y: 1, z: 0 })).toEqual(STONE);
    expect(project.getBlock({ x: 2, y: 2, z: 0 })).toEqual(STONE);
  });
});

describe('wall', () => {
  it('builds a vertical wall along the path with the given height', () => {
    const project = new BuildProject('demo');
    wall(project, { x: 0, y: 10, z: 0 }, { x: 2, y: 10, z: 0 }, 3, STONE);
    // 3 ground positions x 3 blocks tall = 9.
    expect(project.getBlockCounts()).toEqual({ 'minecraft:stone': 9 });
    expect(project.getBlock({ x: 1, y: 12, z: 0 })).toEqual(STONE);
    expect(project.getBlock({ x: 1, y: 13, z: 0 })).toBeUndefined();
  });

  it('rejects a non-positive height', () => {
    const project = new BuildProject('demo');
    expect(() => wall(project, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0, STONE)).toThrow();
  });
});
