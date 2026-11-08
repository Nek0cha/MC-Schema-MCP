import type { ProjectManager } from '../core/project-manager.js';
import type { AssetStore } from '../preview/assets/asset-store.js';
import { PreviewServer } from '../preview/server.js';
import { textResult, type ToolTextResult } from './result.js';

export interface PreviewServerState {
  server: PreviewServer | null;
  /** Asset store handed to the server when it is created; omit to use the env-configured default. */
  assets?: AssetStore;
}

export function createPreviewServerState(assets?: AssetStore): PreviewServerState {
  return { server: null, assets };
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
    state.server = new PreviewServer(manager, 0, { assets: state.assets });
  }
  const port = await state.server.ensureStarted();
  // Download the vanilla block assets in the background; the viewer shows fallback colors until they are ready.
  state.server.startAssets();
  return textResult(`Preview available at http://127.0.0.1:${port}/`);
}
