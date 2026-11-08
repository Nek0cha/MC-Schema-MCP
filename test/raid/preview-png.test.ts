import { describe, expect, it } from 'vitest';
import { BuildProject } from '../../src/core/build-project.js';
import { fillBox } from '../../src/core/shapes.js';
import type { Marker } from '../../src/core/markers.js';
import { MARKER_COLORS, renderMapPreview } from '../../src/raid/preview-png.js';

const MAP = { id: 'm', name: 'M', size: [20, 8, 20] as [number, number, number], targetVersion: '1.21.1' as const, includeAir: true };
const colorOf = (): [number, number, number] => [100, 100, 100];

function pixel(img: { width: number; rgba: Uint8Array }, x: number, y: number) {
  const i = (y * img.width + x) * 4;
  return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]];
}

describe('renderMapPreview', () => {
  it('draws 2x2 pixels per block, colored by the top block, darker when lower', () => {
    const p = new BuildProject('t');
    fillBox(p, { x: 0, y: 0, z: 0 }, { x: 19, y: 0, z: 19 }, { id: 'minecraft:stone' });
    fillBox(p, { x: 5, y: 1, z: 5 }, { x: 5, y: 5, z: 5 }, { id: 'minecraft:stone' });
    const img = renderMapPreview(p, MAP, [], { colorOf });
    expect(img.width).toBe(40);
    expect(img.height).toBe(40);
    const low = pixel(img, 0, 0);
    const high = pixel(img, 10, 10);
    expect(pixel(img, 11, 11)).toEqual(high);
    expect(high[0]).toBeGreaterThan(low[0]);
    expect(low[0]).toBeLessThan(100);
  });

  it('paints markers in their colors at the cell position', () => {
    const p = new BuildProject('t');
    fillBox(p, { x: 0, y: 0, z: 0 }, { x: 19, y: 0, z: 19 }, { id: 'minecraft:stone' });
    const markers: Marker[] = [
      { kind: 'player_spawn', pos: [3, 1, 3], facing: 0 },
      { kind: 'enemy_spawn', pos: [15, 1, 3], squadSize: [1, 2], tier: 1 },
      { kind: 'loot', pos: [3, 1, 15], type: 'crate', tier: 3 },
      { kind: 'patrol_route', id: 'r', points: [[8, 1, 12], [14, 1, 12]] }
    ];
    const img = renderMapPreview(p, MAP, markers, { colorOf });
    expect(pixel(img, 6, 6)).toEqual(MARKER_COLORS.player_spawn);
    expect(pixel(img, 30, 6)).toEqual(MARKER_COLORS.enemy_spawn);
    expect(pixel(img, 6, 30)).toEqual(MARKER_COLORS.loot[2]);
    expect(pixel(img, 22, 25)).toEqual(MARKER_COLORS.patrol_route);
  });
});
