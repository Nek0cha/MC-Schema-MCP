import type { BoundingBox, BuildProject } from './build-project.js';
import { applyReplacement, matchesAny, type BlockMatcher, type KeepProperties } from './block-match.js';
import { createRng, pickFromPalette } from './random.js';
import type { BlockOrPalette } from './shapes.js';
import { transformBlockState, transformOffset, type Transform } from './transform.js';
import type { BlockState, Vec3 } from './types.js';

export const MAX_REGION_CELLS = 32_000_000;
export const MAX_STACK_COUNT = 256;

const AIR_ID = 'minecraft:air';
/** Shared and never mutated; BuildProject copies block states into its own palette. */
const AIR: BlockState = { id: AIR_ID };

export interface RegionResult {
  changed: number;
  bounds: BoundingBox | null;
  rubble?: number;
}

export type StackDirection = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';

export interface DecayOptions {
  topBias?: boolean;
  protect?: BlockMatcher[];
  rubble?: boolean;
  rubbleChance?: number;
  rubbleBlocks?: BlockOrPalette;
  seed?: number;
}

const DEFAULT_RUBBLE: BlockOrPalette = [
  { block: { id: 'minecraft:cobblestone' }, weight: 3 },
  { block: { id: 'minecraft:gravel' }, weight: 2 },
  { block: { id: 'minecraft:cobblestone_slab', properties: { type: 'bottom' } }, weight: 2 }
];

interface Cell {
  pos: Vec3;
  block: Readonly<BlockState>;
}

function sortedRange(from: Vec3, to: Vec3): BoundingBox {
  return {
    min: { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), z: Math.min(from.z, to.z) },
    max: { x: Math.max(from.x, to.x), y: Math.max(from.y, to.y), z: Math.max(from.z, to.z) }
  };
}

function cellCount(range: BoundingBox): number {
  return (
    (range.max.x - range.min.x + 1) * (range.max.y - range.min.y + 1) * (range.max.z - range.min.z + 1)
  );
}

function checkedRange(from: Vec3, to: Vec3): BoundingBox {
  const range = sortedRange(from, to);
  const cells = cellCount(range);
  if (cells > MAX_REGION_CELLS) {
    throw new Error(
      `Region is too large: ${cells.toLocaleString('en-US')} cells (max ${MAX_REGION_CELLS.toLocaleString('en-US')} per operation).`
    );
  }
  return range;
}

function insideRange(pos: Vec3, range: BoundingBox): boolean {
  return (
    pos.x >= range.min.x &&
    pos.x <= range.max.x &&
    pos.y >= range.min.y &&
    pos.y <= range.max.y &&
    pos.z >= range.min.z &&
    pos.z <= range.max.z
  );
}

function compareYZX(a: Vec3, b: Vec3): number {
  return a.y - b.y || a.z - b.z || a.x - b.x;
}

/** Every set cell inside the range, ordered y, then z, then x, so random draws do not depend on chunk order. */
function collectCells(project: BuildProject, range: BoundingBox): Cell[] {
  const cells: Cell[] = [];
  if (cellCount(range) <= project.blockCount * 4) {
    for (let y = range.min.y; y <= range.max.y; y++) {
      for (let z = range.min.z; z <= range.max.z; z++) {
        for (let x = range.min.x; x <= range.max.x; x++) {
          const block = project.getBlock({ x, y, z });
          if (block) cells.push({ pos: { x, y, z }, block });
        }
      }
    }
    return cells;
  }
  project.forEachBlock((pos, block) => {
    if (insideRange(pos, range)) cells.push({ pos: { x: pos.x, y: pos.y, z: pos.z }, block });
  });
  return cells.sort((a, b) => compareYZX(a.pos, b.pos));
}

/** Transformed bounding box of a range, relative to its own min corner (which maps to the origin). */
function transformedExtent(range: BoundingBox, t: Transform): { min: Vec3; max: Vec3 } {
  const size = {
    x: range.max.x - range.min.x,
    y: range.max.y - range.min.y,
    z: range.max.z - range.min.z
  };
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const cx of [0, size.x]) {
    for (const cz of [0, size.z]) {
      const p = transformOffset({ x: cx, y: 0, z: cz }, t);
      min.x = Math.min(min.x, p.x);
      min.z = Math.min(min.z, p.z);
      max.x = Math.max(max.x, p.x);
      max.z = Math.max(max.z, p.z);
    }
  }
  min.y = 0;
  max.y = size.y;
  return { min, max };
}

export function copyRegion(
  project: BuildProject,
  from: Vec3,
  to: Vec3,
  dest: Vec3,
  t: Transform = {}
): RegionResult {
  const range = checkedRange(from, to);
  // Read everything first so an overlapping destination never sees half-written cells.
  const cells = collectCells(project, range);
  const extent = transformedExtent(range, t);
  const writes = cells.map(({ pos, block }) => {
    const offset = transformOffset(
      { x: pos.x - range.min.x, y: pos.y - range.min.y, z: pos.z - range.min.z },
      t
    );
    return {
      pos: {
        x: dest.x + offset.x - extent.min.x,
        y: dest.y + offset.y - extent.min.y,
        z: dest.z + offset.z - extent.min.z
      },
      block: t.rotate || t.flip ? transformBlockState(block, t) : block
    };
  });
  for (const { pos, block } of writes) project.setBlock(pos, block);
  return {
    changed: writes.length,
    bounds: {
      min: { x: dest.x, y: dest.y, z: dest.z },
      max: {
        x: dest.x + extent.max.x - extent.min.x,
        y: dest.y + extent.max.y - extent.min.y,
        z: dest.z + extent.max.z - extent.min.z
      }
    }
  };
}

