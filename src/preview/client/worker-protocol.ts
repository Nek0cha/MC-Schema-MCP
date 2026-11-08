/**
 * Messages exchanged between the viewer (main thread) and the mesh workers.
 * Type-only imports, so the compiled worker has no runtime dependencies beyond mesher.js.
 */
import type { BakedModel } from '../models/types.js';
import type { MeshBuffers, Rect } from './mesher.js';

export interface PaletteEntryMessage {
  id: number;
  /** Block state string such as "minecraft:oak_fence[east=true]". */
  key: string;
  model: BakedModel | null;
  cullGroup: string | null;
  /** Fallback color as #rrggbb. */
  color: string;
}

export type ToWorker =
  /** Forget every palette entry (the server re-baked its palette). */
  | { type: 'reset' }
  | { type: 'palette'; entries: PaletteEntryMessage[] }
  /** Atlas rectangles by texture name; an empty map means "no textures, use fallback colors". */
  | { type: 'atlas'; rects: Record<string, Rect>; white: Rect }
  | {
      type: 'mesh';
      key: string;
      seq: number;
      cx: number;
      cy: number;
      cz: number;
      cells: Uint16Array;
      neighbors: Partial<Record<'north' | 'south' | 'east' | 'west' | 'up' | 'down', Uint16Array>>;
      clipY: number | undefined;
    };

export interface MeshedMessage {
  type: 'meshed';
  key: string;
  seq: number;
  /** World position of the chunk center; the buffers' positions are relative to it. */
  center: [number, number, number];
  opaque: MeshBuffers;
  cutout: MeshBuffers;
  translucent: MeshBuffers;
}
