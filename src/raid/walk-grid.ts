import { chunkKey, type BuildProject } from '../core/build-project.js';
import type { Pos } from '../core/markers.js';
import type { BlockState } from '../core/types.js';

/**
 * Walkability model for raid-map validation, following the map requirements
 * (steps up or down of at most one block, no diagonal moves) rather than
 * vanilla mob pathing in every detail.
 */
export interface WalkGrid {
  size: Pos;
  standable(x: number, y: number, z: number): boolean;
  /** Feet height L of a standable cell, NaN otherwise. */
  level(x: number, y: number, z: number): number;
  /** True when the cell lies in a 2x2 square of standable cells at roughly the same level. */
  wide(x: number, y: number, z: number): boolean;
}

export interface ReachResult {
  reached(p: Pos): boolean;
  /** Closest reached cell to `target` (Euclidean), or null when nothing was reached. */
  nearest(target: Pos): { pos: Pos; distance: number } | null;
}

/** Collision class of a block: -1 = impassable, otherwise its top height in 1/16 block (0..16). */
const IMPASSABLE = -1;
const NOT_STANDABLE = -128;

const PASSABLE_EXACT = new Set([
  'air', 'cave_air', 'void_air', 'water', 'bubble_column', 'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern',
  'dead_bush', 'torch', 'wall_torch', 'soul_torch', 'soul_wall_torch', 'redstone_torch', 'redstone_wall_torch',
  'lever', 'rail', 'redstone_wire', 'tripwire', 'tripwire_hook', 'vine', 'glow_lichen', 'sugar_cane', 'seagrass',
  'tall_seagrass', 'kelp', 'kelp_plant', 'nether_sprouts', 'crimson_roots', 'warped_roots', 'hanging_roots',
  'poppy', 'dandelion', 'blue_orchid', 'allium', 'azure_bluet', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley',
  'torchflower', 'sunflower', 'lilac', 'rose_bush', 'peony', 'pink_petals', 'brown_mushroom', 'red_mushroom',
  'wheat', 'carrots', 'potatoes', 'beetroots', 'structure_void', 'light', 'spore_blossom', 'cave_vines', 'cave_vines_plant',
  'weeping_vines', 'weeping_vines_plant', 'twisting_vines', 'twisting_vines_plant', 'snow'
]);
const PASSABLE_SUFFIXES = [
  '_sapling', '_button', '_pressure_plate', '_sign', '_wall_sign', '_hanging_sign', '_wall_hanging_sign', '_banner',
  '_wall_banner', '_rail', '_tulip', '_coral', '_coral_fan', '_coral_wall_fan'
];
const IMPASSABLE_EXACT = new Set([
  'lava', 'cactus', 'magma_block', 'fire', 'soul_fire', 'powder_snow', 'cobweb', 'sweet_berry_bush', 'iron_door',
  'iron_bars', 'campfire', 'soul_campfire', 'wither_rose'
]);

function strip(id: string): string {
  return id.startsWith('minecraft:') ? id.slice('minecraft:'.length) : id;
}

function isWallId(name: string): boolean {
  return name.endsWith('_wall') && !name.endsWith('_wall_torch');
}

/** Collision class used by the walk grid (exported for tests and the export step). */
export function collisionOf(block: BlockState | undefined): { top: number; ladder: boolean } {
  if (!block) return { top: 0, ladder: false };
  const name = strip(block.id);
  const props = block.properties ?? {};
  if (name === 'ladder') return { top: 0, ladder: true };
  if (IMPASSABLE_EXACT.has(name)) return { top: IMPASSABLE, ladder: false };
  if (name.endsWith('_fence_gate')) return { top: props.open === 'true' ? 0 : IMPASSABLE, ladder: false };
  if (name.endsWith('_fence') || isWallId(name) || name.endsWith('_bars') || name.endsWith('_pane')) {
    return { top: IMPASSABLE, ladder: false };
  }
  if (name.endsWith('_door')) return { top: 0, ladder: false }; // wooden doors: mobs open them
  if (name.endsWith('_trapdoor')) {
    if (props.open === 'true') return { top: 0, ladder: false };
    return { top: props.half === 'top' ? 16 : 3, ladder: false };
  }
  if (name.endsWith('_carpet')) return { top: 1, ladder: false };
  if (name.endsWith('_slab')) return { top: props.type === 'bottom' ? 8 : 16, ladder: false };
  if (PASSABLE_EXACT.has(name) || PASSABLE_SUFFIXES.some((s) => name.endsWith(s)) || name.startsWith('potted_')) {
    return { top: name.startsWith('potted_') ? 16 : 0, ladder: false };
  }
  return { top: 16, ladder: false };
}

