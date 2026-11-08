import { encode, Int } from '@enginehub/nbt-ts';
import { gzipSync } from 'node:zlib';
import type { BuildProject } from '../core/build-project.js';
import type { Pos } from '../core/markers.js';
import { blockStateKey, type BlockState } from '../core/types.js';
import { resolveConnectionAt } from './connections.js';

const AIR: BlockState = { id: 'minecraft:air' };
const AIR_IDS = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air']);

export interface TileSpec {
  tx: number;
  tz: number;
  /** World x/z of the tile's minimum corner. */
  x0: number;
  z0: number;
  sx: number;
  sy: number;
  sz: number;
}

/** Splits a map into tileSize x tileSize columns (full height); edge tiles are smaller, not padded. */
export function tileLayout(size: Pos, tileSize = 48): TileSpec[] {
  const tiles: TileSpec[] = [];
  const countX = Math.ceil(size[0] / tileSize);
  const countZ = Math.ceil(size[2] / tileSize);
  for (let tx = 0; tx < countX; tx++) {
    for (let tz = 0; tz < countZ; tz++) {
      const x0 = tx * tileSize;
      const z0 = tz * tileSize;
      tiles.push({
        tx,
        tz,
        x0,
        z0,
        sx: Math.min(tileSize, size[0] - x0),
        sy: size[1],
        sz: Math.min(tileSize, size[2] - z0)
      });
    }
  }
  return tiles;
}

/**
 * Serializes one tile as a vanilla StructureTemplate (gzip-compressed NBT).
 * Positions are relative to the tile; connection properties (fences, panes,
 * walls) are resolved. Cells outside the tile are never written.
 */
export function writeStructureTile(
  project: BuildProject,
  tile: TileSpec,
  opts: { dataVersion: number; includeAir: boolean }
): Buffer {
  const paletteIndex = new Map<string, number>();
  const palette: Record<string, unknown>[] = [];
  const blocks: Record<string, unknown>[] = [];

  const stateIndex = (block: BlockState): number => {
    const key = blockStateKey(block);
    let index = paletteIndex.get(key);
    if (index === undefined) {
      index = palette.length;
      paletteIndex.set(key, index);
      const entry: Record<string, unknown> = { Name: block.id };
      if (block.properties && Object.keys(block.properties).length > 0) {
        entry.Properties = { ...block.properties };
      }
      palette.push(entry);
    }
    return index;
  };

  for (let y = 0; y < tile.sy; y++) {
    for (let z = 0; z < tile.sz; z++) {
      for (let x = 0; x < tile.sx; x++) {
        const world = { x: tile.x0 + x, y, z: tile.z0 + z };
        const stored = project.getBlock(world);
        let block: BlockState;
        if (stored === undefined) {
          if (!opts.includeAir) continue;
          block = AIR;
        } else {
          if (!opts.includeAir && AIR_IDS.has(stored.id)) continue;
          block = resolveConnectionAt(project, world) ?? (stored as BlockState);
        }
        blocks.push({ pos: [new Int(x), new Int(y), new Int(z)], state: new Int(stateIndex(block)) });
      }
    }
  }

  const root = {
    DataVersion: new Int(opts.dataVersion),
    size: [new Int(tile.sx), new Int(tile.sy), new Int(tile.sz)],
    palette,
    blocks,
    entities: [] as never[]
  };
  return gzipSync(encode('', root as never));
}
