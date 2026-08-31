import { describe, expect, it } from 'vitest';
import { decode, type TagMap } from '@enginehub/nbt-ts';
import { loadSchematic } from '@enginehub/schematicjs';
import { gunzipSync } from 'node:zlib';
import { BuildProject } from '../../src/core/build-project.js';
import { writeSchematic } from '../../src/schematic/writer.js';

/**
 * The schematicjs reader strips the "minecraft:" namespace when parsing
 * palette keys (see writer.ts comments). Mirror that here so round-trip
 * assertions compare like with like.
 */
function stripNamespace(id: string): string {
  const colonIndex = id.indexOf(':');
  return colonIndex === -1 ? id : id.slice(colonIndex + 1);
}

describe('writeSchematic', () => {
  it('round-trips a small build through the schematicjs reader', () => {
    const project = new BuildProject('roundtrip-test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    project.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:oak_planks' });
    project.setBlock({ x: 0, y: 1, z: 0 }, {
      id: 'minecraft:oak_stairs',
      properties: { facing: 'north', half: 'bottom' }
    });

    const compressed = writeSchematic(project);
    const raw = gunzipSync(compressed);
    const { value } = decode(raw, { useMaps: true });
    const schematic = loadSchematic(value as TagMap);

    // Bounding box is x:[0,1], y:[0,1], z:[0,0] -> 2x2x1.
    expect(schematic.width).toBe(2);
    expect(schematic.height).toBe(2);
    expect(schematic.length).toBe(1);

    expect(schematic.getBlock({ x: 0, y: 0, z: 0 })?.type).toBe(stripNamespace('minecraft:stone'));
    expect(schematic.getBlock({ x: 1, y: 0, z: 0 })?.type).toBe(stripNamespace('minecraft:oak_planks'));

    const stairs = schematic.getBlock({ x: 0, y: 1, z: 0 });
    expect(stairs?.type).toBe(stripNamespace('minecraft:oak_stairs'));
    expect(stairs?.properties).toEqual({ facing: 'north', half: 'bottom' });

    // (1,1,0) was never set, so it must round-trip as air.
    expect(schematic.getBlock({ x: 1, y: 1, z: 0 })?.type).toBe(stripNamespace('minecraft:air'));
  });

  it('throws when the project has no blocks', () => {
    const project = new BuildProject('empty');
    expect(() => writeSchematic(project)).toThrow();
  });
});
