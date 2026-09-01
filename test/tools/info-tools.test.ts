import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { ProjectManager } from '../../src/core/project-manager.js';
import { getBuildInfoHandler, exportSchematicHandler } from '../../src/tools/info-tools.js';

describe('info tool handlers', () => {
  afterEach(() => {
    if (existsSync('./output/info-test.schem')) {
      rmSync('./output/info-test.schem');
    }
  });

  it('reports an empty project', () => {
    const manager = new ProjectManager();
    manager.createProject('empty');
    expect(getBuildInfoHandler(manager).content[0].text).toContain('is empty');
  });

  it('summarizes size and block counts', () => {
    const manager = new ProjectManager();
    manager.createProject('demo');
    manager.getActive().setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    manager.getActive().setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:dirt' });
    const text = getBuildInfoHandler(manager).content[0].text;
    expect(text).toContain('2x1x1');
    expect(text).toContain('minecraft:stone: 1');
  });

  it('writes a .schem file to the output directory', () => {
    const manager = new ProjectManager();
    manager.createProject('info-test');
    manager.getActive().setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    const result = exportSchematicHandler(manager);
    expect(existsSync('./output/info-test.schem')).toBe(true);
    expect(result.content[0].text).toContain('output/info-test.schem');
  });
});
