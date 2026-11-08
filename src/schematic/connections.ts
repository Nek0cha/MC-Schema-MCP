import { voxelKey, type BuildProject } from '../core/build-project.js';
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

/** Whether the block id is a fence, pane, bars or wall, i.e. something resolveConnectionAt can change. */
export function isConnectableId(id: string): boolean {
  return isFenceFamily(id) || isPaneFamily(id) || isWallFamily(id);
}

function isFenceFamily(id: string): boolean {
  return id.endsWith('_fence');
}

function isFenceGate(id: string): boolean {
  return id.endsWith('_fence_gate');
}

function isPaneFamily(id: string): boolean {
  return id.endsWith('_pane') || id.endsWith('_bars');
}

function isWoodenFence(id: string): boolean {
  return isFenceFamily(id) && id !== 'minecraft:nether_brick_fence';
}

function isWallFamily(id: string): boolean {
  return id.endsWith('_wall');
}

/**
 * Blocks that panes, fences and walls refuse to attach to even though they
 * are full cubes (vanilla's isExceptionForConnection).
 */
const CONNECTION_EXCEPTION_IDS = new Set([
  'minecraft:pumpkin',
  'minecraft:carved_pumpkin',
  'minecraft:jack_o_lantern',
  'minecraft:melon',
  'minecraft:barrier'
]);

function isConnectionException(id: string): boolean {
  return CONNECTION_EXCEPTION_IDS.has(id) || id.endsWith('_leaves') || id.endsWith('shulker_box');
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
  '_rail',
  '_bars',
  '_chain'
];

const NON_FULL_BLOCK_IDS = new Set([
  'minecraft:air',
  'minecraft:ladder',
  'minecraft:lantern',
  'minecraft:lever',
  'minecraft:tripwire',
  'minecraft:tripwire_hook',
  'minecraft:vine',
  'minecraft:chain',
  'minecraft:iron_chain',
  'minecraft:cobweb',
  'minecraft:flower_pot',
  'minecraft:cake',
  'minecraft:snow'
]);

function isSolidFullCube(id: string): boolean {
  if (NON_FULL_BLOCK_IDS.has(id) || isConnectionException(id)) return false;
  return !NON_FULL_BLOCK_SUFFIXES.some((suffix) => id.endsWith(suffix));
}

/** Wooden fences join each other; nether brick fences join only nether brick fences. */
function fenceConnectsTo(fenceId: string, neighborId: string): boolean {
  if (neighborId === AIR) return false;
  if (isFenceFamily(neighborId)) return isWoodenFence(fenceId) === isWoodenFence(neighborId);
  if (isFenceGate(neighborId)) return true;
  return isSolidFullCube(neighborId);
}

function paneConnectsTo(neighborId: string): boolean {
  if (neighborId === AIR) return false;
  if (isPaneFamily(neighborId) || isWallFamily(neighborId)) return true;
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
  if (isPaneFamily(neighborId)) return 'low';
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
  project.forEachBlock((pos) => {
    const state = resolveConnectionAt(project, pos);
    if (state) resolved.set(voxelKey(pos), state);
  });
  return resolved;
}

/**
 * Connection-resolved state of the block at `pos`, or undefined when that
 * block is not a fence, pane, bars or wall (or the cell is empty). Reads
 * only the block and its neighbors; never mutates the project.
 */
export function resolveConnectionAt(project: BuildProject, pos: Vec3): BlockState | undefined {
  const block = project.getBlock(pos);
  if (!block) return undefined;
  if (isFenceFamily(block.id)) {
    return withDirectionalConnections(project, pos, block, (neighborId) => fenceConnectsTo(block.id, neighborId));
  }
  if (isPaneFamily(block.id)) return withDirectionalConnections(project, pos, block, paneConnectsTo);
  if (isWallFamily(block.id)) return withWallConnections(project, pos, block);
  return undefined;
}

const MAX_LISTED_ISOLATED = 20;

/**
 * Panes and bars with no horizontal neighbor to attach to; they render as
 * thin posts. Fences and walls are skipped on purpose: standing alone as a
 * post is a normal use for them. Ordered y, then z, then x.
 */
export function findIsolatedConnectables(project: BuildProject): Vec3[] {
  const resolved = resolveConnections(project);
  const found: Vec3[] = [];
  project.forEachBlock((pos, block) => {
    if (!isPaneFamily(block.id)) return;
    const props = resolved.get(voxelKey(pos))?.properties;
    if (props && DIRECTIONS.every((direction) => props[direction] === 'false')) {
      found.push({ x: pos.x, y: pos.y, z: pos.z });
    }
  });
  return found.sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
}

export function formatIsolatedWarning(positions: Vec3[]): string {
  if (positions.length === 0) return '';
  const listed = positions
    .slice(0, MAX_LISTED_ISOLATED)
    .map((p) => `(${p.x},${p.y},${p.z})`)
    .join(', ');
  const more = positions.length > MAX_LISTED_ISOLATED ? ` (+${positions.length - MAX_LISTED_ISOLATED} more)` : '';
  return (
    `Warning: ${positions.length} isolated pane/bar/fence block(s) have no horizontal neighbor to connect to ` +
    `and will render as thin posts: ${listed}${more}. Put a solid block or another pane next to them, ` +
    `or use full glass blocks on diagonal/curved walls.`
  );
}
