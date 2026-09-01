import { afterEach, describe, expect, it } from 'vitest';
import { ProjectManager } from '../../src/core/project-manager.js';
import {
  createPreviewServerState,
  previewBuildHandler,
  type PreviewServerState
} from '../../src/tools/preview-tools.js';

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
    state = createPreviewServerState();

    await expect(previewBuildHandler(manager, state)).rejects.toThrow();
  });

  it('starts a server and returns its URL', async () => {
    const manager = new ProjectManager();
    manager.createProject('house');
    state = createPreviewServerState();

    const result = await previewBuildHandler(manager, state);

    expect(result.content[0].text).toMatch(/^Preview available at http:\/\/127\.0\.0\.1:\d+\/$/);
  });

  it('reuses the same server (and port) on a second call', async () => {
    const manager = new ProjectManager();
    manager.createProject('house');
    state = createPreviewServerState();

    const first = await previewBuildHandler(manager, state);
    const second = await previewBuildHandler(manager, state);

    expect(first.content[0].text).toBe(second.content[0].text);
  });
});
