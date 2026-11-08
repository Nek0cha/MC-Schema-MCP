import { describe, expect, it } from 'vitest';
import { BuildProject } from '../../src/core/build-project.js';
import { fillBox } from '../../src/core/shapes.js';
import type { MapSettings, Marker, Pos } from '../../src/core/markers.js';
import { formatReport, validateRaidMap, type ValidationReport } from '../../src/raid/validate.js';

const STONE = { id: 'minecraft:stone' };

const MAP: MapSettings = { id: 'm', name: 'M', size: [192, 8, 192], targetVersion: '1.21.1', includeAir: true };

/** Flat 192x192 stone floor at y=0 with a 3-high perimeter wall; standing level is y=1. */
function arena(): BuildProject {
  const p = new BuildProject('t');
  fillBox(p, { x: 0, y: 0, z: 0 }, { x: 191, y: 0, z: 191 }, STONE);
  for (const [a, b] of [
    [{ x: 0, y: 1, z: 0 }, { x: 191, y: 3, z: 0 }],
    [{ x: 0, y: 1, z: 191 }, { x: 191, y: 3, z: 191 }],
    [{ x: 0, y: 1, z: 0 }, { x: 0, y: 3, z: 191 }],
    [{ x: 191, y: 1, z: 0 }, { x: 191, y: 3, z: 191 }]
  ]) {
    fillBox(p, a, b, STONE);
  }
  return p;
}

/** A marker set that satisfies every check on the arena. */
function goodMarkers(): Marker[] {
  const spawns: Pos[] = [[10, 1, 10], [90, 1, 10], [170, 1, 10], [10, 1, 170], [90, 1, 170], [170, 1, 170]];
  return [
    ...spawns.map((pos) => ({ kind: 'player_spawn' as const, pos, facing: 0 })),
    { kind: 'extract', id: 'n', pos: [96, 1, 2], radius: 4 },
    { kind: 'extract', id: 's', pos: [96, 1, 189], radius: 4 },
    { kind: 'extract', id: 'e', pos: [189, 1, 96], radius: 4 },
    { kind: 'extract', id: 'w', pos: [2, 1, 96], radius: 4 },
    { kind: 'loot', pos: [100, 1, 100], type: 'safe', tier: 3 },
    { kind: 'enemy_spawn', pos: [110, 1, 100], squadSize: [2, 3], tier: 3 },
    { kind: 'patrol_route', id: 'r', points: [[50, 1, 50], [60, 1, 50], [60, 1, 60]] }
  ];
}

const checks = (issues: { check: number }[]) => [...new Set(issues.map((i) => i.check))].sort((a, b) => a - b);

function run(p: BuildProject, markers: Marker[], map: MapSettings = MAP): ValidationReport {
  return validateRaidMap(p, map, markers, {
    tiles: { expected: ['tile_0_0.nbt'], written: ['tile_0_0.nbt'] },
    previewWritten: true,
    compat: []
  });
}

