import { BuildProject } from './build-project.js';
import { listStoredProjects, loadProject, moveProjectToTrash, saveProject } from './project-store.js';

export interface ProjectManagerOptions {
  /** Root directory for on-disk persistence. When omitted, projects live only in memory. */
  dataDir?: string;
}

export class ProjectManager {
  private readonly projects = new Map<string, BuildProject>();
  /** Lower-cased name -> canonical name, for every project known in memory or on disk. */
  private readonly knownNames = new Map<string, string>();
  private readonly dataDir: string | undefined;
  private activeProjectName: string | null = null;

  constructor(options: ProjectManagerOptions = {}) {
    this.dataDir = options.dataDir;
    if (this.dataDir) {
      for (const name of listStoredProjects(this.dataDir)) {
        this.knownNames.set(name.toLowerCase(), name);
      }
    }
  }

  createProject(name: string): BuildProject {
    if (this.knownNames.has(name.toLowerCase())) {
      throw new Error(`Project "${name}" already exists.`);
    }
    const project = new BuildProject(name);
    if (this.dataDir) {
      saveProject(this.dataDir, project);
    }
    this.projects.set(name, project);
    this.knownNames.set(name.toLowerCase(), name);
    this.activeProjectName = name;
    return project;
  }

  switchProject(name: string): BuildProject {
    const project = this.getProject(name);
    if (!project) {
      throw new Error(`Project "${name}" does not exist.`);
    }
    this.activeProjectName = project.name;
    return project;
  }

  deleteProject(name: string): { trashedTo?: string } {
    const canonical = this.knownNames.get(name.toLowerCase());
    if (canonical === undefined) {
      throw new Error(`Project "${name}" does not exist.`);
    }
    let trashedTo: string | undefined;
    if (this.dataDir) {
      trashedTo = moveProjectToTrash(this.dataDir, canonical);
    }
    this.projects.delete(canonical);
    this.knownNames.delete(canonical.toLowerCase());
    if (this.activeProjectName === canonical) {
      this.activeProjectName = null;
    }
    return trashedTo ? { trashedTo } : {};
  }

  listProjects(): string[] {
    return [...this.knownNames.values()];
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

  /**
   * Returns a project by name, loading it from disk if needed. Does not change
   * the active project. Returns undefined when no such project exists; throws
   * when the stored project cannot be read.
   */
  getProject(name: string): BuildProject | undefined {
    const canonical = this.knownNames.get(name.toLowerCase());
    if (canonical === undefined) return undefined;
    const loaded = this.projects.get(canonical);
    if (loaded) return loaded;
    if (!this.dataDir) return undefined;
    const project = loadProject(this.dataDir, canonical);
    this.projects.set(canonical, project);
    return project;
  }

  /** Persists the active project's unsaved changes. No-op without a dataDir; rethrows save failures. */
  saveActive(): void {
    if (!this.dataDir) return;
    saveProject(this.dataDir, this.getActive());
  }
}
