import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BuildProject } from '../../src/core/build-project.js';
import type { Marker } from '../../src/core/markers.js';
import { fillBox } from '../../src/core/shapes.js';
import { makeColorOf } from '../../src/raid/colors.js';
import { exportRaidMap } from '../../src/raid/export.js';
import { validateRaidMap } from '../../src/raid/validate.js';

const SIZE: [number, number, number] = [480, 80, 480];
const GROUND_Y = 16; // top of the ground; feet stand at GROUND_Y + 1
const FEET_Y = GROUND_Y + 1;
const PITCH = 24; // one building per 24x24 cell, 8-wide streets between them

/** Deterministic pseudo random numbers so every run builds the same town. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function buildTown(): { project: BuildProject; markers: Marker[]; buildings: number } {
  const project = new BuildProject('perf-town');
  const [sx, sy, sz] = SIZE;
  project.mapSettings = { id: 'perf_town', name: 'Perf Town', size: SIZE, targetVersion: '1.21.1', includeAir: true };
  fillBox(project, { x: 0, y: 0, z: 0 }, { x: sx - 1, y: GROUND_Y - 1, z: sz - 1 }, { id: 'minecraft:stone' });
  fillBox(project, { x: 0, y: GROUND_Y, z: 0 }, { x: sx - 1, y: GROUND_Y, z: sz - 1 }, { id: 'minecraft:grass_block' });

  const wall = { id: 'minecraft:stone_bricks' };
  const top = FEET_Y + 4;
  fillBox(project, { x: 0, y: FEET_Y, z: 0 }, { x: sx - 1, y: top, z: 0 }, wall);
  fillBox(project, { x: 0, y: FEET_Y, z: sz - 1 }, { x: sx - 1, y: top, z: sz - 1 }, wall);
  fillBox(project, { x: 0, y: FEET_Y, z: 0 }, { x: 0, y: top, z: sz - 1 }, wall);
  fillBox(project, { x: sx - 1, y: FEET_Y, z: 0 }, { x: sx - 1, y: top, z: sz - 1 }, wall);

  const rand = lcg(2024);
  const materials = ['minecraft:bricks', 'minecraft:oak_planks', 'minecraft:white_concrete', 'minecraft:spruce_planks'];
  const cells = sx / PITCH;
  let buildings = 0;
  for (let cx = 0; cx < cells; cx++) {
    for (let cz = 0; cz < cells; cz++) {
      if (rand() < 0.25) continue; // open lots keep the town from looking like a grid
      const w = 8 + Math.floor(rand() * 8);
      const d = 8 + Math.floor(rand() * 8);
      const h = 4 + Math.floor(rand() * 28);
      const x = cx * PITCH + 4;
      const z = cz * PITCH + 4;
      fillBox(project, { x, y: FEET_Y, z }, { x: x + w - 1, y: FEET_Y + h - 1, z: z + d - 1 }, { id: materials[buildings % materials.length] });
      buildings++;
    }
  }

  // Streets run along the cell borders (x or z within 0..3 of a multiple of PITCH, 20..23 on the other side).
  const street = (i: number) => i * PITCH + 2;
  const markers: Marker[] = [];
  for (const [i, j] of [[3, 3], [10, 3], [16, 3], [3, 16], [10, 16], [17, 17]]) {
    markers.push({ kind: 'player_spawn', pos: [street(i), FEET_Y, street(j)], facing: 90 });
  }
  for (const [i, j] of [[10, 10], [5, 10], [15, 10], [10, 18]]) {
    markers.push({ kind: 'extract', id: `gate_${i}_${j}`, pos: [street(i), FEET_Y, street(j)], radius: 4 });
  }
  markers.push({ kind: 'enemy_spawn', pos: [street(8), FEET_Y, street(8)], squadSize: [2, 4], tier: 3 });
  markers.push({ kind: 'loot', pos: [street(8) + 2, FEET_Y, street(8)], type: 'crate', tier: 3 });
  markers.push({
    kind: 'patrol_route',
    id: 'loop',
    points: [
      [street(6), FEET_Y, street(6)],
      [street(14), FEET_Y, street(6)],
      [street(14), FEET_Y, street(14)],
      [street(6), FEET_Y, street(14)]
    ]
  });
  project.addMarkers(markers);
  return { project, markers, buildings };
}

describe(`raid export performance (${SIZE.join('x')})`, () => {
  const out = mkdtempSync(join(tmpdir(), 'mc-raid-perf-'));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  const t0 = performance.now();
  const town = buildTown();
  const buildMs = performance.now() - t0;

  it('builds a town with about 300 buildings', () => {
    console.log(`town: ${town.buildings} buildings, ${town.project.blockCount} blocks, built in ${buildMs.toFixed(0)} ms`);
    expect(town.buildings).toBeGreaterThan(250);
    expect(town.buildings).toBeLessThan(350);
  });

  it('validates within 30s', () => {
    const t = performance.now();
    const report = validateRaidMap(town.project, town.project.mapSettings!, town.markers);
    const ms = performance.now() - t;
    console.log(
      `validation: ${ms.toFixed(0)} ms, ${report.errors.length} errors, ${report.warnings.length} warnings` +
        (report.errors.length > 0 ? `\n${report.errors.slice(0, 5).map((e) => e.message).join('\n')}` : '')
    );
    expect(ms).toBeLessThan(30_000);
    expect(report.errors).toEqual([]);
  });

  it('exports everything within 60s', () => {
    const t = performance.now();
    const { report } = exportRaidMap(town.project, { outputDir: out, catalog: null, colorOf: makeColorOf(null) });
    const ms = performance.now() - t;
    const tiles = readdirSync(join(out, 'tiles')).length;
    console.log(`export: ${ms.toFixed(0)} ms, ${tiles} tiles, ${report.errors.length} errors, ${report.warnings.length} warnings`);
    expect(tiles).toBe(100);
    expect(ms).toBeLessThan(60_000);
  });
}, 180_000);
