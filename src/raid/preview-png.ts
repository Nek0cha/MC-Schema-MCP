import type { BuildProject } from '../core/build-project.js';
import type { MapSettings, Marker } from '../core/markers.js';
import type { BlockState } from '../core/types.js';
import { blockStateKey } from '../core/types.js';

type Rgb = [number, number, number];

export const MARKER_COLORS = {
  player_spawn: [40, 200, 60] as Rgb,
  extract: [0, 200, 255] as Rgb,
  /** Darker for higher tiers: index 0 = tier 1. */
  loot: [[255, 235, 130], [255, 205, 0], [180, 140, 0]] as Rgb[],
  enemy_spawn: [230, 30, 30] as Rgb,
  patrol_route: [255, 140, 0] as Rgb
};

export const PX_PER_BLOCK = 2;
const BACKGROUND: Rgb = [24, 24, 24];
const AIR_IDS = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air']);

export const LEGEND_LINES = [
  'preview.png legend (top-down view, north is up, 2x2 pixels per block)',
  'green dot + short line: player spawn (line shows the facing direction)',
  'cyan dot + circle: extract (circle = radius)',
  'yellow square: loot (darker = higher tier)',
  'red dot: enemy spawn',
  'orange line: patrol route'
];

export interface MapPreview {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** Top-down plan view of the map with the markers drawn on top. */
export function renderMapPreview(
  project: BuildProject,
  map: MapSettings,
  markers: readonly Marker[],
  opts: { colorOf: (block: BlockState) => Rgb }
): MapPreview {
  const [sx, sy, sz] = map.size;
  const width = sx * PX_PER_BLOCK;
  const height = sz * PX_PER_BLOCK;
  const rgba = new Uint8Array(width * height * 4);

  // Highest non-air block of every column, then one pass to paint.
  const topY = new Int16Array(sx * sz).fill(-1);
  const topBlock: (Readonly<BlockState> | undefined)[] = new Array(sx * sz);
  project.forEachBlock((pos, block) => {
    if (pos.x < 0 || pos.z < 0 || pos.x >= sx || pos.z >= sz || pos.y < 0 || pos.y >= sy) return;
    if (AIR_IDS.has(block.id)) return;
    const i = pos.z * sx + pos.x;
    if (pos.y > topY[i]) {
      topY[i] = pos.y;
      topBlock[i] = block;
    }
  });

  const colorCache = new Map<string, Rgb>();
  const baseColor = (block: Readonly<BlockState>): Rgb => {
    const key = blockStateKey(block as BlockState);
    let c = colorCache.get(key);
    if (!c) {
      c = opts.colorOf(block as BlockState);
      colorCache.set(key, c);
    }
    return c;
  };

  const set = (px: number, py: number, c: Rgb) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const o = (py * width + px) * 4;
    rgba[o] = c[0];
    rgba[o + 1] = c[1];
    rgba[o + 2] = c[2];
    rgba[o + 3] = 255;
  };

  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const i = z * sx + x;
      let c = BACKGROUND;
      if (topY[i] >= 0) {
        const base = baseColor(topBlock[i]!);
        const shade = 0.55 + 0.45 * Math.min(1, topY[i] / Math.max(1, sy - 1));
        c = [Math.round(base[0] * shade), Math.round(base[1] * shade), Math.round(base[2] * shade)];
      }
      for (let dy = 0; dy < PX_PER_BLOCK; dy++) {
        for (let dx = 0; dx < PX_PER_BLOCK; dx++) set(x * PX_PER_BLOCK + dx, z * PX_PER_BLOCK + dy, c);
      }
    }
  }

  const center = (p: readonly number[]): [number, number] => [p[0] * PX_PER_BLOCK + 1, p[2] * PX_PER_BLOCK + 1];
  const disc = (cx: number, cy: number, r: number, c: Rgb) => {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + 1) set(cx + x, cy + y, c);
  };
  const ring = (cx: number, cy: number, r: number, c: Rgb) => {
    const steps = Math.max(16, Math.ceil(2 * Math.PI * r));
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      set(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), c);
    }
  };
  const line = (x0: number, y0: number, x1: number, y1: number, c: Rgb) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) set(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), c);
  };

  // Draw order: lines and rings first, points on top.
  for (const m of markers) {
    if (m.kind !== 'patrol_route') continue;
    for (let i = 1; i < m.points.length; i++) {
      const [ax, ay] = center(m.points[i - 1]);
      const [bx, by] = center(m.points[i]);
      line(ax, ay, bx, by, MARKER_COLORS.patrol_route);
    }
  }
  for (const m of markers) {
    if (m.kind !== 'extract') continue;
    const [cx, cy] = center(m.pos);
    ring(cx, cy, m.radius * PX_PER_BLOCK, MARKER_COLORS.extract);
  }
  for (const m of markers) {
    if (m.kind === 'loot') {
      const [cx, cy] = center(m.pos);
      const c = MARKER_COLORS.loot[m.tier - 1];
      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) set(cx + x, cy + y, c);
    }
  }
  for (const m of markers) {
    if (m.kind === 'extract') {
      const [cx, cy] = center(m.pos);
      disc(cx, cy, 3, MARKER_COLORS.extract);
    } else if (m.kind === 'enemy_spawn') {
      const [cx, cy] = center(m.pos);
      disc(cx, cy, 3, MARKER_COLORS.enemy_spawn);
    }
  }
  for (const m of markers) {
    if (m.kind !== 'player_spawn') continue;
    const [cx, cy] = center(m.pos);
    // Yaw 0 = south (+z, down in the image), 90 = west (-x), 180 = north, 270 = east.
    const yaw = (m.facing * Math.PI) / 180;
    line(cx, cy, Math.round(cx - Math.sin(yaw) * 8), Math.round(cy + Math.cos(yaw) * 8), MARKER_COLORS.player_spawn);
    disc(cx, cy, 3, MARKER_COLORS.player_spawn);
  }

  return { width, height, rgba };
}
