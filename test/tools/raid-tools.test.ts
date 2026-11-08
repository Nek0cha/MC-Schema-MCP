import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ProjectManager } from '../../src/core/project-manager.js';
import { buildToolDefs } from '../../src/tools/registry.js';
import {
  addMarkersHandler,
  listMarkersHandler,
  removeMarkersHandler,
  setMapSettingsHandler
} from '../../src/tools/raid-tools.js';

function setup() {
  const manager = new ProjectManager();
  manager.createProject('raid');
  return manager;
}

describe('raid tool handlers', () => {
  it('setMapSettings stores the settings with defaults', () => {
    const manager = setup();
    const result = setMapSettingsHandler(manager, { id: 'ruined_town', name: 'Ruined Town', size: [96, 80, 96] });
    expect(manager.getActive().mapSettings).toEqual({
      id: 'ruined_town',
      name: 'Ruined Town',
      size: [96, 80, 96],
      targetVersion: '1.21.1',
      includeAir: true
    });
    expect(result.content[0].text).toContain('ruined_town');
  });

  it('addMarkers returns internal ids; listMarkers groups by kind and filters', () => {
    const manager = setup();
    const added = addMarkersHandler(manager, {
      markers: [
        { kind: 'player_spawn', pos: [1, 1, 1], facing: 0 },
        { kind: 'loot', pos: [2, 1, 2], type: 'crate', tier: 1 },
        { kind: 'loot', pos: [3, 1, 2], type: 'safe', tier: 3 }
      ]
    });
    expect(added.content[0].text).toContain('m1, m2, m3');
    const all = listMarkersHandler(manager, {}).content[0].text;
    expect(all).toContain('player_spawn (1)');
    expect(all).toContain('loot (2)');
    expect(all).toContain('m3');
    const only = listMarkersHandler(manager, { kind: 'loot' }).content[0].text;
    expect(only).toContain('loot (2)');
    expect(only).not.toContain('player_spawn');
    expect(listMarkersHandler(setup(), {}).content[0].text).toBe('(no markers yet)');
  });

  it('addMarkers throws on a duplicate id and adds nothing', () => {
    const manager = setup();
    expect(() =>
      addMarkersHandler(manager, {
        markers: [
          { kind: 'loot', pos: [2, 1, 2], type: 'crate', tier: 1 },
          { kind: 'extract', id: 'e', pos: [1, 1, 1], radius: 4 },
          { kind: 'extract', id: 'e', pos: [9, 1, 1], radius: 4 }
        ]
      })
    ).toThrow(/"e"/);
    expect(manager.getActive().getMarkers()).toHaveLength(0);
  });

  it('removeMarkers reports the removed count and unknown ids', () => {
    const manager = setup();
    addMarkersHandler(manager, { markers: [{ kind: 'loot', pos: [2, 1, 2], type: 'crate', tier: 1 }] });
    const text = removeMarkersHandler(manager, { ids: ['m1', 'm9'] }).content[0].text;
    expect(text).toContain('Removed 1');
    expect(text).toContain('m9');
    expect(manager.getActive().getMarkers()).toHaveLength(0);
  });
});

describe('raid tool registration', () => {
  const defs = buildToolDefs();
  const def = (name: string) => {
    const found = defs.find((d) => d.name === name);
    if (!found) throw new Error(`tool ${name} is not registered`);
    return found;
  };

  it('registers the four tools with the right flags', () => {
    expect(def('setMapSettings')).toMatchObject({ mutating: true, batchable: false });
    expect(def('addMarkers')).toMatchObject({ mutating: true, batchable: true });
    expect(def('removeMarkers')).toMatchObject({ mutating: true, batchable: true });
    expect(def('listMarkers')).toMatchObject({ mutating: false, batchable: false });
  });

  it('validates marker input', () => {
    const schema = z.object(def('addMarkers').inputShape());
    const ok = schema.safeParse({ markers: [{ kind: 'extract', id: 'e1', pos: [1, 1, 1] }] });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.markers[0]).toMatchObject({ radius: 4 });
    const bad = (marker: unknown) => schema.safeParse({ markers: [marker] }).success;
    expect(bad({ kind: 'loot', pos: [1, 1, 1], type: 'crate', tier: 4 })).toBe(false);
    expect(bad({ kind: 'enemy_spawn', pos: [1, 1, 1], squadSize: [3, 2], tier: 1 })).toBe(false);
    expect(bad({ kind: 'enemy_spawn', pos: [1, 1, 1], squadSize: [0, 2], tier: 1 })).toBe(false);
    expect(bad({ kind: 'enemy_spawn', pos: [1, 1, 1], squadSize: [1, 2], tier: 1 })).toBe(true);
    expect(bad({ kind: 'patrol_route', id: 'r', points: [[1, 1, 1]] })).toBe(false);
    expect(bad({ kind: 'patrol_route', id: 'r', points: [[1, 1, 1], [2, 1, 1]] })).toBe(true);
    expect(bad({ kind: 'nope', pos: [1, 1, 1] })).toBe(false);
  });
});
