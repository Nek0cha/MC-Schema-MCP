import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssetStore } from '../../src/preview/assets/asset-store.js';

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const META_URL = 'https://example.test/1.21.11.json';
const JAR_URL = 'https://example.test/client.jar';

function buildJar(): Uint8Array {
  return zipSync({
    'assets/minecraft/blockstates/stone.json': strToU8(JSON.stringify({ variants: { '': { model: 'block/stone' } } })),
    'assets/minecraft/models/block/stone.json': strToU8(JSON.stringify({ textures: { all: 'block/stone' } })),
    'assets/minecraft/models/item/x.json': strToU8('{}'),
    'assets/minecraft/textures/block/stone.png': new Uint8Array([1, 2, 3]),
    'assets/minecraft/textures/block/stone.png.mcmeta': strToU8('{}'),
    'assets/minecraft/textures/colormap/grass.png': new Uint8Array([4, 5]),
    'assets/minecraft/textures/item/x.png': new Uint8Array([9]),
    'data/x.json': strToU8('{}')
  });
}

function sha1(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex');
}

interface FakeOptions {
  jar?: Uint8Array;
  sha1?: string;
  versions?: string[];
}

function fakeFetch(opts: FakeOptions = {}): { fetchImpl: typeof fetch; calls: string[] } {
  const jar = opts.jar ?? buildJar();
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url === MANIFEST_URL) {
      const versions = (opts.versions ?? ['1.21.11']).map((id) => ({ id, url: META_URL }));
      return new Response(JSON.stringify({ versions }));
    }
    if (url === META_URL) {
      return new Response(JSON.stringify({ downloads: { client: { url: JAR_URL, sha1: opts.sha1 ?? sha1(jar) } } }));
    }
    if (url === JAR_URL) return new Response(jar as unknown as BodyInit);
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('AssetStore', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'asset-store-'));
  });
  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('downloads, verifies sha1, extracts only the needed folders, and marks complete', async () => {
    const { fetchImpl } = fakeFetch();
    const store = new AssetStore({ cacheDir, version: '1.21.11', fetchImpl });
    expect(store.state).toBe('missing');

    await store.ensure();

    expect(store.state).toBe('ready');
    expect(store.error).toBeUndefined();
    expect(store.version).toBe('1.21.11');
    expect(store.root).toBe(join(cacheDir, 'assets', '1.21.11'));
    expect(store.readJson('blockstates/stone.json')).toEqual({ variants: { '': { model: 'block/stone' } } });
    expect(store.readJson('models/block/stone.json')).toEqual({ textures: { all: 'block/stone' } });
    expect(store.readJson('blockstates/missing.json')).toBeUndefined();
    const tex = store.texturePath('block/stone');
    expect(tex && existsSync(tex)).toBe(true);
    expect(store.texturePath('block/nope')).toBeUndefined();
    expect(existsSync(join(store.root, 'textures', 'colormap', 'grass.png'))).toBe(true);
    expect(existsSync(join(store.root, 'textures', 'item'))).toBe(false);
    expect(existsSync(join(store.root, 'models', 'item'))).toBe(false);
    expect(existsSync(join(store.root, 'textures', 'block', 'stone.png.mcmeta'))).toBe(false);
    expect(existsSync(join(store.root, 'data'))).toBe(false);
    expect(existsSync(join(store.root, '.complete'))).toBe(true);
  });

  it('shares one download between concurrent ensure() calls', async () => {
    const { fetchImpl, calls } = fakeFetch();
    const store = new AssetStore({ cacheDir, version: '1.21.11', fetchImpl });
    const a = store.ensure();
    const b = store.ensure();
    expect(store.state).toBe('downloading');
    await Promise.all([a, b]);
    expect(calls.filter((u) => u === JAR_URL)).toHaveLength(1);
  });

  it('fails on sha1 mismatch and retries on the next ensure()', async () => {
    const bad = fakeFetch({ sha1: '0'.repeat(40) });
    const store = new AssetStore({ cacheDir, version: '1.21.11', fetchImpl: bad.fetchImpl });
    await expect(store.ensure()).rejects.toThrow(/sha1/i);
    expect(store.state).toBe('failed');
    expect(store.error).toMatch(/sha1/i);
    expect(existsSync(join(store.root, '.complete'))).toBe(false);

    const good = fakeFetch();
    const retry = new AssetStore({ cacheDir, version: '1.21.11', fetchImpl: good.fetchImpl });
    await retry.ensure();
    expect(retry.state).toBe('ready');

    // Same instance retries too.
    const flaky = new AssetStore({ cacheDir: join(cacheDir, 'other'), version: '1.21.11', fetchImpl: bad.fetchImpl });
    await expect(flaky.ensure()).rejects.toThrow();
    expect(flaky.state).toBe('failed');
    await expect(flaky.ensure()).rejects.toThrow();
    expect(bad.calls.filter((u) => u === JAR_URL).length).toBeGreaterThanOrEqual(3);
  });

  it('is ready immediately when .complete exists, without fetching', () => {
    const root = join(cacheDir, 'assets', '1.21.11');
    mkdirSync(join(root, 'blockstates'), { recursive: true });
    writeFileSync(join(root, '.complete'), '');
    writeFileSync(join(root, 'blockstates', 'a.json'), '{"ok":true}');
    const { fetchImpl, calls } = fakeFetch();
    const store = new AssetStore({ cacheDir, version: '1.21.11', fetchImpl });
    expect(store.state).toBe('ready');
    expect(store.readJson('blockstates/a.json')).toEqual({ ok: true });
    return store.ensure().then(() => {
      expect(calls).toHaveLength(0);
    });
  });

  it('re-downloads when the directory exists without .complete', async () => {
    const root = join(cacheDir, 'assets', '1.21.11');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'stale.txt'), 'x');
    const { fetchImpl } = fakeFetch();
    const store = new AssetStore({ cacheDir, version: '1.21.11', fetchImpl });
    expect(store.state).toBe('missing');
    await store.ensure();
    expect(store.state).toBe('ready');
    expect(existsSync(join(root, 'stale.txt'))).toBe(false);
  });

  it('reports a missing version id clearly', async () => {
    const { fetchImpl } = fakeFetch({ versions: ['1.20.1'] });
    const store = new AssetStore({ cacheDir, version: '9.9.9', fetchImpl });
    await expect(store.ensure()).rejects.toThrow(/9\.9\.9/);
    expect(store.state).toBe('failed');
    expect(store.error).toContain('9.9.9');
  });
});
