import { BuildProject } from './build-project.js';

export class ProjectManager {
  private readonly projects = new Map<string, BuildProject>();
  private activeProjectName: string | null = null;

  createProject(name: string): BuildProject {
    if (this.projects.has(name)) {
      throw new Error(`Project "${name}" already exists.`);
    }
    const project = new BuildProject(name);
    this.projects.set(name, project);
    this.activeProjectName = name;
    return project;
  }

  switchProject(name: string): BuildProject {
    const project = this.projects.get(name);
    if (!project) {
      throw new Error(`Project "${name}" does not exist.`);
    }
    this.activeProjectName = name;
    return project;
  }

  deleteProject(name: string): void {
    if (!this.projects.has(name)) {
      throw new Error(`Project "${name}" does not exist.`);
    }
    this.projects.delete(name);
    if (this.activeProjectName === name) {
      this.activeProjectName = null;
    }
  }

  listProjects(): string[] {
    return [...this.projects.keys()];
  }

  getActive(): BuildProject {
    if (!this.activeProjectName) {
      throw new Error('No active project. Call createProject or switchProject first.');
    }
    const project = this.projects.get(this.activeProjectName);
    if (!project) {
      throw new Error('Active project reference is invalid.');
    }
    return project;
  }
}
