/**
 * Builds vertex buffers for one 16^3 chunk. Pure and DOM-free: it runs in a
 * Web Worker in the browser and under vitest in Node. Only type imports are
 * allowed here (module workers can't rely on import maps).
 */
import type { BakedModel, Face, RenderType, Tint } from '../models/types.js';

export type RGB = [number, number, number];
export type Rect = [number, number, number, number];

export interface MeshInput {
  cx: number;
  cy: number;
  cz: number;
  /** 4096 display-palette ids, index (y * 16 + z) * 16 + x; 0 is empty. */
  cells: Uint16Array;
  /** Adjacent chunks; a missing one counts as air. */
  neighbors: Partial<Record<Face, Uint16Array>>;
  /** Display-palette id → baked model (index 0 is null). */
  models: (BakedModel | null)[];
  /** Display-palette id → group name; touching cells of the same non-null group hide their shared faces (glass, water). */
  cullGroups?: (string | null)[];
  /** Cells with world y above this are not drawn. */
  clipY?: number;
  /** Atlas rectangle [u0, v0, u1, v1] of a texture, or undefined when the atlas lacks it. */
  uvRect: (texture: string) => Rect | undefined;
  tintColor: (tint: Tint) => RGB;
  /** Used for quads whose texture is not in the atlas: a plain atlas area and a per-id color. */
  fallback?: { rect: Rect; color: (id: number) => RGB };
}

export interface MeshBuffers {
  positions: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

export type MeshOutput = Record<RenderType, MeshBuffers>;

export const FACE_SHADE: Record<Face, number> = { up: 1, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 };

const OPPOSITE: Record<Face, Face> = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
const OFFSET: Record<Face, [number, number, number]> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0]
};

class Builder {
  positions: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  finish(): MeshBuffers {
    return {
      positions: new Float32Array(this.positions),
      uvs: new Float32Array(this.uvs),
      colors: new Float32Array(this.colors),
      indices: new Uint32Array(this.indices)
    };
  }
}

const cellIndex = (x: number, y: number, z: number) => (y * 16 + z) * 16 + x;

export function meshChunk(input: MeshInput): MeshOutput {
  const { cells, neighbors, models, cullGroups, clipY, uvRect, tintColor, fallback } = input;
  const ox = input.cx * 16;
  const oy = input.cy * 16;
  const oz = input.cz * 16;
  const builders: Record<RenderType, Builder> = { opaque: new Builder(), cutout: new Builder(), translucent: new Builder() };
  const clipped = (localY: number) => clipY !== undefined && oy + localY > clipY;

  /** Display id of the cell next to (x, y, z) in direction `face`, crossing into neighbor chunks. */
  function neighborId(x: number, y: number, z: number, face: Face): number {
    const [dx, dy, dz] = OFFSET[face];
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (clipped(ny)) return 0;
    if (nx >= 0 && nx < 16 && ny >= 0 && ny < 16 && nz >= 0 && nz < 16) return cells[cellIndex(nx, ny, nz)];
    const other = neighbors[face];
    if (!other) return 0;
    return other[cellIndex((nx + 16) % 16, (ny + 16) % 16, (nz + 16) % 16)];
  }

  for (let y = 0; y < 16; y++) {
    if (clipped(y)) break;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const id = cells[cellIndex(x, y, z)];
        if (id === 0) continue;
        const model = models[id];
        if (!model || model.quads.length === 0) continue;
        const group = cullGroups?.[id] ?? null;
        const builder = builders[model.renderType];
        for (const quad of model.quads) {
          if (quad.cullface) {
            const nid = neighborId(x, y, z, quad.cullface);
            if (nid !== 0) {
              const nm = models[nid];
              if (nm && nm.fullFaces.includes(OPPOSITE[quad.cullface])) continue;
              if (group !== null && cullGroups?.[nid] === group) continue;
            }
          }
          let rect = uvRect(quad.texture);
          let base: RGB = tintColor(quad.tint);
          if (!rect && fallback) {
            rect = fallback.rect;
            const c = fallback.color(id);
            base = [base[0] * c[0], base[1] * c[1], base[2] * c[2]];
          }
          const [u0, v0, u1, v1] = rect ?? [0, 0, 0, 0];
          const shade = quad.shadeFace ? FACE_SHADE[quad.shadeFace] : 1;
          const start = builder.positions.length / 3;
          for (let i = 0; i < 4; i++) {
            const p = quad.positions[i];
            builder.positions.push(ox + x + p[0], oy + y + p[1], oz + z + p[2]);
            const uv = quad.uvs[i];
            builder.uvs.push(u0 + uv[0] * (u1 - u0), v0 + uv[1] * (v1 - v0));
            builder.colors.push(base[0] * shade, base[1] * shade, base[2] * shade);
          }
          builder.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
        }
      }
    }
  }

  return { opaque: builders.opaque.finish(), cutout: builders.cutout.finish(), translucent: builders.translucent.finish() };
}
