import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectManager } from '../../src/core/project-manager.js';

describe('ProjectManager', () => {
  it('throws when there is no active project', () => {
    const manager = new ProjectManager();
    expect(() => manager.getActive()).toThrow();
  });

  it('creates a project and makes it active', () => {
    const manager = new ProjectManager();
    manager.createProject('house');
    expect(manager.getActive().name).toBe('house');
    expect(manager.listProjects()).toEqual(['house']);
  });

  it('refuses to create a project with a duplicate name', () => {
    const manager = new ProjectManager();
    manager.createProject('house');
    expect(() => manager.createProject('house')).toThrow();
  });

  it('switches the active project', () => {
    const manager = new ProjectManager();
    manager.createProject('house');
    manager.createProject('tower');
    expect(manager.getActive().name).toBe('tower');
    manager.switchProject('house');
    expect(manager.getActive().name).toBe('house');
  });

  it('throws when switching to a project that does not exist', () => {
    const manager = new ProjectManager();
    expect(() => manager.switchProject('missing')).toThrow();
  });

  it('deletes a project and clears active status if it was active', () => {
    const manager = new ProjectManager();
    manager.createProject('house');
    manager.deleteProject('house');
    expect(manager.listProjects()).toEqual([]);
    expect(() => manager.getActive()).toThrow();
  });

  it('gets a project by name without changing the active project', () => {
    const manager = new ProjectManager();
    manager.createProject('house');
    manager.createProject('tower'); // 'tower' is now active

    const house = manager.getProject('house');

    expect(house?.name).toBe('house');
    expect(manager.getActive().name).toBe('tower');
  });

  it('returns undefined when getting a project that does not exist', () => {
    const manager = new ProjectManager();
    expect(manager.getProject('missing')).toBeUndefined();
  });

  describe('with a dataDir', () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'mc-pm-'));
    });
    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it('survives a restart', () => {
      const a = new ProjectManager({ dataDir: root });
      a.createProject('town');
      a.getActive().setBlock({ x: 1, y: 2, z: 3 }, { id: 'minecraft:stone' });
      a.saveActive();
      const b = new ProjectManager({ dataDir: root });
      expect(b.listProjects()).toEqual(['town']);
      expect(() => b.getActive()).toThrow();
      expect(b.switchProject('town').getBlock({ x: 1, y: 2, z: 3 })).toEqual({ id: 'minecraft:stone' });
    });

    it('lists an empty project right after creation', () => {
      new ProjectManager({ dataDir: root }).createProject('empty');
      expect(new ProjectManager({ dataDir: root }).listProjects()).toEqual(['empty']);
    });

    it('rejects names that differ only by case, in memory and on disk', () => {
      const a = new ProjectManager({ dataDir: root });
      a.createProject('Foo');
      expect(() => a.createProject('foo')).toThrow(/already exists/);
      expect(() => new ProjectManager({ dataDir: root }).createProject('FOO')).toThrow(/already exists/);
    });

    it('getProject lazy-loads without changing the active project', () => {
      const a = new ProjectManager({ dataDir: root });
      a.createProject('one');
      a.getActive().setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
      a.createProject('two');
      a.saveActive();
      a.switchProject('one');
      a.saveActive();

      const b = new ProjectManager({ dataDir: root });
      b.createProject('active');
      const one = b.getProject('one');
      expect(one?.getBlock({ x: 0, y: 0, z: 0 })).toEqual({ id: 'minecraft:stone' });
      expect(b.getActive().name).toBe('active');
      expect(b.getProject('missing')).toBeUndefined();
    });

    it('throws when switching to a corrupt stored project but leaves others usable', () => {
      const a = new ProjectManager({ dataDir: root });
      a.createProject('bad');
      a.createProject('good');
      writeFileSync(join(root, 'bad', 'project.json'), '{nope');
      const b = new ProjectManager({ dataDir: root });
      expect(() => b.switchProject('bad')).toThrow(/bad/);
      expect(b.switchProject('good').name).toBe('good');
    });

    it('deleteProject moves the folder to trash and drops it from the list', () => {
      const a = new ProjectManager({ dataDir: root });
      a.createProject('gone');
      const { trashedTo } = a.deleteProject('gone');
      expect(trashedTo).toBeDefined();
      expect(existsSync(trashedTo as string)).toBe(true);
      expect(existsSync(join(root, 'gone'))).toBe(false);
      expect(a.listProjects()).toEqual([]);
      expect(new ProjectManager({ dataDir: root }).listProjects()).toEqual([]);
      expect(() => a.getActive()).toThrow();
    });
  });

  it('keeps working purely in memory when no dataDir is given', () => {
    const before = existsSync('./projects') ? readdirSync('./projects') : null;
    const manager = new ProjectManager();
    manager.createProject('mem-only');
    manager.getActive().setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    manager.saveActive();
    expect(manager.deleteProject('mem-only')).toEqual({});
    const after = existsSync('./projects') ? readdirSync('./projects') : null;
    expect(after).toEqual(before);
  });
});
