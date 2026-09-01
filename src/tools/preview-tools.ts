import type { ProjectManager } from '../core/project-manager.js';
import { PreviewServer } from '../preview/server.js';
import { textResult, type ToolTextResult } from './result.js';

export interface PreviewServerState {
  server: PreviewServer | null;
}

export function createPreviewServerState(): PreviewServerState {
  return { server: null };
}

export async function previewBuildHandler(
  manager: ProjectManager,
  state: PreviewServerState
): Promise<ToolTextResult> {
  // Throws if there's no active project, same as getBuildInfoHandler and
  // exportSchematicHandler — previewBuild always targets the active
  // project (the /api/build route separately supports ?project= for the
  // browser side, but the tool itself doesn't take a project argument).
  manager.getActive();

  if (!state.server) {
    state.server = new PreviewServer(manager);
  }
  const port = await state.server.ensureStarted();
  return textResult(`Preview available at http://127.0.0.1:${port}/`);
}
