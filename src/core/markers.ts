/**
 * Raid-map metadata stored alongside a project: map settings and markers.
 * `pos` is the cell the feet occupy (for loot: the cell the crate goes in).
 */
export type Pos = [number, number, number];

export type TargetVersion = '1.21.1' | '1.21.11';

export interface MapSettings {
  id: string;
  name: string;
  size: Pos;
  targetVersion: TargetVersion;
  includeAir: boolean;
}

export type LootType = 'crate' | 'safe' | 'weapon_case' | 'medical';
export type Tier = 1 | 2 | 3;

export interface PlayerSpawnMarker {
  kind: 'player_spawn';
  pos: Pos;
  /** Minecraft yaw: 0 = south, 90 = west, 180 = north, 270 = east. */
  facing: number;
}

export interface ExtractMarker {
  kind: 'extract';
  id: string;
  pos: Pos;
  radius: number;
}

export interface LootMarker {
  kind: 'loot';
  pos: Pos;
  type: LootType;
  tier: Tier;
}

export interface EnemySpawnMarker {
  kind: 'enemy_spawn';
  pos: Pos;
  squadSize: [number, number];
  tier: Tier;
}

export interface PatrolRouteMarker {
  kind: 'patrol_route';
  id: string;
  points: Pos[];
}

export type Marker = PlayerSpawnMarker | ExtractMarker | LootMarker | EnemySpawnMarker | PatrolRouteMarker;
export type MarkerKind = Marker['kind'];

/** A stored marker with its internal id ("m1", "m2", ...). */
export type StoredMarker = Marker & { markerId: string };
