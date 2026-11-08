import type { MapSettings, Marker, StoredMarker } from './markers.js';
import { blockStateKey, type BlockState, type Vec3 } from './types.js';

export interface BoundingBox {
  min: Vec3;
  max: Vec3;
}

export const CHUNK_SIZE = 16;
const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;
const MAX_PALETTE_ENTRIES = 65535;

export function voxelKey(pos: Vec3): string {
  return `${pos.x},${pos.y},${pos.z}`;
}

export function parseVoxelKey(key: string): Vec3 {
  const [x, y, z] = key.split(',').map(Number);
  return { x, y, z };
}

export function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

export function parseChunkKey(key: string): { cx: number; cy: number; cz: number } {
  const [cx, cy, cz] = key.split(',').map(Number);
  return { cx, cy, cz };
}

/**
 * Voxel store backed by 16^3 chunks of Uint16Array palette indices.
 * Index 0 means "unset"; palette entries are append-only and numbered from 1.
 * Cell order inside a chunk: index = (ly * 16 + lz) * 16 + lx.
 */
export class BuildProject {
  readonly name: string;

  private readonly chunks = new Map<string, Uint16Array>();
  private readonly chunkCounts = new Map<string, number>();
  private readonly dirty = new Set<string>();
  private readonly palette: (BlockState | null)[] = [null];
  private readonly paletteIndex = new Map<string, number>();
  private readonly paletteCounts: number[] = [0];
  private total = 0;
  private rev = 0;
  private readonly chunkRevisions = new Map<string, number>();
  private readonly removedRevisions = new Map<string, number>();
  private bboxCache: BoundingBox | null | undefined;
  private markers: StoredMarker[] = [];
  private nextMarkerId = 1;
  private markersChanged = false;

  /** Raid map settings; null until setMapSettings is called. Saved in project.json. */
  mapSettings: MapSettings | null = null;

  // Hot-path caches for consecutive writes.
  private lastKey: string | null = null;
  private lastCx = 0;
  private lastCy = 0;
  private lastCz = 0;
  private lastChunk: Uint16Array | null = null;
  private lastBlock: BlockState | null = null;
  private lastBlockId = 0;

  constructor(name: string) {
    this.name = name;
  }

  setBlock(pos: Vec3, block: BlockState): void {
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    const cx = x >> 4;
    const cy = y >> 4;
    const cz = z >> 4;
    const paletteId = this.resolvePaletteId(block);
    let chunk: Uint16Array;
    let key: string;
    if (this.lastChunk !== null && cx === this.lastCx && cy === this.lastCy && cz === this.lastCz) {
      chunk = this.lastChunk;
      key = this.lastKey as string;
    } else {
      key = chunkKey(cx, cy, cz);
      let found = this.chunks.get(key);
      if (!found) {
        found = new Uint16Array(CHUNK_VOLUME);
        this.chunks.set(key, found);
        this.chunkCounts.set(key, 0);
      }
      chunk = found;
      this.lastChunk = chunk;
      this.lastKey = key;
      this.lastCx = cx;
      this.lastCy = cy;
      this.lastCz = cz;
    }
    const idx = (((y & 15) << 4) + (z & 15)) * 16 + (x & 15);
    const old = chunk[idx];
    if (old === paletteId) return;
    chunk[idx] = paletteId;
    this.bboxCache = undefined;
    this.dirty.add(key);
    this.chunkRevisions.set(key, ++this.rev);
    this.removedRevisions.delete(key);
    if (old === 0) {
      this.chunkCounts.set(key, (this.chunkCounts.get(key) as number) + 1);
      this.total++;
    } else {
      this.paletteCounts[old]--;
    }
    this.paletteCounts[paletteId]++;
  }

  getBlock(pos: Vec3): Readonly<BlockState> | undefined {
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    const chunk = this.chunks.get(chunkKey(x >> 4, y >> 4, z >> 4));
    if (!chunk) return undefined;
    const v = chunk[(((y & 15) << 4) + (z & 15)) * 16 + (x & 15)];
    return v === 0 ? undefined : (this.palette[v] as BlockState);
  }

