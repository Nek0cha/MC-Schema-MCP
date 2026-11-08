import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetStore } from '../../src/preview/assets/asset-store.js';
import { ProjectManager } from '../../src/core/project-manager.js';
import {
  createPreviewServerState,
  previewBuildHandler,
  type PreviewServerState
} from '../../src/tools/preview-tools.js';

/** Never downloads anything. */
function offlineState(): PreviewServerState {
  return createPreviewServerState(
    new AssetStore({
      cacheDir: mkdtempSync(join(tmpdir(), 'mc-assets-')),
      version: 'test',
      fetchImpl: () => Promise.reject(new Error('offline'))
    })
  );
}

describe('previewBuildHandler', () => {
  let state: PreviewServerState | null = null;

  afterEach(async () => {
    if (state?.server) {
      await state.server.close();
    }
    state = null;
  });

  it('throws when there is no active project, matching other tools', async () => {
    const manager = new ProjectManager();
    state = offlineState();

    await expect(previewBuildHandler(manager, state)).rejects.toThrow();
  });

  it('starts a server and returns its URL', async () => {
    const manager = new ProjectManager();
    manager.createProject('house');
    state = offlineState();

    const result = await previewBuildHandler(manager, state);

    expect(result.content[0].text).toMatch(/^Preview available at http:\/\/127\.0\.0\.1:\d+\/$/);
  });

  it('reuses the same server (and port) on a second call', async () => {
    const manager = new ProjectManager();
    manager.createProject('house');
    state = offlineState();

    const first = await previewBuildHandler(manager, state);
    const second = await previewBuildHandler(manager, state);

    expect(first.content[0].text).toBe(second.content[0].text);
  });
});
