import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectManager } from '../../src/core/project-manager.js';
import {
  deleteTemplateHandler,
  listTemplatesHandler,
  placeTemplateHandler,
  saveTemplateHandler
} from '../../src/tools/template-tools.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-tpltool-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const manager = new ProjectManager();
  manager.createProject('demo');
  manager.getActive().setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
  manager.getActive().setBlock({ x: 2, y: 1, z: 0 }, { id: 'minecraft:dirt' });
  return manager;
}

describe('template tool handlers', () => {
  it('saveTemplate reports size and anchor', () => {
    const manager = setup();
    const result = saveTemplateHandler(manager, dir, {
      name: 'tower',
      from: { x: 0, y: 0, z: 0 },
      to: { x: 2, y: 1, z: 0 },
      description: 'small'
    });
    expect(result.content[0].text).toBe('Saved template "tower" (3x2x1, anchor offset (1, 0, 0) from its min corner).');
  });

  it('listTemplates lists names, sizes, anchors and descriptions', () => {
    const manager = setup();
    expect(listTemplatesHandler(dir).content[0].text).toBe('(no templates yet)');
    saveTemplateHandler(manager, dir, {
      name: 'tower',
      from: { x: 0, y: 0, z: 0 },
      to: { x: 2, y: 1, z: 0 },
      description: 'small'
    });
    const text = listTemplatesHandler(dir).content[0].text;
    expect(text).toContain('tower');
    expect(text).toContain('3x2x1');
    expect(text).toContain('anchor (1, 0, 0)');
    expect(text).toContain('small');
  });

  it('placeTemplate reports the count and the transformed bounds', () => {
    const manager = setup();
    saveTemplateHandler(manager, dir, {
      name: 'tower',
      from: { x: 0, y: 0, z: 0 },
      to: { x: 2, y: 1, z: 0 }
    });
    const result = placeTemplateHandler(manager, dir, { name: 'tower', at: { x: 50, y: 0, z: 50 }, rotate: 90 });
    expect(result.content[0].text).toBe('Placed 2 block(s) from template "tower" at (50, 0, 49)..(50, 1, 51).');
    expect(manager.getActive().getBlock({ x: 50, y: 0, z: 49 })?.id).toBe('minecraft:stone');
  });

  it('deleteTemplate moves the file to the trash', () => {
    const manager = setup();
    saveTemplateHandler(manager, dir, { name: 'tower', from: { x: 0, y: 0, z: 0 }, to: { x: 2, y: 1, z: 0 } });
    const result = deleteTemplateHandler(dir, { name: 'tower' });
    expect(result.content[0].text).toContain('Deleted template "tower"');
    expect(result.content[0].text).toContain('.trash');
    expect(listTemplatesHandler(dir).content[0].text).toBe('(no templates yet)');
  });
});
