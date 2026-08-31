import { describe, expect, it } from 'vitest';
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
});
