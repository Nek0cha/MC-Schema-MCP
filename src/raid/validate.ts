import type { BuildProject } from '../core/build-project.js';
import type { MapSettings, Marker, Pos } from '../core/markers.js';
import { findIsolatedConnectables } from '../schematic/connections.js';
import { buildWalkGrid, explore, reachedWithin, type ReachResult, type WalkGrid } from './walk-grid.js';

export interface Issue {
  check: number;
  message: string;
  at?: Pos;
}

export interface ValidationReport {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  stats: { tiles: number; blocks: number; markers: Record<string, number>; durationMs: number };
}

export interface ValidationExtras {
  /** Check 6: tile files the export expected and actually wrote. */
  tiles?: { expected: string[]; written: string[] };
  /** Check 7: whether preview.png was written. */
  previewWritten?: boolean;
  /** Check 12: target-version compatibility warnings. */
  compat?: { message: string }[];
}

export const TILE_SIZE = 48;
const MIN_PLAYER_SPAWNS = 6;
const MIN_SPAWN_DISTANCE = 60;
const MIN_EXTRACTS = 4;
const TIER3_SQUAD_RADIUS = 32;
const MAX_LISTED = 20;

const fmt = (p: Pos) => `(${p[0]}, ${p[1]}, ${p[2]})`;

function describe(m: Marker): string {
  switch (m.kind) {
    case 'player_spawn':
      return `player spawn ${fmt(m.pos)}`;
    case 'extract':
      return `extract "${m.id}" ${fmt(m.pos)}`;
    case 'loot':
      return `loot ${m.type} tier ${m.tier} ${fmt(m.pos)}`;
    case 'enemy_spawn':
      return `enemy spawn tier ${m.tier} ${fmt(m.pos)}`;
    case 'patrol_route':
      return `patrol route "${m.id}"`;
  }
}

function pointsOf(m: Marker): Pos[] {
  return m.kind === 'patrol_route' ? m.points : [m.pos];
}

/**
 * Validates a raid map against the MOD requirements. Problems never stop an
 * export; they are reported as errors (requirement violations) or warnings.
 */