const STACK_VECTORS: Record<StackDirection, Vec3> = {
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  down: { x: 0, y: -1, z: 0 }
};

export function stackRegion(
  project: BuildProject,
  from: Vec3,
  to: Vec3,
  direction: StackDirection,
  count: number,
  gap = 0
): RegionResult {
  if (!Number.isInteger(count) || count < 1 || count > MAX_STACK_COUNT) {
    throw new Error(`stack count must be an integer from 1 to ${MAX_STACK_COUNT}, got ${count}.`);
  }
  if (!Number.isInteger(gap) || gap < 0) {
    throw new Error(`stack gap must be a non-negative integer, got ${gap}.`);
  }
  const range = checkedRange(from, to);
  const vector = STACK_VECTORS[direction];
  const length =
    vector.x !== 0
      ? range.max.x - range.min.x + 1
      : vector.y !== 0
        ? range.max.y - range.min.y + 1
        : range.max.z - range.min.z + 1;
  const step = length + gap;

  const cells = collectCells(project, range);
  let changed = 0;
  for (let n = 1; n <= count; n++) {
    const shift = { x: vector.x * step * n, y: vector.y * step * n, z: vector.z * step * n };
    for (const { pos, block } of cells) {
      project.setBlock({ x: pos.x + shift.x, y: pos.y + shift.y, z: pos.z + shift.z }, block);
      changed++;
    }
  }
  const last = { x: vector.x * step * count, y: vector.y * step * count, z: vector.z * step * count };
  const first = { x: vector.x * step, y: vector.y * step, z: vector.z * step };
  const shifted = (shift: Vec3): BoundingBox => ({
    min: { x: range.min.x + shift.x, y: range.min.y + shift.y, z: range.min.z + shift.z },
    max: { x: range.max.x + shift.x, y: range.max.y + shift.y, z: range.max.z + shift.z }
  });
  const a = shifted(first);
  const b = shifted(last);
  return {
    changed,
    bounds: {
      min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) },
      max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) }
    }
  };
}

export function replaceInRegion(
  project: BuildProject,
  from: Vec3,
  to: Vec3,
  match: BlockMatcher[],
  replacement: BlockOrPalette,
  keep: KeepProperties = 'auto',
  seed?: number
): RegionResult {
  const range = checkedRange(from, to);
  const rng = createRng(seed);
  let changed = 0;
  for (const { pos, block } of collectCells(project, range)) {
    if (!matchesAny(block, match)) continue;
    project.setBlock(pos, applyReplacement(block, pickFromPalette(replacement, rng), keep));
    changed++;
  }
  return { changed, bounds: range };
}

export function clearRegion(
  project: BuildProject,
  from: Vec3,
  to: Vec3,
  mode: 'unset' | 'air' = 'unset'
): RegionResult {
  const range = checkedRange(from, to);
  let changed = 0;
  if (mode === 'unset') {
    for (const { pos } of collectCells(project, range)) {
      project.removeBlock(pos);
      changed++;
    }
  } else {
    for (let y = range.min.y; y <= range.max.y; y++) {
      for (let z = range.min.z; z <= range.max.z; z++) {
        for (let x = range.min.x; x <= range.max.x; x++) {
          const pos = { x, y, z };
          if (project.getBlock(pos)?.id === AIR_ID) continue;
          project.setBlock(pos, AIR);
          changed++;
        }
      }
    }
  }
  return { changed, bounds: range };
}

function isSolid(project: BuildProject, pos: Vec3): boolean {
  const block = project.getBlock(pos);
  return block !== undefined && block.id !== AIR_ID;
}

export function decayRegion(
  project: BuildProject,
  from: Vec3,
  to: Vec3,
  intensity: number,
  options: DecayOptions = {}
): RegionResult {
  if (!(intensity >= 0 && intensity <= 1)) {
    throw new Error(`decay intensity must be between 0 and 1, got ${intensity}.`);
  }
  const rubbleChance = options.rubbleChance ?? 0.3;
  if (!(rubbleChance >= 0 && rubbleChance <= 1)) {
    throw new Error(`rubbleChance must be between 0 and 1, got ${rubbleChance}.`);
  }
  const range = checkedRange(from, to);
  const topBias = options.topBias ?? true;
  const protect = options.protect ?? [];
  const useRubble = options.rubble ?? true;
  const rubbleBlocks = options.rubbleBlocks ?? DEFAULT_RUBBLE;
  const rng = createRng(options.seed);
  const spanY = Math.max(1, range.max.y - range.min.y);

  // Decide everything first, in a fixed scan order, so the result does not depend on edit order.
  const removed: Vec3[] = [];
  const rubbleSpots: Vec3[] = [];
  for (const { pos, block } of collectCells(project, range)) {
    if (block.id === AIR_ID) continue;
    if (protect.length > 0 && matchesAny(block, protect)) continue;
    const weight = topBias ? 0.25 + (0.75 * (pos.y - range.min.y)) / spanY : 1;
    if (rng() >= intensity * weight) continue;
    removed.push(pos);
    if (useRubble && rng() < rubbleChance) rubbleSpots.push(pos);
  }

  for (const pos of removed) project.removeBlock(pos);

  let rubble = 0;
  for (const spot of rubbleSpots) {
    for (let y = spot.y - 1; y >= range.min.y; y--) {
      const below = { x: spot.x, y, z: spot.z };
      if (!isSolid(project, below)) continue;
      const landing = { x: spot.x, y: y + 1, z: spot.z };
      if (!isSolid(project, landing)) {
        project.setBlock(landing, pickFromPalette(rubbleBlocks, rng));
        rubble++;
      }
      break;
    }
  }
  return { changed: removed.length, bounds: range, rubble };
}
