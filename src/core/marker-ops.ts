import type { EnemySpawnMarker, LootMarker, Pos } from './markers.js';
import { transformOffset, type Transform } from './transform.js';

/** The marker kinds that travel inside templates. */
export type TemplateMarker = LootMarker | EnemySpawnMarker;

export function isTemplateMarker<M extends { kind: string }>(m: M): m is Extract<M, { kind: 'loot' | 'enemy_spawn' }> {
  return m.kind === 'loot' || m.kind === 'enemy_spawn';
}

/**
 * Moves a template marker into the world. `m.pos` is an offset from the
 * template anchor; it is flipped/rotated like block offsets, then handed to
 * `toWorld`, which adds the placement point.
 */
export function transformMarker<M extends TemplateMarker>(m: M, toWorld: (offset: Pos) => Pos, t: Transform): M {
  const o = transformOffset({ x: m.pos[0], y: m.pos[1], z: m.pos[2] }, t);
  return { ...m, pos: toWorld([o.x, o.y, o.z]) };
}
