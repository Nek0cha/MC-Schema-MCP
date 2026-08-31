import { describe, expect, it } from 'vitest';
import { BuildProject } from '../../src/core/build-project.js';

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
    expect(project.voxels.size).toBe(1);
  });
});
