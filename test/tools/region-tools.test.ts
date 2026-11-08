import { describe, expect, it } from 'vitest';
import { ProjectManager } from '../../src/core/project-manager.js';
import {
  clearRegionHandler,
  copyRegionHandler,
  decayRegionHandler,
  replaceInRegionHandler,
  stackRegionHandler
} from '../../src/tools/region-tools.js';

function setup() {
  const manager = new ProjectManager();
  manager.createProject('demo');
  const project = manager.getActive();
  for (let x = 0; x < 3; x++) project.setBlock({ x, y: 0, z: 0 }, { id: 'minecraft:stone' });
  return { manager, project };
}

const from = { x: 0, y: 0, z: 0 };
const to = { x: 2, y: 0, z: 0 };

describe('region tool handlers', () => {
  it('copyRegion reports the count and destination bounds', () => {
    const { manager, project } = setup();
    const result = copyRegionHandler(manager, { from, to, dest: { x: 10, y: 0, z: 20 }, rotate: 90 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('Copied 3 block(s) to (10, 0, 20)..(10, 0, 22).');
    expect(project.getBlock({ x: 10, y: 0, z: 22 })?.id).toBe('minecraft:stone');
  });

  it('stackRegion reports the count and written bounds', () => {
    const { manager, project } = setup();
    const result = stackRegionHandler(manager, { from, to, direction: 'up', count: 2 });
    expect(result.content[0].text).toBe('Stacked 6 block(s) up to (0, 1, 0)..(2, 2, 0).');
    expect(project.getBlock({ x: 1, y: 2, z: 0 })?.id).toBe('minecraft:stone');
  });

  it('replaceInRegion reports the count and range', () => {
    const { manager, project } = setup();
    const result = replaceInRegionHandler(manager, {
      from,
      to,
      match: [{ id: 'stone' }],
      replacement: { id: 'minecraft:dirt' }
    });
    expect(result.content[0].text).toBe('Replaced 3 block(s) in (0, 0, 0)..(2, 0, 0).');
    expect(project.getBlockCounts()).toEqual({ 'minecraft:dirt': 3 });
  });

  it('clearRegion reports the count and range', () => {
    const { manager, project } = setup();
    const result = clearRegionHandler(manager, { from, to, mode: 'unset' });
    expect(result.content[0].text).toBe('Cleared 3 cell(s) in (0, 0, 0)..(2, 0, 0).');
    expect(project.blockCount).toBe(0);
  });

  it('decayRegion reports removed and rubble counts and the range', () => {
    const { manager, project } = setup();
    const result = decayRegionHandler(manager, { from, to, intensity: 1, topBias: false, rubble: false });
    expect(result.content[0].text).toBe('Decayed 3 block(s) and placed 0 rubble block(s) in (0, 0, 0)..(2, 0, 0).');
    expect(project.blockCount).toBe(0);
  });

  it('formats large counts with thousands separators', () => {
    const { manager } = setup();
    const result = clearRegionHandler(manager, {
      from: { x: 0, y: 0, z: 0 },
      to: { x: 99, y: 9, z: 9 },
      mode: 'air'
    });
    expect(result.content[0].text).toContain('Cleared 10,000 cell(s)');
  });
});
