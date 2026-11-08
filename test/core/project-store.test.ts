import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildProject } from '../../src/core/build-project.js';
import {
  listStoredProjects,
  loadProject,
  moveProjectToTrash,
  projectDir,
  saveProject
} from '../../src/core/project-store.js';
import { fillBox } from '../../src/core/shapes.js';

describe('project-store', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mc-store-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('round-trips a project through disk', () => {
    const p = new BuildProject('town');
    fillBox(p, { x: -20, y: -3, z: -20 }, { x: 20, y: 5, z: 20 }, { id: 'minecraft:stone' });
    p.setBlock({ x: 0, y: 6, z: 0 }, { id: 'minecraft:oak_stairs', properties: { facing: 'east', half: 'bottom' } });
    p.setBlock({ x: 1, y: 6, z: 0 }, { id: 'minecraft:air' });
    saveProject(root, p);
    expect(p.getDirtyChunkKeys()).toEqual([]);
    const q = loadProject(root, 'town');
    expect(q.blockCount).toBe(p.blockCount);
    expect(q.getBlockCounts()).toEqual(p.getBlockCounts());
    expect(q.getBoundingBox()).toEqual(p.getBoundingBox());
    expect(q.getBlock({ x: -20, y: -3, z: -20 })).toEqual({ id: 'minecraft:stone' });
    expect(q.getBlock({ x: 1, y: 6, z: 0 })).toEqual({ id: 'minecraft:air' });
    expect(q.getBlock({ x: 0, y: 6, z: 0 })).toEqual({
      id: 'minecraft:oak_stairs',
      properties: { facing: 'east', half: 'bottom' }
    });
  });

  it('writes only dirty chunks on subsequent saves', () => {
    const p = new BuildProject('p');
    fillBox(p, { x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 40 }, { id: 'minecraft:stone' });
    saveProject(root, p);
    const chunksDir = join(projectDir(root, 'p'), 'chunks');
    const names = readdirSync(chunksDir).sort();
    expect(names.length).toBe(9);
    const mtimes = new Map(names.map((f) => [f, statSync(join(chunksDir, f)).mtimeMs]));

    // Make the check robust against coarse filesystem timestamps.
    const old = new Date(Date.now() - 60_000);
    for (const f of names) utimesSync(join(chunksDir, f), old, old);

    p.setBlock({ x: 1, y: 0, z: 1 }, { id: 'minecraft:dirt' });
    expect(p.getDirtyChunkKeys()).toEqual(['0,0,0']);
    saveProject(root, p);

    for (const f of names) {
      const m = statSync(join(chunksDir, f)).mtimeMs;
      if (f === '0_0_0.bin') expect(m).toBeGreaterThan(old.getTime() + 1000);
      else expect(m).toBeCloseTo(old.getTime(), -2);
    }
    expect(mtimes.size).toBe(9);
    expect(readdirSync(chunksDir).sort()).toEqual(names);
    expect(loadProject(root, 'p').getBlock({ x: 1, y: 0, z: 1 })).toEqual({ id: 'minecraft:dirt' });
  });

  it('deletes the file of a chunk that became empty', () => {
    const p = new BuildProject('p');
    p.setBlock({ x: 20, y: 0, z: 0 }, { id: 'minecraft:stone' });
    saveProject(root, p);
    expect(existsSync(join(projectDir(root, 'p'), 'chunks', '1_0_0.bin'))).toBe(true);
    p.removeBlock({ x: 20, y: 0, z: 0 });
    saveProject(root, p);
    expect(existsSync(join(projectDir(root, 'p'), 'chunks', '1_0_0.bin'))).toBe(false);
    expect(loadProject(root, 'p').blockCount).toBe(0);
  });

  it('lists stored projects but not trash or stray folders', () => {
    saveProject(root, new BuildProject('a'));
    saveProject(root, new BuildProject('b'));
    mkdirSync(join(root, 'stray'));
    moveProjectToTrash(root, 'b');
    expect(listStoredProjects(root).sort()).toEqual(['a']);
    expect(listStoredProjects(join(root, 'missing'))).toEqual([]);
  });

  it('moves to a unique trash folder each time', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234567890);
    saveProject(root, new BuildProject('x'));
    const first = moveProjectToTrash(root, 'x');
    saveProject(root, new BuildProject('x'));
    const second = moveProjectToTrash(root, 'x');
    expect(first).not.toBe(second);
    expect(existsSync(first)).toBe(true);
    expect(existsSync(second)).toBe(true);
    expect(first.startsWith(resolve(root, '.trash'))).toBe(true);
    expect(second.startsWith(resolve(root, '.trash'))).toBe(true);
    expect(existsSync(projectDir(root, 'x'))).toBe(false);
  });

  it('reports the directory when project.json is corrupt or has an unknown formatVersion', () => {
    saveProject(root, new BuildProject('town'));
    const json = join(projectDir(root, 'town'), 'project.json');
    writeFileSync(json, '{not json');
    let message = '';
    try {
      loadProject(root, 'town');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(resolve(projectDir(root, 'town')));
    writeFileSync(json, JSON.stringify({ formatVersion: 99, name: 'town', palette: [null] }));
    expect(() => loadProject(root, 'town')).toThrow(/formatVersion/);
  });

  it('reports a corrupt chunk file', () => {
    const p = new BuildProject('c');
    p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    saveProject(root, p);
    writeFileSync(join(projectDir(root, 'c'), 'chunks', '0_0_0.bin'), 'garbage');
    expect(() => loadProject(root, 'c')).toThrow(/0_0_0\.bin/);
  });

  it('preserves createdAt across saves and updates updatedAt', async () => {
    const p = new BuildProject('p');
    saveProject(root, p);
    const read = () => JSON.parse(readFileSync(join(projectDir(root, 'p'), 'project.json'), 'utf8'));
    const first = read();
    await new Promise((r) => setTimeout(r, 5));
    p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    saveProject(root, p);
    const second = read();
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).not.toBe(first.updatedAt);
    expect(second.palette[0]).toBeNull();
    expect(second.formatVersion).toBe(1);
  });

  describe('map settings and markers', () => {
    const settings = {
      id: 'ruined_town',
      name: 'Ruined Town',
      size: [96, 80, 96] as [number, number, number],
      targetVersion: '1.21.1' as const,
      includeAir: true
    };

    it('round-trips map settings and markers', () => {
      const p = new BuildProject('raid');
      p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
      p.mapSettings = settings;
      p.addMarkers([
        { kind: 'player_spawn', pos: [1, 1, 1], facing: 90 },
        { kind: 'extract', id: 'e1', pos: [5, 1, 5], radius: 4 },
        { kind: 'patrol_route', id: 'r1', points: [[1, 1, 1], [9, 1, 1]] }
      ]);
      saveProject(root, p);
      expect(p.markersDirty).toBe(false);
      const q = loadProject(root, 'raid');
      expect(q.mapSettings).toEqual(settings);
      expect(q.getMarkers()).toEqual(p.getMarkers());
      // Ids keep counting after a reload.
      expect(q.addMarkers([{ kind: 'loot', pos: [2, 1, 2], type: 'crate', tier: 1 }])).toEqual(['m4']);
    });

    it('loads old projects that have neither map nor markers.json', () => {
      const p = new BuildProject('old');
      p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
      saveProject(root, p);
      expect(existsSync(join(projectDir(root, 'old'), 'markers.json'))).toBe(false);
      const q = loadProject(root, 'old');
      expect(q.mapSettings).toBeNull();
      expect(q.getMarkers()).toEqual([]);
      expect(q.blockCount).toBe(1);
    });

    it('writes markers.json only when markers changed', () => {
      const p = new BuildProject('lazy');
      p.addMarkers([{ kind: 'player_spawn', pos: [1, 1, 1], facing: 0 }]);
      saveProject(root, p);
      const file = join(projectDir(root, 'lazy'), 'markers.json');
      const old = new Date(Date.now() - 60_000);
      utimesSync(file, old, old);
      p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
      saveProject(root, p);
      expect(statSync(file).mtimeMs).toBeCloseTo(old.getTime(), -2);
      p.removeMarkers(['m1']);
      saveProject(root, p);
      expect(loadProject(root, 'lazy').getMarkers()).toEqual([]);
    });

    it('rejects a markers.json with an unsupported formatVersion', () => {
      const p = new BuildProject('bad');
      p.addMarkers([{ kind: 'player_spawn', pos: [1, 1, 1], facing: 0 }]);
      saveProject(root, p);
      writeFileSync(
        join(projectDir(root, 'bad'), 'markers.json'),
        JSON.stringify({ formatVersion: 99, nextId: 2, markers: [] })
      );
      expect(() => loadProject(root, 'bad')).toThrow(/markers.json/);
    });
  });
});
