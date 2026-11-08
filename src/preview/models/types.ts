/**
 * Shared types for baked block models. This module has no runtime imports so
 * the browser-side mesher can import it by relative path.
 */
export type Face = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';
export type Tint = 'none' | 'grass' | 'foliage' | 'water';
export type RenderType = 'opaque' | 'cutout' | 'translucent';

export const FACES: readonly Face[] = ['north', 'south', 'east', 'west', 'up', 'down'];

export interface BakedQuad {
  /** 4 vertices in block-local coordinates (0..1), counter-clockwise seen from the front. */
  positions: [number, number, number][];
  /** 4 texture coordinates in 0..1 within the single texture, v pointing down the image. */
  uvs: [number, number][];
  /** Texture name such as "block/oak_planks"; "#missing" for the magenta/black checker. */
  texture: string;
  tint: Tint;
  /** Skip this quad when the neighbour in this direction fully covers the shared face. */
  cullface?: Face;
  /** Direction used for the fixed face shading, or null for shade:false. */
  shadeFace: Face | null;
}

export interface BakedModel {
  quads: BakedQuad[];
  /** Directions whose block face is completely covered by opaque quads. */
  fullFaces: Face[];
  renderType: RenderType;
  status: 'ok' | 'unresolved' | 'entity' | 'fluid';
}

export interface ModelSource {
  /** Reads a JSON file relative to assets/minecraft, e.g. "blockstates/stone.json". */
  readJson(relPath: string): unknown | undefined;
}
