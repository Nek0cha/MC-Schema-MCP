import type { ProjectManager } from '../core/project-manager.js';
import { textResult, type ToolTextResult } from './result.js';

export function createProjectHandler(manager: ProjectManager, args: { name: string }): ToolTextResult {
  manager.createProject(args.name);
  return textResult(`Created and activated project "${args.name}".`);
}

export function listProjectsHandler(manager: ProjectManager): ToolTextResult {
  const names = manager.listProjects();
  return textResult(names.length > 0 ? names.join(', ') : '(no projects yet)');
}

export function switchProjectHandler(manager: ProjectManager, args: { name: string }): ToolTextResult {
  manager.switchProject(args.name);
  return textResult(`Switched to project "${args.name}".`);
}

export function deleteProjectHandler(manager: ProjectManager, args: { name: string }): ToolTextResult {
  manager.deleteProject(args.name);
  return textResult(`Deleted project "${args.name}".`);
}
