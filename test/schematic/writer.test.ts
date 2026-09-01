import { describe, expect, it } from 'vitest';
import { decode, Int, Short, type TagMap } from '@enginehub/nbt-ts';
import { loadSchematic } from '@enginehub/schematicjs';
import { gunzipSync } from 'node:zlib';
import { BuildProject } from '../../src/core/build-project.js';
import { writeSchematic } from '../../src/schematic/writer.js';
import { DATA_VERSION } from '../../src/schematic/data-version.js';

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

  it('throws when two far-apart blocks make the dense bounding box exceed the volume cap', () => {
    const project = new BuildProject('volume-cap-test');
    // Individually each axis is well under the 32767 Short limit, but the
    // dense bounding box between them (261 x 261 x 261 = 17,779,581 cells)
    // exceeds the 16,000,000-cell export cap.
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    project.setBlock({ x: 260, y: 260, z: 260 }, { id: 'minecraft:stone' });

    expect(() => writeSchematic(project)).toThrow(/261x261x261/);
  });

  it('throws when a single axis exceeds the NBT Short dimension limit', () => {
    const project = new BuildProject('dimension-cap-test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    project.setBlock({ x: 0, y: 0, z: 40000 }, { id: 'minecraft:stone' });

    expect(() => writeSchematic(project)).toThrow(/1x1x40001/);
  });

  it('encodes structurally-correct NBT tag types and omits optional keys', () => {
    const project = new BuildProject('nbt-structure-test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });

    const compressed = writeSchematic(project);
    const raw = gunzipSync(compressed);
    const { value } = decode(raw, { useMaps: true });

    const root = value as TagMap;
    const schematic = root.get('Schematic') as TagMap;
    expect(schematic).toBeInstanceOf(Map);

    const dataVersionTag = schematic.get('DataVersion');
    expect(dataVersionTag).toBeInstanceOf(Int);
    expect((dataVersionTag as Int).value).toBe(DATA_VERSION);

    const versionTag = schematic.get('Version');
    expect(versionTag).toBeInstanceOf(Int);
    expect((versionTag as Int).value).toBe(3);

    expect(schematic.get('Width')).toBeInstanceOf(Short);
    expect(schematic.get('Height')).toBeInstanceOf(Short);
    expect(schematic.get('Length')).toBeInstanceOf(Short);

    const blocks = schematic.get('Blocks') as TagMap;
    expect(blocks).toBeInstanceOf(Map);
    expect(blocks.get('BlockEntities')).toEqual([]);

    expect(schematic.get('Biomes')).toBeUndefined();
    expect(schematic.get('Entities')).toBeUndefined();
  });
});