  removeBlock(pos: Vec3): void {
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    const key = chunkKey(x >> 4, y >> 4, z >> 4);
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    const idx = (((y & 15) << 4) + (z & 15)) * 16 + (x & 15);
    const old = chunk[idx];
    if (old === 0) return;
    chunk[idx] = 0;
    this.paletteCounts[old]--;
    this.total--;
    this.bboxCache = undefined;
    this.dirty.add(key);
    const revision = ++this.rev;
    const remaining = (this.chunkCounts.get(key) as number) - 1;
    if (remaining === 0) {
      this.chunks.delete(key);
      this.chunkCounts.delete(key);
      this.chunkRevisions.delete(key);
      this.removedRevisions.set(key, revision);
      this.lastChunk = null;
      this.lastKey = null;
    } else {
      this.chunkCounts.set(key, remaining);
      this.chunkRevisions.set(key, revision);
    }
  }

  /** Monotonic counter, bumped on every real cell change. Memory only; never persisted. */
  get revision(): number {
    return this.rev;
  }

  /** Chunks last changed after `since`; chunks that became empty and were dropped are flagged removed. */
  getChunkRevisionsSince(since: number): { key: string; revision: number; removed: boolean }[] {
    const out: { key: string; revision: number; removed: boolean }[] = [];
    for (const [key, revision] of this.chunkRevisions) {
      if (revision > since) out.push({ key, revision, removed: false });
    }
    for (const [key, revision] of this.removedRevisions) {
      if (revision > since) out.push({ key, revision, removed: true });
    }
    return out;
  }

