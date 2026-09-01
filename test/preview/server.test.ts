import { afterEach, describe, expect, it } from 'vitest';
import { ProjectManager } from '../../src/core/project-manager.js';
import { PreviewServer } from '../../src/preview/server.js';

describe('PreviewServer', () => {
  let server: PreviewServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('starts and serves an HTML page at /', async () => {
    const manager = new ProjectManager();
    server = new PreviewServer(manager);
    const port = await server.ensureStarted();

    const response = await fetch(`http://127.0.0.1:${port}/`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('<title>');
  });

  it('reuses the same port on a second ensureStarted call', async () => {
    const manager = new ProjectManager();
    server = new PreviewServer(manager);

    const firstPort = await server.ensureStarted();
    const secondPort = await server.ensureStarted();

    expect(secondPort).toBe(firstPort);
  });

  it('returns 404 for an unknown path', async () => {
    const manager = new ProjectManager();
    server = new PreviewServer(manager);
    const port = await server.ensureStarted();

    const response = await fetch(`http://127.0.0.1:${port}/nope`);

    expect(response.status).toBe(404);
  });
});