describe('validateRaidMap', () => {
  it('passes a well-formed map', () => {
    const r = run(arena(), goodMarkers());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.stats.markers).toMatchObject({ player_spawn: 6, extract: 4, loot: 1, enemy_spawn: 1, patrol_route: 1 });
  });

  it('check 1: flags markers and blocks outside the map', () => {
    const p = arena();
    p.setBlock({ x: 300, y: 1, z: 1 }, STONE);
    const r = run(p, [...goodMarkers(), { kind: 'loot', pos: [500, 1, 1], type: 'crate', tier: 1 }]);
    expect(r.errors.some((e) => e.check === 1 && /loot/.test(e.message))).toBe(true);
    expect(r.warnings.some((w) => w.check === 1 && /outside/.test(w.message))).toBe(true);
  });

  it('check 2: flags points that are not standable', () => {
    const r = run(arena(), [...goodMarkers(), { kind: 'enemy_spawn', pos: [40, 3, 40], squadSize: [1, 2], tier: 1 }]);
    expect(r.errors.find((e) => e.check === 2)?.at).toEqual([40, 3, 40]);
  });

  it('check 3: reports an unreachable extract with the nearest reachable cell', () => {
    const p = arena();
    // wall off the east extract
    fillBox(p, { x: 180, y: 1, z: 1 }, { x: 180, y: 3, z: 190 }, STONE);
    const r = run(p, goodMarkers().filter((m) => !(m.kind === 'player_spawn' && m.pos[0] === 170)));
    const err = r.errors.find((e) => e.check === 3)!;
    expect(err.message).toMatch(/extract "e"/);
    expect(err.message).toMatch(/nearest/);
    expect(err.at?.[0]).toBe(179);
  });

  it('check 4: errors on a broken patrol leg and warns on a 1-wide one', () => {
    const p = arena();
    fillBox(p, { x: 55, y: 1, z: 1 }, { x: 55, y: 3, z: 190 }, STONE);
    expect(run(p, goodMarkers()).errors.some((e) => e.check === 4)).toBe(true);
    // open a 1-wide gap: reachable, but not wide
    fillBox(p, { x: 55, y: 1, z: 50 }, { x: 55, y: 2, z: 50 }, { id: 'minecraft:air' });
    const r = run(p, goodMarkers());
    expect(r.errors.some((e) => e.check === 4)).toBe(false);
    expect(r.warnings.some((w) => w.check === 4)).toBe(true);
  });

  it('check 5: loot must be air, unset or a barrel', () => {
    const p = arena();
    p.setBlock({ x: 100, y: 1, z: 100 }, { id: 'minecraft:barrel', properties: { facing: 'up' } });
    expect(run(p, goodMarkers()).errors.some((e) => e.check === 5)).toBe(false);
    p.setBlock({ x: 100, y: 1, z: 100 }, { id: 'minecraft:chest' });
    expect(run(p, goodMarkers()).errors.find((e) => e.check === 5)?.at).toEqual([100, 1, 100]);
  });

  it('checks 6 and 7 come from the export step; a non-multiple-of-48 size is a warning', () => {
    const r = validateRaidMap(arena(), { ...MAP, size: [200, 8, 192] }, goodMarkers(), {
      tiles: { expected: ['tile_0_0.nbt', 'tile_1_0.nbt'], written: ['tile_0_0.nbt'] },
      previewWritten: false
    });
    expect(checks(r.errors)).toEqual(expect.arrayContaining([6, 7]));
    expect(r.warnings.some((w) => w.check === 6 && /48/.test(w.message))).toBe(true);
  });

  it('check 8 and 9: counts and spacing of spawns and extracts', () => {
    const markers = goodMarkers().filter((m) => m.kind !== 'extract' || m.id !== 'w');
    markers.push({ kind: 'player_spawn', pos: [20, 1, 20], facing: 0 }); // too close to (10,1,10)
    const r = run(arena(), markers);
    expect(checks(r.warnings)).toEqual(expect.arrayContaining([8, 9]));
    expect(r.warnings.find((w) => w.check === 8)!.message).toMatch(/60/);
  });

  it('check 10: tier 3 loot needs a tier 3 squad within 32 blocks', () => {
    const markers = goodMarkers().map((m) => (m.kind === 'enemy_spawn' ? { ...m, pos: [150, 1, 150] as Pos } : m));
    expect(run(arena(), markers).warnings.find((w) => w.check === 10)?.at).toEqual([100, 1, 100]);
  });

  it('check 11: warns when players can walk onto the map edge', () => {
    const p = arena();
    fillBox(p, { x: 96, y: 1, z: 0 }, { x: 97, y: 2, z: 0 }, { id: 'minecraft:air' });
    expect(run(p, goodMarkers()).warnings.some((w) => w.check === 11)).toBe(true);
  });

  it('check 12 passes compat warnings through, check 13 reports isolated panes', () => {
    const p = arena();
    p.setBlock({ x: 30, y: 1, z: 30 }, { id: 'minecraft:glass_pane' });
    const r = validateRaidMap(p, MAP, goodMarkers(), { compat: [{ message: 'minecraft:copper_bars does not exist in 1.21.1 (4 blocks)' }] });
    expect(checks(r.warnings)).toEqual(expect.arrayContaining([12, 13]));
  });

  it('formats a short summary', () => {
    expect(formatReport(run(arena(), goodMarkers()))).toMatch(/^OK/);
    const p = arena();
    p.setBlock({ x: 100, y: 1, z: 100 }, STONE);
    expect(formatReport(run(p, goodMarkers()))).toMatch(/^1 error\(s\), \d+ warning\(s\)/);
  });
});
