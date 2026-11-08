import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BuildProject } from '../../src/core/build-project.js';
import { AssetStore } from '../../src/preview/assets/asset-store.js';
import { catalogFromAssets, checkCompat, type BlockCatalog } from '../../src/raid/compat.js';

let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'mc-compat-'));
});
afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

/** A hand-written, minimal blockstates folder (not copied from any Minecraft jar). */
function fixtureAssets(): AssetStore {
  const dir = join(cacheDir, 'assets', '1.21.1', 'blockstates');
  mkdirSync(dir, { recursive: true });
  const files: Record<string, unknown> = {
    'stone.json': { variants: { '': { model: 'block/stone' } } },
    'oak_stairs.json': {
      variants: {
        'facing=east,half=bottom,shape=straight': { model: 'block/oak_stairs' },
        'facing=west,half=top,shape=inner_left': { model: 'block/oak_stairs_inner' }
      }
    },
    'oak_fence.json': {
      multipart: [
        { apply: { model: 'block/oak_fence_post' } },
        { when: { north: 'true' }, apply: { model: 'block/oak_fence_side' } },
        { when: { OR: [{ east: 'true' }, { AND: [{ south: 'true' }, { west: 'true' }] }] }, apply: { model: 'x' } }
      ]
    },
    'oak_slab.json': { variants: { 'type=bottom': { model: 'block/oak_slab' } } }
  };
  for (const [name, json] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(json));
  return new AssetStore({ cacheDir, version: '1.21.1', fetchImpl: (() => {
    throw new Error('no network in tests');
  }) as unknown as typeof fetch });
}

describe('catalogFromAssets', () => {
  it('knows block ids and the property names from variants and multipart', () => {
    const catalog = catalogFromAssets(fixtureAssets());
    expect(catalog.has('minecraft:stone')).toBe(true);
    expect(catalog.has('stone')).toBe(true);
    expect(catalog.has('minecraft:copper_grate')).toBe(false);
    expect([...catalog.propertyNames('minecraft:stone')]).toEqual([]);
    expect([...catalog.propertyNames('minecraft:oak_stairs')].sort()).toEqual(['facing', 'half', 'shape']);
    expect([...catalog.propertyNames('minecraft:oak_fence')].sort()).toEqual(['east', 'north', 'south', 'west']);
    expect([...catalog.propertyNames('minecraft:missing')]).toEqual([]);
  });
});

describe('checkCompat', () => {
  const catalog = (): BlockCatalog => catalogFromAssets(fixtureAssets());

  it('reports ids that do not exist, grouped by id with a count', () => {
    const p = new BuildProject('c');
    p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:copper_grate' });
    p.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:copper_grate' });
    p.setBlock({ x: 2, y: 0, z: 0 }, { id: 'minecraft:copper_grate', properties: { waterlogged: 'true' } });
    p.setBlock({ x: 3, y: 0, z: 0 }, { id: 'minecraft:stone' });
    const issues = checkCompat(p, catalog());
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('minecraft:copper_grate');
    expect(issues[0].message).toContain('3 block(s)');
  });

  it('reports unknown property names once per id and property', () => {
    const p = new BuildProject('c');
    p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:oak_stairs', properties: { facing: 'east', half: 'bottom', bogus: 'x' } });
    p.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:oak_stairs', properties: { facing: 'west', bogus: 'y' } });
    p.setBlock({ x: 2, y: 0, z: 0 }, { id: 'minecraft:oak_stairs', properties: { facing: 'west' } });
    const issues = checkCompat(p, catalog());
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('minecraft:oak_stairs');
    expect(issues[0].message).toContain('"bogus"');
    expect(issues[0].message).toContain('2 block(s)');
  });

  it('does not warn about properties that never affect a model, such as waterlogged', () => {
    const p = new BuildProject('c');
    p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:oak_slab', properties: { type: 'bottom', waterlogged: 'true' } });
    expect(checkCompat(p, catalog())).toEqual([]);
  });

  it('returns nothing for a compatible project', () => {
    const p = new BuildProject('c');
    p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    p.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:oak_fence', properties: { north: 'true', east: 'false' } });
    p.setBlock({ x: 2, y: 0, z: 0 }, { id: 'minecraft:air' });
    expect(checkCompat(p, catalog())).toEqual([]);
  });

  it('returns one "could not check" warning when there is no catalog', () => {
    const p = new BuildProject('c');
    p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    const issues = checkCompat(p, null);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/could not|unable|not check/i);
  });
});