  forEachBlock(cb: (pos: Vec3, block: Readonly<BlockState>) => void): void {
    for (const [key, chunk] of this.chunks) {
      const { cx, cy, cz } = parseChunkKey(key);
      const ox = cx << 4;
      const oy = cy << 4;
      const oz = cz << 4;
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        const v = chunk[i];
        if (v === 0) continue;
        cb({ x: ox + (i & 15), y: oy + (i >> 8), z: oz + ((i >> 4) & 15) }, this.palette[v] as BlockState);
      }
    }
  }

  get blockCount(): number {
    return this.total;
  }

  getBoundingBox(): BoundingBox | null {
    if (this.bboxCache !== undefined) return this.bboxCache;
    if (this.total === 0) {
      this.bboxCache = null;
      return null;
    }
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const [key, chunk] of this.chunks) {
      const { cx, cy, cz } = parseChunkKey(key);
      const ox = cx << 4;
      const oy = cy << 4;
      const oz = cz << 4;
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        if (chunk[i] === 0) continue;
        const x = ox + (i & 15);
        const y = oy + (i >> 8);
        const z = oz + ((i >> 4) & 15);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }
    }
    this.bboxCache = { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
    return this.bboxCache;
  }

  /** Every distinct block state in use with how many cells hold it (cheap: no grid scan). */
  getStateCounts(): { block: Readonly<BlockState>; count: number }[] {
    const out: { block: Readonly<BlockState>; count: number }[] = [];
    for (let i = 1; i < this.palette.length; i++) {
      if (this.paletteCounts[i] > 0) out.push({ block: this.palette[i] as BlockState, count: this.paletteCounts[i] });
    }
    return out;
  }

  getBlockCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (let i = 1; i < this.palette.length; i++) {
      const n = this.paletteCounts[i];
      if (n > 0) {
        const id = (this.palette[i] as BlockState).id;
        counts[id] = (counts[id] ?? 0) + n;
      }
    }
    return counts;
  }

  // --- markers ---

  getMarkers(): readonly StoredMarker[] {
    return this.markers;
  }

  /**
   * Adds markers and returns their internal ids ("m1", "m2", ...). `extract.id` and
   * `patrol_route.id` must be unique per kind. If any marker is invalid, none is added.
   */
  addMarkers(markers: Marker[]): string[] {
    const seen = {
      extract: new Set(this.markers.flatMap((m) => (m.kind === 'extract' ? [m.id] : []))),
      patrol_route: new Set(this.markers.flatMap((m) => (m.kind === 'patrol_route' ? [m.id] : [])))
    };
    for (const m of markers) {
      if (m.kind !== 'extract' && m.kind !== 'patrol_route') continue;
      const ids = seen[m.kind];
      if (ids.has(m.id)) throw new Error(`Duplicate ${m.kind} id "${m.id}". Ids must be unique per kind.`);
      ids.add(m.id);
    }
    const ids: string[] = [];
    for (const m of markers) {
      const markerId = `m${this.nextMarkerId++}`;
      this.markers.push({ ...m, markerId } as StoredMarker);
      ids.push(markerId);
    }
    if (ids.length > 0) this.markersChanged = true;
    return ids;
  }

  /** Removes markers by internal id and returns how many existed. Ids are never reused. */
  removeMarkers(ids: string[]): number {
    const wanted = new Set(ids);
    const before = this.markers.length;
    this.markers = this.markers.filter((m) => !wanted.has(m.markerId));
    const removed = before - this.markers.length;
    if (removed > 0) this.markersChanged = true;
    return removed;
  }

  /** True when the markers changed since they were last saved or restored. */
  get markersDirty(): boolean {
    return this.markersChanged;
  }

  /** The number the next marker id will get ("m<n>"); persisted so ids are never reused. */
  get nextMarkerNumber(): number {
    return this.nextMarkerId;
  }

  clearMarkersDirty(): void {
    this.markersChanged = false;
  }

  /** Replaces the markers with stored ones (used when loading). Leaves the markers clean. */
  restoreMarkers(markers: StoredMarker[], nextId: number): void {
    this.markers = markers;
    this.nextMarkerId = nextId;
    this.markersChanged = false;
  }

  // --- persistence support ---

  getPalette(): readonly (Readonly<BlockState> | null)[] {
    return this.palette;
  }

  getChunk(key: string): Uint16Array | undefined {
    return this.chunks.get(key);
  }

  /** Chunks changed since the last clearDirty, including chunks that became empty and were dropped. */
  getDirtyChunkKeys(): string[] {
    return [...this.dirty];
  }

  clearDirty(keys: Iterable<string>): void {
    for (const key of keys) this.dirty.delete(key);
  }

  static fromStored(
    name: string,
    palette: (BlockState | null)[],
    chunks: Map<string, Uint16Array>
  ): BuildProject {
    const project = new BuildProject(name);
    for (let i = 1; i < palette.length; i++) {
      const entry = palette[i];
      if (!entry) throw new Error(`Palette entry ${i} is missing.`);
      project.palette.push(entry);
      project.paletteIndex.set(blockStateKey(entry), i);
      project.paletteCounts.push(0);
    }
    for (const [key, chunk] of chunks) {
      if (chunk.length !== CHUNK_VOLUME) throw new Error(`Chunk ${key} has an invalid length.`);
      let count = 0;
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        const v = chunk[i];
        if (v === 0) continue;
        if (v >= project.palette.length) throw new Error(`Chunk ${key} references unknown palette index ${v}.`);
        project.paletteCounts[v]++;
        count++;
      }
      if (count === 0) continue;
      project.chunks.set(key, chunk);
      project.chunkCounts.set(key, count);
      project.total += count;
      project.chunkRevisions.set(key, 1);
    }
    project.rev = 1;
    return project;
  }

  private resolvePaletteId(block: BlockState): number {
    if (block === this.lastBlock) return this.lastBlockId;
    const key = blockStateKey(block);
    let id = this.paletteIndex.get(key);
    if (id === undefined) {
      if (this.palette.length > MAX_PALETTE_ENTRIES) {
        throw new Error(`Block palette limit exceeded (max ${MAX_PALETTE_ENTRIES} distinct block states).`);
      }
      id = this.palette.length;
      this.palette.push({ id: block.id, ...(block.properties ? { properties: { ...block.properties } } : {}) });
      this.paletteIndex.set(key, id);
      this.paletteCounts.push(0);
    }
    this.lastBlock = block;
    this.lastBlockId = id;
    return id;
  }
}
