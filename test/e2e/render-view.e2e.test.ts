import { writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { ProjectManager } from '../../src/core/project-manager.js';
import { AssetStore } from '../../src/preview/assets/asset-store.js';
import { createPreviewServerState, renderViewHandler } from '../../src/tools/preview-tools.js';

/**
 * Drives the real headless Edge/Chrome. Needs a browser and, on the first run, network access
 * to download the Minecraft assets into ./cache (or MC_SCHEMA_CACHE_DIR). Run with `pnpm test:e2e`.
 */

interface Pixels {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** Minimal PNG decoder: 8-bit RGB/RGBA, non-interlaced, all five filters. */
function decodePng(png: Buffer): Pixels {
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  let off = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.subarray(off + 4, off + 8).toString('latin1');
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      expect(channels).not.toBe(0);
      expect(data[12]).toBe(0);
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = cur[x * channels];
      out[o + 1] = cur[x * channels + 1];
      out[o + 2] = cur[x * channels + 2];
      out[o + 3] = channels === 4 ? cur[x * channels + 3] : 255;
    }
    prev.set(cur);
  }
  return { width, height, rgba: out };
}

function colorStats(p: Pixels): { distinct: number; dark: number; light: number; total: number } {
  const seen = new Set<number>();
  let dark = 0;
  let light = 0;
  const total = p.width * p.height;
  for (let i = 0; i < total; i++) {
    const r = p.rgba[i * 4];
    const g = p.rgba[i * 4 + 1];
    const b = p.rgba[i * 4 + 2];
    seen.add((r << 16) | (g << 8) | b);
    if (r + g + b < 30) dark++;
    if (r + g + b > 735) light++;
  }
  return { distinct: seen.size, dark, light, total };
}

function imageOf(result: { content: { type: string; data?: string }[] }): Buffer {
  const image = result.content.find((c) => c.type === 'image');
  expect(image).toBeDefined();
  return Buffer.from(image?.data as string, 'base64');
}

/** Deterministic pseudo random numbers so the city is the same on every run. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('renderView (real browser)', () => {
  const manager = new ProjectManager();
  const assets = new AssetStore({
    cacheDir: process.env.MC_SCHEMA_CACHE_DIR ?? './cache',
    version: process.env.MC_SCHEMA_ASSET_VERSION ?? '1.21.11'
  });
  const state = createPreviewServerState(assets);

  afterAll(async () => {
    await state.renderer.close();
    await state.server?.close();
  });

  it('renders a small project to a PNG that is neither black nor white', async () => {
    const p = manager.createProject('small');
    p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) p.setBlock({ x, y: 0, z }, { id: 'minecraft:grass_block' });
    for (let y = 1; y < 4; y++) p.setBlock({ x: 3, y, z: 3 }, { id: 'minecraft:oak_log' });
    p.setBlock({ x: 5, y: 1, z: 5 }, { id: 'minecraft:oak_stairs', properties: { facing: 'east', half: 'bottom', shape: 'straight' } });

    const t0 = Date.now();
    const result = await renderViewHandler(manager, state, { width: 640, height: 400 });
    const ms = Date.now() - t0;
    console.log(`[e2e] small project iso_se: ${ms} ms`);

    const png = imageOf(result);
    const pixels = decodePng(png);
    expect([pixels.width, pixels.height]).toEqual([640, 400]);
    const stats = colorStats(pixels);
    expect(stats.distinct).toBeGreaterThan(20);
    expect(stats.dark / stats.total).toBeLessThan(0.9);
    expect(stats.light / stats.total).toBeLessThan(0.9);
    expect(result.content[1]).toMatchObject({ type: 'text' });
    if (process.env.MC_SCHEMA_E2E_OUT) writeFileSync(`${process.env.MC_SCHEMA_E2E_OUT}/e2e-small.png`, png);
  });

  it('draws raid map markers unless markers is false', async () => {
    const p = manager.createProject('raid');
    p.mapSettings = { id: 'r', name: 'R', size: [16, 8, 16], targetVersion: '1.21.1', includeAir: true };
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) p.setBlock({ x, y: 0, z }, { id: 'minecraft:stone' });
    p.addMarkers([
      { kind: 'extract', id: 'gate', pos: [8, 1, 8], radius: 4 },
      { kind: 'player_spawn', pos: [3, 1, 3], facing: 0 }
    ]);
    const countMarkerPixels = (png: Buffer) => {
      const { rgba } = decodePng(png);
      let n = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        const [r, g, b] = [rgba[i], rgba[i + 1], rgba[i + 2]];
        // Cyan (extract) or green (player spawn); the stone and the sky are neither.
        if ((r < 60 && g > 150 && b > 200) || (r < 80 && g > 150 && b < 90)) n++;
      }
      return n;
    };
    const on = await renderViewHandler(manager, state, { view: 'top', width: 400, height: 300, project: 'raid' });
    const off = await renderViewHandler(manager, state, { view: 'top', width: 400, height: 300, project: 'raid', markers: false });
    expect(countMarkerPixels(imageOf(on))).toBeGreaterThan(30);
    expect(countMarkerPixels(imageOf(off))).toBe(0);
  });

  it('renders a 500x80x500 city from iso_se within 60 seconds', async () => {
    const p = manager.createProject('city');
    const rand = lcg(12345);
    const t0 = Date.now();
    p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    // fillBox is a thin wrapper over setBlock, so build the ground and the boxes the same way here.
    const fill = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, id: string) => {
      for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) p.setBlock({ x, y, z }, { id });
    };
    fill(0, 0, 0, 499, 0, 499, 'minecraft:grass_block');
    const materials = ['minecraft:stone_bricks', 'minecraft:oak_planks', 'minecraft:bricks', 'minecraft:white_concrete', 'minecraft:spruce_planks'];
    for (let i = 0; i < 200; i++) {
      const w = 5 + Math.floor(rand() * 10);
      const d = 5 + Math.floor(rand() * 10);
      const h = 5 + Math.floor(rand() * 34);
      const x = Math.floor(rand() * (500 - w));
      const z = Math.floor(rand() * (500 - d));
      fill(x, 1, z, x + w - 1, h, z + d - 1, materials[i % materials.length]);
    }
    const bounds = p.getBoundingBox();
    console.log(`[e2e] city built in ${Date.now() - t0} ms: ${p.blockCount} blocks, bounds ${JSON.stringify(bounds)}`);

    const t1 = Date.now();
    const result = await renderViewHandler(manager, state, { view: 'iso_se', project: 'city' });
    const ms = Date.now() - t1;
    console.log(`[e2e] city iso_se render: ${ms} ms`);
    expect(ms).toBeLessThan(60_000);

    const png = imageOf(result);
    const stats = colorStats(decodePng(png));
    expect(stats.distinct).toBeGreaterThan(20);
    expect(stats.dark / stats.total).toBeLessThan(0.9);
    if (process.env.MC_SCHEMA_E2E_OUT) writeFileSync(`${process.env.MC_SCHEMA_E2E_OUT}/e2e-city.png`, png);
  });
});
