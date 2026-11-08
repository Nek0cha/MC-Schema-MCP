import { describe, expect, it } from 'vitest';
import { BuildProject } from '../../src/core/build-project.js';
import type { Marker } from '../../src/core/markers.js';
import { copyRegion } from '../../src/core/region-ops.js';
import { transformMarker } from '../../src/core/marker-ops.js';

const extract = (id: string): Marker => ({ kind: 'extract', id, pos: [1, 2, 3], radius: 4 });
const route = (id: string): Marker => ({
  kind: 'patrol_route',
  id,
  points: [
    [0, 1, 0],
    [5, 1, 0]
  ]
});
const loot = (pos: [number, number, number]): Marker => ({ kind: 'loot', pos, type: 'crate', tier: 2 });

describe('BuildProject markers', () => {
  it('adds markers with sequential internal ids', () => {
    const p = new BuildProject('m');
    expect(p.addMarkers([loot([1, 1, 1]), extract('e1')])).toEqual(['m1', 'm2']);
    expect(p.addMarkers([loot([2, 1, 1])])).toEqual(['m3']);
    expect(p.getMarkers().map((m) => m.markerId)).toEqual(['m1', 'm2', 'm3']);
    expect(p.getMarkers()[1]).toMatchObject({ kind: 'extract', id: 'e1', markerId: 'm2' });
  });

  it('removes markers by internal id and never reuses ids', () => {
    const p = new BuildProject('m');
    p.addMarkers([loot([1, 1, 1]), loot([2, 1, 1]), loot([3, 1, 1])]);
    expect(p.removeMarkers(['m2', 'nope'])).toBe(1);
    expect(p.getMarkers().map((m) => m.markerId)).toEqual(['m1', 'm3']);
    expect(p.addMarkers([loot([4, 1, 1])])).toEqual(['m4']);
  });

  it('rejects duplicate extract ids and patrol route ids, adding nothing', () => {
    const p = new BuildProject('m');
    p.addMarkers([extract('e1'), route('r1')]);
    expect(() => p.addMarkers([loot([1, 1, 1]), extract('e1')])).toThrow(/e1/);
    expect(() => p.addMarkers([route('r1')])).toThrow(/r1/);
    expect(() => p.addMarkers([extract('e2'), extract('e2')])).toThrow(/e2/);
    expect(p.getMarkers()).toHaveLength(2);
    // An extract and a patrol route may share an id: uniqueness is per kind.
    expect(() => p.addMarkers([extract('r1')])).not.toThrow();
  });

  it('tracks markersDirty', () => {
    const p = new BuildProject('m');
    expect(p.markersDirty).toBe(false);
    p.addMarkers([loot([1, 1, 1])]);
    expect(p.markersDirty).toBe(true);
    p.clearMarkersDirty();
    expect(p.markersDirty).toBe(false);
    p.removeMarkers(['zzz']);
    expect(p.markersDirty).toBe(false);
    p.removeMarkers(['m1']);
    expect(p.markersDirty).toBe(true);
  });

  it('does not copy markers when a region is copied', () => {
    const p = new BuildProject('m');
    p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    p.addMarkers([loot([0, 1, 0])]);
    copyRegion(p, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 5, y: 0, z: 5 });
    expect(p.getMarkers()).toHaveLength(1);
  });
});

describe('transformMarker', () => {
  const toWorld = (o: [number, number, number]): [number, number, number] => [10 + o[0], 5 + o[1], 20 + o[2]];

  it('translates without rotation', () => {
    const m = transformMarker({ kind: 'loot', pos: [2, 1, -1], type: 'safe', tier: 3 }, toWorld, {});
    expect(m).toEqual({ kind: 'loot', pos: [12, 6, 19], type: 'safe', tier: 3 });
  });

  it('rotates the offset 90 degrees like transformOffset does', () => {
    // (x, z) -> (-z, x) for 90 degrees clockwise seen from above, as the block placement uses.
    const m = transformMarker(
      { kind: 'enemy_spawn', pos: [2, 0, 1], squadSize: [1, 3], tier: 1 },
      toWorld,
      { rotate: 90 }
    );
    expect(m).toEqual({ kind: 'enemy_spawn', pos: [9, 5, 22], squadSize: [1, 3], tier: 1 });
  });
});
