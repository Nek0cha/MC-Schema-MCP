import { describe, expect, it } from 'vitest';
import { ProjectManager } from '../../src/core/project-manager.js';
import {
  createProjectHandler,
  listProjectsHandler,
  switchProjectHandler,
  deleteProjectHandler
} from '../../src/tools/project-tools.js';

describe('project tool handlers', () => {
  it('creates and lists projects', () => {
    const manager = new ProjectManager();
    createProjectHandler(manager, { name: 'house' });
    expect(listProjectsHandler(manager).content[0].text).toBe('house');
  });

  it('reports no projects when none exist', () => {
    const manager = new ProjectManager();
    expect(listProjectsHandler(manager).content[0].text).toBe('(no projects yet)');
  });

  it('switches the active project', () => {
    const manager = new ProjectManager();
    createProjectHandler(manager, { name: 'house' });
    createProjectHandler(manager, { name: 'tower' });
    switchProjectHandler(manager, { name: 'house' });
    expect(manager.getActive().name).toBe('house');
  });

  it('deletes a project', () => {
    const manager = new ProjectManager();
    createProjectHandler(manager, { name: 'house' });
    deleteProjectHandler(manager, { name: 'house' });
    expect(listProjectsHandler(manager).content[0].text).toBe('(no projects yet)');
  });
});