export function buildWalkGrid(project: BuildProject, size: Pos): WalkGrid {
  const [sx, sy, sz] = size;
  const n = sx * sy * sz;
  const index = (x: number, y: number, z: number) => (y * sz + z) * sx + x;
  const inside = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz;

  // Per palette id: collision top (or IMPASSABLE) and ladder flag.
  const palette = project.getPalette();
  const topOf = new Int8Array(palette.length);
  const ladderOf = new Uint8Array(palette.length);
  for (let i = 1; i < palette.length; i++) {
    const c = collisionOf(palette[i] ?? undefined);
    topOf[i] = c.top;
    ladderOf[i] = c.ladder ? 1 : 0;
  }

  // Dense copy of palette ids over the map volume, chunk by chunk.
  const cells = new Uint16Array(n);
  for (let cy = 0; cy * 16 < sy; cy++) {
    for (let cz = 0; cz * 16 < sz; cz++) {
      for (let cx = 0; cx * 16 < sx; cx++) {
        const chunk = project.getChunk(chunkKey(cx, cy, cz));
        if (!chunk) continue;
        for (let ly = 0; ly < 16; ly++) {
          const y = cy * 16 + ly;
          if (y >= sy) break;
          for (let lz = 0; lz < 16; lz++) {
            const z = cz * 16 + lz;
            if (z >= sz) break;
            const row = (ly * 16 + lz) * 16;
            const base = index(cx * 16, y, z);
            for (let lx = 0; lx < 16; lx++) {
              if (cx * 16 + lx >= sx) break;
              cells[base + lx] = chunk[row + lx];
            }
          }
        }
      }
    }
  }

  const top = (x: number, y: number, z: number): number => (inside(x, y, z) ? topOf[cells[index(x, y, z)]] : 0);
  const ladder = (x: number, y: number, z: number): boolean => inside(x, y, z) && ladderOf[cells[index(x, y, z)]] === 1;

  // Feet offset in 1/16 above the cell's own y (can be 0..8), or NOT_STANDABLE.
  const offset = new Int8Array(n).fill(NOT_STANDABLE);
  for (let y = 0; y < sy; y++) {
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        const f = top(x, y, z);
        if (f === IMPASSABLE || f > 8) continue;
        const head = top(x, y + 1, z);
        if (head !== 0) continue;
        if (ladder(x, y, z)) {
          offset[index(x, y, z)] = 0;
          continue;
        }
        if (f > 0) {
          if (f <= 1 && (y === 0 || top(x, y - 1, z) !== 16)) continue; // floating carpet
          if (f > 3 && top(x, y + 2, z) > 0) continue; // raised feet need a bit more head room
          offset[index(x, y, z)] = f;
          continue;
        }
        if (y === 0 || top(x, y - 1, z) !== 16) continue;
        offset[index(x, y, z)] = 0;
      }
    }
  }

  const standable = (x: number, y: number, z: number) => inside(x, y, z) && offset[index(x, y, z)] !== NOT_STANDABLE;
  const level = (x: number, y: number, z: number) => (standable(x, y, z) ? y + offset[index(x, y, z)] / 16 : NaN);

  function sameLevelNear(x: number, z: number, y: number, l0: number): boolean {
    for (let dy = -1; dy <= 1; dy++) {
      const l = level(x, y + dy, z);
      if (!Number.isNaN(l) && Math.abs(l - l0) <= 0.5) return true;
    }
    return false;
  }

  const wideCache = new Int8Array(n); // 0 unknown, 1 yes, 2 no
  function wide(x: number, y: number, z: number): boolean {
    if (!standable(x, y, z)) return false;
    const i = index(x, y, z);
    if (wideCache[i] !== 0) return wideCache[i] === 1;
    const l0 = level(x, y, z);
    let result = false;
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      if (sameLevelNear(x + dx, z, y, l0) && sameLevelNear(x, z + dz, y, l0) && sameLevelNear(x + dx, z + dz, y, l0)) {
        result = true;
        break;
      }
    }
    wideCache[i] = result ? 1 : 2;
    return result;
  }

  const grid: WalkGrid & { _internal: Internal } = {
    size,
    standable,
    level,
    wide,
    _internal: { index, inside, top, ladder, n }
  };
  return grid;
}

