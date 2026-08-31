import { describe, expect, it } from 'vitest';
import { ProjectManager } from '../../src/core/project-manager.js';
import { fillBoxHandler, sphereHandler } from '../../src/tools/shape-tools.js';

describe('shape tool handlers', () => {
  it('fills a box on the active project', () => {
    const manager = new ProjectManager();
    manager.createProject('demo');
    fillBoxHandler(manager, {
      from: { x: 0, y: 0, z: 0 },
      to: { x: 1, y: 0, z: 0 },
      block: { id: 'minecraft:stone' }
    });
    expect(manager.getActive().getBlockCounts()).toEqual({ 'minecraft:stone': 2 });
  });

  it('builds a sphere on the active project', () => {
    const manager = new ProjectManager();
    manager.createProject('demo');
    sphereHandler(manager, {
      center: { x: 0, y: 0, z: 0 },
      radius: 0,
      block: { id: 'minecraft:stone' }
    });
    expect(manager.getActive().getBlockCounts()).toEqual({ 'minecraft:stone': 1 });
  });
});
