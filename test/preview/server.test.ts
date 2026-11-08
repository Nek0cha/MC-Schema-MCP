import { mkdtempSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectManager } from '../../src/core/project-manager.js';
import { AssetStore } from '../../src/preview/assets/asset-store.js';
import { decodeChunks } from '../../src/preview/chunk-codec.js';
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

/** An asset store that is never ready and never downloads anything. */
function offlineAssets(): AssetStore {
  return new AssetStore({
    cacheDir: mkdtempSync(join(tmpdir(), 'mc-assets-')),
    version: 'test',
    fetchImpl: () => Promise.reject(new Error('offline'))
  });
}

function rawGet(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('PreviewServer 3D API', () => {
  let server: PreviewServer | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  async function start(manager: ProjectManager): Promise<number> {
    server = new PreviewServer(manager, 0, { assets: offlineAssets() });
    return server.ensureStarted();
  }

  async function chunks(port: number, query: string) {
    const res = await fetch(`http://127.0.0.1:${port}/api/chunks?${query}`);
    expect(res.status).toBe(200);
    return {
      revision: Number(res.headers.get('x-revision')),
      chunks: decodeChunks(new Uint8Array(await res.arrayBuffer()))
    };
  }

  const stone = { id: 'minecraft:stone' };
  const keyOf = (c: { cx: number; cy: number; cz: number }) => `${c.cx},${c.cy},${c.cz}`;

  it('serves the 2D viewer at /2d', async () => {
    const port = await start(new ProjectManager());
    const body = await (await fetch(`http://127.0.0.1:${port}/2d`)).text();
    expect(body).toContain('/api/build');
  });

  it('reports revision, bounds and asset state from /api/status', async () => {
    const manager = new ProjectManager();
    const p = manager.createProject('demo');
    p.setBlock({ x: 1, y: 2, z: 3 }, stone);
    const port = await start(manager);
    const data = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
    expect(data.project).toBe('demo');
    expect(data.revision).toBe(p.revision);
    expect(data.bounds).toEqual({ min: { x: 1, y: 2, z: 3 }, max: { x: 1, y: 2, z: 3 } });
    expect(data.assets).toMatchObject({ state: 'missing', version: 'test' });
    expect(typeof data.paletteVersion).toBe('number');
  });

  it('returns 404 for status of an unknown project', async () => {
    const port = await start(new ProjectManager());
    expect((await fetch(`http://127.0.0.1:${port}/api/status?project=nope`)).status).toBe(404);
  });

  it('returns changed chunks and their existing neighbours, but not distant ones, for since', async () => {
    const manager = new ProjectManager();
    const p = manager.createProject('demo');
    p.setBlock({ x: 0, y: 0, z: 0 }, stone);
    p.setBlock({ x: 16, y: 0, z: 0 }, stone); // east neighbour (1,0,0)
    p.setBlock({ x: 80, y: 0, z: 0 }, stone); // far chunk (5,0,0)
    const port = await start(manager);

    const all = await chunks(port, 'since=0');
    expect(all.chunks.map(keyOf).sort()).toEqual(['0,0,0', '1,0,0', '5,0,0']);
    expect(all.revision).toBe(p.revision);

    p.setBlock({ x: 1, y: 0, z: 0 }, stone);
    const delta = await chunks(port, `since=${all.revision}`);
    expect(delta.chunks.map(keyOf).sort()).toEqual(['0,0,0', '1,0,0']);
    expect(delta.revision).toBe(p.revision);
  });

  it('sends a chunk that became empty as removed (state 1) and refreshes its neighbours', async () => {
    const manager = new ProjectManager();
    const p = manager.createProject('demo');
    p.setBlock({ x: 0, y: 0, z: 0 }, stone);
    p.setBlock({ x: 16, y: 0, z: 0 }, stone);
    const port = await start(manager);
    const first = await chunks(port, 'since=0');
    p.removeBlock({ x: 16, y: 0, z: 0 });
    const delta = await chunks(port, `since=${first.revision}`);
    expect(delta.chunks.find((c) => c.cx === 1)?.removed).toBe(true);
    expect(delta.chunks.find((c) => c.cx === 0)?.removed).toBe(false);
  });

  it('filters by focus and margin', async () => {
    const manager = new ProjectManager();
    const p = manager.createProject('demo');
    p.setBlock({ x: 0, y: 0, z: 0 }, stone);
    p.setBlock({ x: 100, y: 0, z: 0 }, stone);
    const port = await start(manager);
    const near = await chunks(port, 'since=0&focus=0,0,0,5,5,5&margin=8');
    expect(near.chunks.map((c) => c.cx)).toEqual([0]);
    const wide = await chunks(port, 'since=0&focus=0,0,0,5,5,5&margin=200');
    expect(wide.chunks.map((c) => c.cx).sort((a, b) => a - b)).toEqual([0, 6]);
  });

  it('puts connection-resolved states in the display palette and the chunk cells', async () => {
    const manager = new ProjectManager();
    const p = manager.createProject('demo');
    p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:oak_fence' });
    p.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:oak_fence' });
    const port = await start(manager);
    const { chunks: list } = await chunks(port, 'since=0');
    const cells = list[0].cells as Uint16Array;
    const idWest = cells[0];
    const idEast = cells[1];
    expect(idWest).not.toBe(0);
    const pal = await (await fetch(`http://127.0.0.1:${port}/api/palette?since=0`)).json();
    const byId = new Map<number, { key: string }>(pal.entries.map((e: { id: number; key: string }) => [e.id, e]));
    expect(byId.get(idWest)?.key).toContain('east=true');
    expect(byId.get(idEast)?.key).toContain('west=true');
  });

  it('refreshes a neighbour chunk when the connection source changes next door', async () => {
    const manager = new ProjectManager();
    const p = manager.createProject('demo');
    p.setBlock({ x: 15, y: 0, z: 0 }, { id: 'minecraft:oak_fence' });
    const port = await start(manager);
    const first = await chunks(port, 'since=0');
    p.setBlock({ x: 16, y: 0, z: 0 }, { id: 'minecraft:oak_fence' });
    const delta = await chunks(port, `since=${first.revision}`);
    expect(delta.chunks.map((c) => c.cx).sort()).toEqual([0, 1]);
    const cell = delta.chunks.find((c) => c.cx === 0)?.cells?.[15] as number;
    const pal = await (await fetch(`http://127.0.0.1:${port}/api/palette?since=0`)).json();
    expect(pal.entries.find((e: { id: number }) => e.id === cell).key).toContain('east=true');
  });

  it('returns only new palette entries for since and everything when the version differs', async () => {
    const manager = new ProjectManager();
    const p = manager.createProject('demo');
    p.setBlock({ x: 0, y: 0, z: 0 }, stone);
    const port = await start(manager);
    await chunks(port, 'since=0');
    const a = await (await fetch(`http://127.0.0.1:${port}/api/palette?since=0`)).json();
    expect(a.entries).toHaveLength(1);
    const b = await (await fetch(`http://127.0.0.1:${port}/api/palette?since=1&version=${a.version}`)).json();
    expect(b.entries).toHaveLength(0);
    const c = await (await fetch(`http://127.0.0.1:${port}/api/palette?since=1&version=${a.version + 1}`)).json();
    expect(c.entries).toHaveLength(1);
  });

  it('rejects path traversal under /vendor and /client', async () => {
    const port = await start(new ProjectManager());
    expect(await rawGet(port, '/vendor/three/build/../../package.json')).toBe(404);
    expect(await rawGet(port, '/vendor/three/build/%2e%2e/package.json')).toBe(404);
    expect(await rawGet(port, '/vendor/three/build/..%2f..%2fpackage.json')).toBe(404);
    expect(await rawGet(port, '/client/../server.js')).toBe(404);
    expect(await rawGet(port, '/vendor/three/build/three.module.js')).toBe(200);
  });

  it('answers 404 for textures that are not cached', async () => {
    const port = await start(new ProjectManager());
    expect((await fetch(`http://127.0.0.1:${port}/assets/test/textures/block/stone.png`)).status).toBe(404);
  });
});