interface Internal {
  index(x: number, y: number, z: number): number;
  inside(x: number, y: number, z: number): boolean;
  top(x: number, y: number, z: number): number;
  ladder(x: number, y: number, z: number): boolean;
  n: number;
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Breadth-first search over standable cells from `start`. */
export function explore(grid: WalkGrid, start: Pos, opts: { wideOnly?: boolean } = {}): ReachResult {
  const internal = (grid as WalkGrid & { _internal: Internal })._internal;
  const { index, top, ladder, n } = internal;
  const [sx, , sz] = grid.size;
  const visited = new Uint8Array(n);
  const ok = (x: number, y: number, z: number) => grid.standable(x, y, z) && (!opts.wideOnly || grid.wide(x, y, z));

  let count = 0;
  const [x0, y0, z0] = start;
  if (ok(x0, y0, z0)) {
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    visited[index(x0, y0, z0)] = 1;
    queue[tail++] = index(x0, y0, z0);
    count = 1;
    const push = (x: number, y: number, z: number) => {
      const i = index(x, y, z);
      if (visited[i]) return;
      visited[i] = 1;
      queue[tail++] = i;
      count++;
    };
    while (head < tail) {
      const i = queue[head++];
      const x = i % sx;
      const z = Math.floor(i / sx) % sz;
      const y = Math.floor(i / (sx * sz));
      const l = grid.level(x, y, z);
      for (const [dx, dz] of DIRS) {
        const nx = x + dx;
        const nz = z + dz;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (!ok(nx, ny, nz)) continue;
          const nl = grid.level(nx, ny, nz);
          const rise = nl - l;
          if (Math.abs(rise) > 1) continue;
          // Jumping up needs head room above the start cell.
          if (rise > 0.5 && top(x, y + 2, z) !== 0) continue;
          push(nx, ny, nz);
        }
      }
      // Ladders move vertically.
      if (ladder(x, y, z)) {
        if (ok(x, y + 1, z)) push(x, y + 1, z);
      }
      if (ok(x, y - 1, z) && ladder(x, y - 1, z)) push(x, y - 1, z);
    }
  }

  return {
    reached: ([x, y, z]) => internal.inside(x, y, z) && visited[index(x, y, z)] === 1,
    nearest(target) {
      if (count === 0) return null;
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        if (!visited[i]) continue;
        const x = i % sx;
        const z = Math.floor(i / sx) % sz;
        const y = Math.floor(i / (sx * sz));
        const d = (x - target[0]) ** 2 + (y - target[1]) ** 2 + (z - target[2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      const x = best % sx;
      const z = Math.floor(best / sx) % sz;
      const y = Math.floor(best / (sx * sz));
      return { pos: [x, y, z], distance: Math.round(Math.sqrt(bestD) * 100) / 100 };
    }
  };
}

/** Visited-cell check used by validation: any reached standable cell within `radius` of `center`. */
export function reachedWithin(result: ReachResult, grid: WalkGrid, center: Pos, radius: number): boolean {
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
        const p: Pos = [center[0] + dx, center[1] + dy, center[2] + dz];
        if (grid.standable(...p) && result.reached(p)) return true;
      }
    }
  }
  return false;
}
