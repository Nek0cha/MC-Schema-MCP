import { createServer, type Server } from 'node:http';
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
    expect(body).toContain('/api/build');
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

  it('handles concurrent ensureStarted calls without creating duplicate servers', async () => {
    const manager = new ProjectManager();
    server = new PreviewServer(manager);

    // Call ensureStarted twice concurrently (without awaiting the first)
    const [firstPort, secondPort] = await Promise.all([
      server.ensureStarted(),
      server.ensureStarted(),
    ]);

    // Both should return the same port from the same server
    expect(firstPort).toBe(secondPort);

    // Verify the server is actually listening on that port
    const response = await fetch(`http://127.0.0.1:${firstPort}/`);
    expect(response.status).toBe(200);
  });

  it('returns the active project as JSON from /api/build', async () => {
    const manager = new ProjectManager();
    manager.createProject('demo');
    manager.getActive().setBlock({ x: 0, y: 64, z: 0 }, { id: 'minecraft:stone' });
    server = new PreviewServer(manager);
    const port = await server.ensureStarted();

    const response = await fetch(`http://127.0.0.1:${port}/api/build`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.project).toBe('demo');
    expect(data.bounds).toEqual({ min: { x: 0, y: 64, z: 0 }, max: { x: 0, y: 64, z: 0 } });
    expect(data.blocks).toEqual([{ x: 0, y: 64, z: 0, id: 'minecraft:stone' }]);
  });

  it('returns a named project via the project query param, ignoring the active one', async () => {
    const manager = new ProjectManager();
    manager.createProject('house');
    manager.createProject('tower'); // 'tower' is active
    manager.getProject('house')?.setBlock({ x: 1, y: 2, z: 3 }, { id: 'minecraft:dirt' });
    server = new PreviewServer(manager);
    const port = await server.ensureStarted();

    const response = await fetch(`http://127.0.0.1:${port}/api/build?project=house`);
    const data = await response.json();

    expect(data.project).toBe('house');
    expect(data.blocks).toEqual([{ x: 1, y: 2, z: 3, id: 'minecraft:dirt' }]);
  });

  it('returns 404 for a project name that does not exist', async () => {
    const manager = new ProjectManager();
    server = new PreviewServer(manager);
    const port = await server.ensureStarted();

    const response = await fetch(`http://127.0.0.1:${port}/api/build?project=missing`);

    expect(response.status).toBe(404);
  });

  it('returns 404 when no project param is given and there is no active project', async () => {
    const manager = new ProjectManager();
    server = new PreviewServer(manager);
    const port = await server.ensureStarted();

    const response = await fetch(`http://127.0.0.1:${port}/api/build`);

    expect(response.status).toBe(404);
  });

  it('recovers from a failed start instead of permanently caching the rejection', async () => {
    // Occupy a fixed port with another listener so PreviewServer's own
    // listen() call on that exact port fails deterministically.
    const blocker: Server = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.on('error', reject);
      blocker.listen(0, '127.0.0.1', () => resolve());
    });
    const blockerAddress = blocker.address();
    if (blockerAddress === null || typeof blockerAddress === 'string') {
      throw new Error('Failed to determine the blocking server port.');
    }
    const blockedPort = blockerAddress.port;

    const manager = new ProjectManager();
    server = new PreviewServer(manager, blockedPort);

    await expect(server.ensureStarted()).rejects.toThrow();
    // A second call while the port is still occupied must also reject
    // (not hang or silently succeed) rather than throwing away the retry.
    await expect(server.ensureStarted()).rejects.toThrow();

    await new Promise<void>((resolve) => blocker.close(() => resolve()));

    // Now that the port is free, a subsequent ensureStarted() must succeed
    // instead of replaying the earlier rejection forever.
    const port = await server.ensureStarted();
    expect(port).toBe(blockedPort);

    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(response.status).toBe(200);
  });

  it('close() is safe to call even when the start attempt failed', async () => {
    const blocker: Server = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.on('error', reject);
      blocker.listen(0, '127.0.0.1', () => resolve());
    });
    const blockerAddress = blocker.address();
    if (blockerAddress === null || typeof blockerAddress === 'string') {
      throw new Error('Failed to determine the blocking server port.');
    }

    const manager = new ProjectManager();
    server = new PreviewServer(manager, blockerAddress.port);

    await expect(server.ensureStarted()).rejects.toThrow();
    await expect(server.close()).resolves.toBeUndefined();

    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  });

  it('returns empty bounds and blocks for a project with no blocks', async () => {
    const manager = new ProjectManager();
    manager.createProject('empty');
    server = new PreviewServer(manager);
    const port = await server.ensureStarted();

    const response = await fetch(`http://127.0.0.1:${port}/api/build`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.bounds).toBeNull();
    expect(data.blocks).toEqual([]);
  });
});
