import { parseVoxelKey, type BuildProject } from '../core/build-project.js';
import type { BlockState, Vec3 } from '../core/types.js';

const AIR = 'minecraft:air';

type Direction = 'north' | 'south' | 'east' | 'west';
const DIRECTIONS: Direction[] = ['north', 'south', 'east', 'west'];

const NEIGHBOR_OFFSETS: Record<Direction, Vec3> = {
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  west: { x: -1, y: 0, z: 0 },
  east: { x: 1, y: 0, z: 0 }
};

function isFenceFamily(id: string): boolean {
  return id.endsWith('_fence');
}

function isFenceGate(id: string): boolean {
  return id.endsWith('_fence_gate');
}

function isPaneFamily(id: string): boolean {
  return id.endsWith('_pane') || id === 'minecraft:iron_bars';
}

function isWallFamily(id: string): boolean {
  return id.endsWith('_wall');
}

function isGlassBlock(id: string): boolean {
  return id.endsWith('_glass') || id === 'minecraft:glass' || id === 'minecraft:tinted_glass';
}

/**
 * Block IDs (or suffixes) that don't occupy a full, sturdy cube. Everything
 * not listed here is optimistically treated as a full block, since most of
 * the game's blocks are.
 */
const NON_FULL_BLOCK_SUFFIXES = [
  '_slab',
  '_stairs',
  '_fence',
  '_fence_gate',
  '_pane',
  '_wall',
  '_carpet',
  '_door',
  '_trapdoor',
  '_button',
  '_pressure_plate',
  '_sign',
  '_wall_sign',
  '_banner',
  '_wall_banner',
  '_bed',
  '_torch',
  '_candle',
  '_rail'
];

const NON_FULL_BLOCK_IDS = new Set([
  'minecraft:air',
  'minecraft:iron_bars',
  'minecraft:ladder',
  'minecraft:lantern',
  'minecraft:lever',
  'minecraft:tripwire',
  'minecraft:tripwire_hook',
  'minecraft:vine',
  'minecraft:chain',
  'minecraft:cobweb',
  'minecraft:flower_pot',
  'minecraft:cake',
  'minecraft:snow'
]);

function isSolidFullCube(id: string): boolean {
  if (NON_FULL_BLOCK_IDS.has(id)) return false;
  return !NON_FULL_BLOCK_SUFFIXES.some((suffix) => id.endsWith(suffix));
}

function fenceConnectsTo(neighborId: string): boolean {
  if (neighborId === AIR) return false;
  if (isFenceFamily(neighborId)) return true;
  if (isFenceGate(neighborId)) return true;
  if (isGlassBlock(neighborId)) return false;
  return isSolidFullCube(neighborId);
}

function paneConnectsTo(neighborId: string): boolean {
  if (neighborId === AIR) return false;
  if (isPaneFamily(neighborId)) return true;
  if (isGlassBlock(neighborId)) return false;
  return isSolidFullCube(neighborId);
}

type WallHeight = 'none' | 'low' | 'tall';

/**
 * Vanilla's wall connection logic also factors in diagonal neighbors and a
 * few more exceptions; this is a simplified approximation that gets the
 * common cases (straight runs, corners, T-junctions, crosses) right.
 */
function wallConnectsTo(neighborId: string): WallHeight {
  if (neighborId === AIR) return 'none';
  if (isWallFamily(neighborId)) return 'tall';
  if (isGlassBlock(neighborId)) return 'none';
  return isSolidFullCube(neighborId) ? 'low' : 'none';
}

function neighborIdAt(project: BuildProject, pos: Vec3, direction: Direction): string {
  const offset = NEIGHBOR_OFFSETS[direction];
  const neighbor = project.getBlock({
    x: pos.x + offset.x,
    y: pos.y + offset.y,
    z: pos.z + offset.z
  });
  return neighbor?.id ?? AIR;
}

function withDirectionalConnections(
  project: BuildProject,
  pos: Vec3,
  block: BlockState,
  connectsTo: (neighborId: string) => boolean
): BlockState {
  const properties: Record<string, string> = { ...block.properties };
  for (const direction of DIRECTIONS) {
    properties[direction] = String(connectsTo(neighborIdAt(project, pos, direction)));
  }
  return { id: block.id, properties };
}

function withWallConnections(project: BuildProject, pos: Vec3, block: BlockState): BlockState {
  const properties: Record<string, string> = { ...block.properties };
  const heights: Record<Direction, WallHeight> = {
    north: 'none',
    south: 'none',
    east: 'none',
    west: 'none'
  };
  for (const direction of DIRECTIONS) {
    heights[direction] = wallConnectsTo(neighborIdAt(project, pos, direction));
    properties[direction] = heights[direction];
  }

  const connectedCount = DIRECTIONS.filter((direction) => heights[direction] !== 'none').length;
  const isStraightNorthSouth =
    heights.north !== 'none' && heights.south !== 'none' && heights.east === 'none' && heights.west === 'none';
  const isStraightEastWest =
    heights.east !== 'none' && heights.west !== 'none' && heights.north === 'none' && heights.south === 'none';
  const abovePos = { x: pos.x, y: pos.y + 1, z: pos.z };
  const hasBlockAbove = (project.getBlock(abovePos)?.id ?? AIR) !== AIR;
  const isStraightRun = isStraightNorthSouth || isStraightEastWest;
  const up = hasBlockAbove || connectedCount <= 1 || !isStraightRun;

  properties.up = String(up);
  return { id: block.id, properties };
}

/**
 * Recomputes north/south/east/west/up "connection" properties for
 * fences, glass panes, iron bars, and walls, based on what's actually
 * next to them in the finished build. This is a read-only pass over the
 * project's voxels run at export time; it never mutates the project
 * itself, so the values AI-supplied while building stay untouched.
 *
 * Returns only the overrides — one entry per connectable block that
 * needs its properties rewritten — rather than a full copy of every
 * voxel, so a caller iterating the whole build should fall back to the
 * project's own blocks for keys not present here.
 */
export function resolveConnections(project: BuildProject): Map<string, BlockState> {
  const resolved = new Map<string, BlockState>();
  for (const [key, block] of project.voxels) {
    const pos = parseVoxelKey(key);
    if (isFenceFamily(block.id)) {
      resolved.set(key, withDirectionalConnections(project, pos, block, fenceConnectsTo));
    } else if (isPaneFamily(block.id)) {
      resolved.set(key, withDirectionalConnections(project, pos, block, paneConnectsTo));
    } else if (isWallFamily(block.id)) {
      resolved.set(key, withWallConnections(project, pos, block));
    }
  }
  return resolved;
}
