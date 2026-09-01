import { encode, Int, Short } from '@enginehub/nbt-ts';
import { gzipSync } from 'node:zlib';
import { voxelKey, type BuildProject } from '../core/build-project.js';
import { blockStateKey, type BlockState, type Vec3 } from '../core/types.js';
import { encodeVarInt } from './varint.js';
import { DATA_VERSION } from './data-version.js';
import { resolveConnections } from './connections.js';

const AIR: BlockState = { id: 'minecraft:air' };

/**
 * Serializes a BuildProject into a gzip-compressed Sponge Schematic v3
 * (.schem) buffer, ready to write to disk. Throws if the project has no
 * blocks (there is no meaningful bounding box to export).
 */
export function writeSchematic(project: BuildProject): Buffer {
  const bbox = project.getBoundingBox();
  if (!bbox) {
    throw new Error(`Project "${project.name}" has no blocks to export.`);
  }

  const width = bbox.max.x - bbox.min.x + 1;
  const height = bbox.max.y - bbox.min.y + 1;
  const length = bbox.max.z - bbox.min.z + 1;

  const MAX_DIMENSION = 32767; // NBT Short max
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || length > MAX_DIMENSION) {
    throw new Error(
      `Project "${project.name}" spans ${width}x${height}x${length}, exceeding the ` +
        `${MAX_DIMENSION}-block-per-axis limit the Sponge Schematic format's Short fields allow.`
    );
  }
  const volume = width * height * length;
  const MAX_VOLUME = 16_000_000; // ~256^3, generous cap for a dense-format export
  if (volume > MAX_VOLUME) {
    throw new Error(
      `Project "${project.name}" spans ${width}x${height}x${length} = ${volume} cells, ` +
        `over the ${MAX_VOLUME}-cell limit. Schematics are dense, so a sparse build with far-apart ` +
        `blocks still costs its full bounding box.`
    );
  }

  const connectionOverrides = resolveConnections(project);
  function blockAt(worldPos: Vec3): BlockState {
    const key = voxelKey(worldPos);
    return connectionOverrides.get(key) ?? project.getBlock(worldPos) ?? AIR;
  }

  const palette = new Map<string, number>();
  function paletteIdFor(block: BlockState): number {
    const key = blockStateKey(block);
    let id = palette.get(key);
    if (id === undefined) {
      id = palette.size;
      palette.set(key, id);
    }
    return id;
  }
  // Reserve id 0 for air so the common "empty space" case is cheap.
  paletteIdFor(AIR);

  const dataBytes: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let z = 0; z < length; z++) {
      for (let x = 0; x < width; x++) {
        const worldPos = { x: x + bbox.min.x, y: y + bbox.min.y, z: z + bbox.min.z };
        const block = blockAt(worldPos);
        dataBytes.push(...encodeVarInt(paletteIdFor(block)));
      }
    }
  }

  const paletteCompound: Record<string, Int> = {};
  for (const [key, id] of palette) {
    paletteCompound[key] = new Int(id);
  }

  const schematicCompound = {
    Version: new Int(3),
    DataVersion: new Int(DATA_VERSION),
    Width: new Short(width),
    Height: new Short(height),
    Length: new Short(length),
    Offset: new Int32Array([0, 0, 0]),
    Blocks: {
      Palette: paletteCompound,
      Data: Buffer.from(dataBytes),
      BlockEntities: [] as never[]
    }
  };

  const uncompressed = encode('', { Schematic: schematicCompound });
  return gzipSync(uncompressed);
}
