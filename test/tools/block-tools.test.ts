import { describe, expect, it } from 'vitest';
import { ProjectManager } from '../../src/core/project-manager.js';
import { setBlockHandler, setBlocksHandler } from '../../src/tools/block-tools.js';

describe('block tool handlers', () => {
  it('sets a single block on the active project', () => {
    const manager = new ProjectManager();
    manager.createProject('demo');
    setBlockHandler(manager, { pos: { x: 0, y: 0, z: 0 }, block: { id: 'minecraft:stone' } });
    expect(manager.getActive().getBlock({ x: 0, y: 0, z: 0 })).toEqual({ id: 'minecraft:stone' });
  });

  it('sets multiple blocks in one call', () => {
    const manager = new ProjectManager();
    manager.createProject('demo');
    setBlocksHandler(manager, {
      blocks: [
        { pos: { x: 0, y: 0, z: 0 }, block: { id: 'minecraft:stone' } },
        { pos: { x: 1, y: 0, z: 0 }, block: { id: 'minecraft:dirt' } }
      ]
    });
    expect(manager.getActive().getBlockCounts()).toEqual({
      'minecraft:stone': 1,
      'minecraft:dirt': 1
    });
  });

  it('throws when there is no active project', () => {
    const manager = new ProjectManager();
    expect(() =>
      setBlockHandler(manager, { pos: { x: 0, y: 0, z: 0 }, block: { id: 'minecraft:stone' } })
    ).toThrow();
  });
});
