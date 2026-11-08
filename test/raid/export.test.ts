import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decode } from '@enginehub/nbt-ts';
import { afterEach, describe, expect, it } from 'vitest';
import { BuildProject } from '../../src/core/build-project.js';
import { fillBox } from '../../src/core/shapes.js';
import { exportRaidMap } from '../../src/raid/export.js';

const colorOf = (): [number, number, number] => [120, 120, 120];
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'mc-export-'));
  dirs.push(d);
  return d;
};

function project(size: [number, number, number] = [100, 8, 60]) {
  const p = new BuildProject('t');
  p.mapSettings = { id: 'town', name: 'Town', size, targetVersion: '1.21.1', includeAir: true };
  fillBox(p, { x: 0, y: 0, z: 0 }, { x: size[0] - 1, y: 0, z: size[2] - 1 }, { id: 'minecraft:stone' });
  p.addMarkers([
    { kind: 'player_spawn', pos: [10, 1, 10], facing: 90 },
    { kind: 'extract', id: 'north_gate', pos: [50, 1, 5], radius: 4 },
    { kind: 'loot', pos: [20, 1, 20], type: 'crate', tier: 2 },
    { kind: 'enemy_spawn', pos: [30, 1, 30], squadSize: [2, 4], tier: 2 },
    { kind: 'patrol_route', id: 'route_a', points: [[30, 1, 30], [40, 1, 30], [40, 1, 40]] }
  ]);
  return p;
}

describe('exportRaidMap', () => {
  it('writes map.json, tiles, preview and validation files', () => {
    const out = tmp();
    const { report } = exportRaidMap(project(), { outputDir: out, catalog: null, colorOf });
    expect(readdirSync(out).sort()).toEqual(['map.json', 'preview-legend.txt', 'preview.png', 'tiles', 'validation.json']);
    expect(readdirSync(join(out, 'tiles')).sort()).toEqual([
      'tile_0_0.nbt',
      'tile_0_1.nbt',
      'tile_1_0.nbt',
      'tile_1_1.nbt',
      'tile_2_0.nbt',
      'tile_2_1.nbt'
    ]);
    const tile = decode(gunzipSync(readFileSync(join(out, 'tiles', 'tile_2_1.nbt')))).value as { size: { value: number }[] };
    expect(tile.size.map((n) => n.value)).toEqual([4, 8, 12]);
    expect(JSON.parse(readFileSync(join(out, 'validation.json'), 'utf8')).stats.tiles).toBe(6);
    expect(report.errors.filter((e) => e.check === 6 || e.check === 7)).toEqual([]);
  });

  it('writes map.json in the spec shape and key order', () => {
    const out = tmp();
    exportRaidMap(project(), { outputDir: out, catalog: null, colorOf });
    const json = JSON.parse(readFileSync(join(out, 'map.json'), 'utf8'));
    expect(Object.keys(json)).toEqual([
      'id', 'name', 'size', 'tile_size', 'player_spawns', 'extracts', 'loot', 'enemy_spawns', 'patrol_routes'
    ]);
    expect(json).toEqual({
      id: 'town',
      name: 'Town',
      size: [100, 8, 60],
      tile_size: 48,
      player_spawns: [{ pos: [10, 1, 10], facing: 90 }],
      extracts: [{ id: 'north_gate', pos: [50, 1, 5], radius: 4 }],
      loot: [{ pos: [20, 1, 20], type: 'crate', tier: 2 }],
      enemy_spawns: [{ pos: [30, 1, 30], squad_size: [2, 4], tier: 2 }],
      patrol_routes: [{ id: 'route_a', points: [[30, 1, 30], [40, 1, 30], [40, 1, 40]] }]
    });
    expect(Object.keys(json.player_spawns[0])).toEqual(['pos', 'facing']);
    expect(Object.keys(json.enemy_spawns[0])).toEqual(['pos', 'squad_size', 'tier']);
  });

  it('deletes only old tile_*.nbt files', () => {
    const out = tmp();
    mkdirSync(join(out, 'tiles'), { recursive: true });
    writeFileSync(join(out, 'tiles', 'tile_9_9.nbt'), 'old');
    writeFileSync(join(out, 'tiles', 'keep.txt'), 'keep');
    exportRaidMap(project(), { outputDir: out, catalog: null, colorOf });
    expect(existsSync(join(out, 'tiles', 'tile_9_9.nbt'))).toBe(false);
    expect(existsSync(join(out, 'tiles', 'keep.txt'))).toBe(true);
  });

  it('still writes everything when the validation finds errors', () => {
    const out = tmp();
    const p = project();
    p.addMarkers([{ kind: 'player_spawn', pos: [10, 50, 10], facing: 0 }]);
    const { report } = exportRaidMap(p, { outputDir: out, catalog: null, colorOf });
    expect(report.ok).toBe(false);
    expect(existsSync(join(out, 'map.json'))).toBe(true);
    expect(existsSync(join(out, 'preview.png'))).toBe(true);
    expect(JSON.parse(readFileSync(join(out, 'validation.json'), 'utf8')).ok).toBe(false);
  });

  it('reports a preview write failure as check 7 without stopping', () => {
    const out = tmp();
    mkdirSync(join(out, 'preview.png'), { recursive: true }); // a directory blocks the file
    const { report } = exportRaidMap(project(), { outputDir: out, catalog: null, colorOf });
    expect(report.errors.some((e) => e.check === 7)).toBe(true);
    expect(existsSync(join(out, 'map.json'))).toBe(true);
  });

  it('throws when the project has no map settings', () => {
    const p = new BuildProject('t');
    expect(() => exportRaidMap(p, { outputDir: tmp(), catalog: null, colorOf })).toThrow(/setMapSettings/);
  });
});