export function validateRaidMap(
  project: BuildProject,
  map: MapSettings,
  markers: readonly Marker[],
  extras: ValidationExtras = {}
): ValidationReport {
  const started = Date.now();
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const [sx, sy, sz] = map.size;
  const inMap = (p: Pos) => p[0] >= 0 && p[1] >= 0 && p[2] >= 0 && p[0] < sx && p[1] < sy && p[2] < sz;

  // 1. Everything inside the map.
  const valid = markers.filter((m) => {
    const outside = pointsOf(m).filter((p) => !inMap(p));
    for (const p of outside) errors.push({ check: 1, message: `${describe(m)}: point ${fmt(p)} is outside the map size ${sx}x${sy}x${sz}.`, at: p });
    return outside.length === 0;
  });
  const bbox = project.getBoundingBox();
  if (bbox && (bbox.min.x < 0 || bbox.min.y < 0 || bbox.min.z < 0 || bbox.max.x >= sx || bbox.max.y >= sy || bbox.max.z >= sz)) {
    let count = 0;
    let first: Pos | undefined;
    project.forEachBlock((pos) => {
      const p: Pos = [pos.x, pos.y, pos.z];
      if (!inMap(p)) {
        count++;
        first ??= p;
      }
    });
    warnings.push({ check: 1, message: `${count} block(s) lie outside the map and will not be exported (first at ${fmt(first!)}).`, at: first });
  }

  const grid: WalkGrid = buildWalkGrid(project, map.size);

  // 2. Standable points.
  const standableOk = new Set<Marker>();
  for (const m of valid) {
    if (m.kind === 'loot') continue;
    let ok = true;
    for (const p of pointsOf(m)) {
      if (!grid.standable(...p)) {
        ok = false;
        errors.push({
          check: 2,
          message: `${describe(m)}: ${fmt(p)} needs a solid block below and two free blocks above.`,
          at: p
        });
      }
    }
    if (ok) standableOk.add(m);
  }

  const playerSpawns = valid.filter((m): m is Extract<Marker, { kind: 'player_spawn' }> => m.kind === 'player_spawn');
  const extracts = valid.filter((m): m is Extract<Marker, { kind: 'extract' }> => m.kind === 'extract');

  // 3. Every player spawn reaches every extract.
  const spawnReach = new Map<Marker, ReachResult>();
  for (const spawn of playerSpawns) {
    if (!standableOk.has(spawn)) continue;
    const reach = explore(grid, spawn.pos);
    spawnReach.set(spawn, reach);
    for (const ex of extracts) {
      if (reachedWithin(reach, grid, ex.pos, ex.radius)) continue;
      const near = reach.nearest(ex.pos);
      errors.push({
        check: 3,
        message:
          `${describe(spawn)} cannot walk to ${describe(ex)}` +
          (near ? `; nearest reachable cell is ${fmt(near.pos)}, ${near.distance} blocks away.` : '.'),
        at: near?.pos
      });
    }
  }

  // 4. Patrol legs are walkable (error) and 2 wide (warning).
  const reachCache = new Map<string, ReachResult>();
  const wideCache = new Map<string, ReachResult>();
  const cached = (cache: Map<string, ReachResult>, p: Pos, wideOnly: boolean) => {
    const key = p.join(',');
    let r = cache.get(key);
    if (!r) {
      r = explore(grid, p, { wideOnly });
      cache.set(key, r);
    }
    return r;
  };
  for (const m of valid) {
    if (m.kind !== 'patrol_route' || !standableOk.has(m)) continue;
    for (let i = 0; i + 1 < m.points.length; i++) {
      const a = m.points[i];
      const b = m.points[i + 1];
      const reach = cached(reachCache, a, false);
      if (!reach.reached(b)) {
        const near = reach.nearest(b);
        errors.push({
          check: 4,
          message:
            `${describe(m)}: cannot walk from ${fmt(a)} to ${fmt(b)}` +
            (near ? `; nearest reachable cell is ${fmt(near.pos)}, ${near.distance} blocks away.` : '.'),
          at: near?.pos
        });
        continue;
      }
      if (!cached(wideCache, a, true).reached(b)) {
        const near = cached(wideCache, a, true).nearest(b);
        warnings.push({
          check: 4,
          message: `${describe(m)}: the leg ${fmt(a)} → ${fmt(b)} needs a 1-wide passage; enemy paths should be at least 2 wide` +
            (near ? ` (2-wide path ends near ${fmt(near.pos)}).` : ` (${fmt(a)} itself is not in a 2-wide area).`),
          at: near?.pos ?? a
        });
      }
    }
  }

  // 5. Loot cells are empty or a barrel.
  for (const m of valid) {
    if (m.kind !== 'loot') continue;
    const block = project.getBlock({ x: m.pos[0], y: m.pos[1], z: m.pos[2] });
    if (block && block.id !== 'minecraft:air' && block.id !== 'minecraft:barrel') {
      errors.push({ check: 5, message: `${describe(m)}: the cell holds ${block.id}; leave it empty or put a barrel.`, at: m.pos });
    }
  }

  // 6. Tiles.
  if (sx % TILE_SIZE !== 0 || sz % TILE_SIZE !== 0) {
    warnings.push({
      check: 6,
      message: `Map size ${sx}x${sz} is not a multiple of ${TILE_SIZE}, so edge tiles are smaller than ${TILE_SIZE}x${TILE_SIZE}. Sizes like 384, 432 or 480 avoid this.`
    });
  }
  if (extras.tiles) {
    const written = new Set(extras.tiles.written);
    const missing = extras.tiles.expected.filter((t) => !written.has(t));
    const expected = new Set(extras.tiles.expected);
    const extra = extras.tiles.written.filter((t) => !expected.has(t));
    if (missing.length > 0 || extra.length > 0) {
      errors.push({
        check: 6,
        message: `Tile files do not match the map size: missing ${missing.join(', ') || 'none'}; unexpected ${extra.join(', ') || 'none'}.`
      });
    }
  }

  // 7. Preview image.
  if (extras.previewWritten === false) errors.push({ check: 7, message: 'preview.png could not be written.' });

  // 8. Player spawn count and spacing.
  if (playerSpawns.length < MIN_PLAYER_SPAWNS) {
    warnings.push({ check: 8, message: `Only ${playerSpawns.length} player spawn(s); at least ${MIN_PLAYER_SPAWNS} are required.` });
  }
  for (let i = 0; i < playerSpawns.length; i++) {
    for (let j = i + 1; j < playerSpawns.length; j++) {
      const a = playerSpawns[i].pos;
      const b = playerSpawns[j].pos;
      const d = Math.hypot(a[0] - b[0], a[2] - b[2]);
      if (d < MIN_SPAWN_DISTANCE) {
        warnings.push({
          check: 8,
          message: `Player spawns ${fmt(a)} and ${fmt(b)} are ${Math.round(d)} blocks apart; keep them at least ${MIN_SPAWN_DISTANCE} apart.`,
          at: b
        });
      }
    }
  }

  // 9. Extract count.
  if (extracts.length < MIN_EXTRACTS) {
    warnings.push({ check: 9, message: `Only ${extracts.length} extract(s); at least ${MIN_EXTRACTS} are required.` });
  }

  // 10. Tier 3 loot is guarded by a tier 3 squad.
  const tier3Squads = valid.filter((m) => m.kind === 'enemy_spawn' && m.tier === 3).map((m) => (m as { pos: Pos }).pos);
  for (const m of valid) {
    if (m.kind !== 'loot' || m.tier !== 3) continue;
    const guarded = tier3Squads.some((p) => Math.hypot(p[0] - m.pos[0], p[1] - m.pos[1], p[2] - m.pos[2]) <= TIER3_SQUAD_RADIUS);
    if (!guarded) {
      warnings.push({ check: 10, message: `${describe(m)} has no tier 3 enemy spawn within ${TIER3_SQUAD_RADIUS} blocks.`, at: m.pos });
    }
  }

  // 11. Players must not reach the map edge.
  edge: for (const reach of spawnReach.values()) {
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        if (x !== 0 && z !== 0 && x !== sx - 1 && z !== sz - 1) continue;
        for (let y = 0; y < sy; y++) {
          if (grid.standable(x, y, z) && reach.reached([x, y, z])) {
            warnings.push({
              check: 11,
              message: `Players can walk onto the map edge at ${fmt([x, y, z])}; close the perimeter with a wall or terrain.`,
              at: [x, y, z]
            });
            break edge;
          }
        }
      }
    }
  }

  // 12. Target version compatibility.
  for (const c of extras.compat ?? []) warnings.push({ check: 12, message: c.message });

  // 13. Isolated panes.
  const isolated = findIsolatedConnectables(project);
  if (isolated.length > 0) {
    const first = isolated[0];
    warnings.push({
      check: 13,
      message: `${isolated.length} isolated glass pane/bar block(s) will render as thin posts (first at ${fmt([first.x, first.y, first.z])}).`,
      at: [first.x, first.y, first.z]
    });
  }

  const counts: Record<string, number> = {};
  for (const m of markers) counts[m.kind] = (counts[m.kind] ?? 0) + 1;
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      tiles: Math.ceil(sx / TILE_SIZE) * Math.ceil(sz / TILE_SIZE),
      blocks: project.blockCount,
      markers: counts,
      durationMs: Date.now() - started
    }
  };
}

function listIssues(label: string, issues: Issue[]): string[] {
  if (issues.length === 0) return [];
  const lines = issues.slice(0, MAX_LISTED).map((i) => `- [${i.check}] ${i.message}`);
  if (issues.length > MAX_LISTED) lines.push(`- ... and ${issues.length - MAX_LISTED} more ${label}`);
  return [`${label[0].toUpperCase()}${label.slice(1)}:`, ...lines];
}

/** Short text summary for tool results: status line, then up to 20 errors and 20 warnings. */
export function formatReport(report: ValidationReport): string {
  const head = report.ok && report.warnings.length === 0
    ? 'OK: all checks passed.'
    : report.ok
      ? `OK with ${report.warnings.length} warning(s).`
      : `${report.errors.length} error(s), ${report.warnings.length} warning(s).`;
  return [head, ...listIssues('errors', report.errors), ...listIssues('warnings', report.warnings)].join('\n');
}
