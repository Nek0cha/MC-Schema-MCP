import { blockStateKey, type BlockState } from '../../core/types.js';
import { selectModels, type ModelRef } from './blockstate.js';
import { resolveModel, resolveTexture, stripNamespace, type ModelElement } from './model.js';
import { renderTypeOf, tintOf } from './render-type.js';
import { FACES, type BakedModel, type BakedQuad, type Face, type ModelSource } from './types.js';

type V3 = [number, number, number];
type UV = [number, number];

const AIR_IDS = new Set(['air', 'cave_air', 'void_air']);
export const MISSING_TEXTURE = '#missing';

/**
 * Corners of each face in the order top-left, bottom-left, bottom-right,
 * top-right as seen from outside (counter-clockwise). Values pick from
 * [from, to] per axis: 0 = from, 1 = to.
 */
const FACE_CORNERS: Record<Face, [number, number, number][]> = {
  north: [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]],
  south: [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]],
  east: [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]],
  west: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]],
  up: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  down: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]]
};

const FACE_NORMAL: Record<Face, V3> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0]
};

/** Vanilla's default UV rectangle (0..16) for a face of the box from..to. */
function defaultUv(face: Face, from: V3, to: V3): [number, number, number, number] {
  switch (face) {
    case 'down':
      return [from[0], 16 - to[2], to[0], 16 - from[2]];
    case 'up':
      return [from[0], from[2], to[0], to[2]];
    case 'north':
      return [16 - to[0], 16 - to[1], 16 - from[0], 16 - from[1]];
    case 'south':
      return [from[0], 16 - to[1], to[0], 16 - from[1]];
    case 'west':
      return [from[2], 16 - to[1], to[2], 16 - from[1]];
    case 'east':
      return [16 - to[2], 16 - to[1], 16 - from[2], 16 - from[1]];
  }
}

function faceFromNormal(n: V3): Face {
  const [x, y, z] = n;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ay >= ax && ay >= az) return y > 0 ? 'up' : 'down';
  if (ax >= az) return x > 0 ? 'east' : 'west';
  return z > 0 ? 'south' : 'north';
}

function rotateFaceDir(face: Face, rotate: (v: V3) => V3): Face {
  return faceFromNormal(rotate(FACE_NORMAL[face]));
}

/** Rotation by the element's own rotation block (about `origin`, right-handed, degrees). */
function elementRotator(rot: NonNullable<ModelElement['rotation']>): (p: V3) => V3 {
  const rad = (rot.angle * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const scale = rot.rescale && Math.abs(c) > 1e-9 ? 1 / c : 1;
  const o = rot.origin.map((v) => v / 16) as V3;
  return ([x, y, z]) => {
    const dx = x - o[0];
    const dy = y - o[1];
    const dz = z - o[2];
    switch (rot.axis) {
      case 'x':
        return [o[0] + dx, o[1] + (dy * c - dz * s) * scale, o[2] + (dy * s + dz * c) * scale];
      case 'y':
        return [o[0] + (dx * c + dz * s) * scale, o[1] + dy, o[2] + (-dx * s + dz * c) * scale];
      case 'z':
        return [o[0] + (dx * c - dy * s) * scale, o[1] + (dx * s + dy * c) * scale, o[2] + dz];
    }
  };
}

/**
 * Variant rotation about the block centre. x first, then y; y turns
 * clockwise seen from above (east → south), x=90 turns north → down.
 */
function variantRotator(xDeg: number, yDeg: number): (p: V3) => V3 {
  const xTurns = (((xDeg / 90) % 4) + 4) % 4;
  const yTurns = (((yDeg / 90) % 4) + 4) % 4;
  return (p) => {
    let x = p[0] - 0.5;
    let y = p[1] - 0.5;
    let z = p[2] - 0.5;
    for (let i = 0; i < xTurns; i++) [y, z] = [z, -y];
    for (let i = 0; i < yTurns; i++) [x, z] = [-z, x];
    return [x + 0.5, y + 0.5, z + 0.5];
  };
}

function directionRotator(xDeg: number, yDeg: number): (v: V3) => V3 {
  const rotate = variantRotator(xDeg, yDeg);
  const origin = rotate([0, 0, 0]);
  return (v) => {
    const p = rotate(v);
    return [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
  };
}

const clean = (n: number): number => {
  const r = Math.round(n * 1e6) / 1e6;
  return r === 0 ? 0 : r;
};

/** UV (0..1) a uvlocked face gets from its world position: vanilla default UVs of the final face. */
function lockedUv(face: Face, p: V3): UV {
  const [x, y, z] = p;
  switch (face) {
    case 'up':
      return [x, z];
    case 'down':
      return [x, 1 - z];
    case 'north':
      return [1 - x, 1 - y];
    case 'south':
      return [x, 1 - y];
    case 'west':
      return [z, 1 - y];
    case 'east':
      return [1 - z, 1 - y];
  }
}

function bakeElements(
  elements: ModelElement[],
  textures: Record<string, string>,
  ref: ModelRef,
  tint: BakedQuad['tint']
): BakedQuad[] {
  const rotate = variantRotator(ref.x, ref.y);
  const rotateDir = directionRotator(ref.x, ref.y);
  const quads: BakedQuad[] = [];
  for (const el of elements) {
    const from = el.from;
    const to = el.to;
    const elementRotate = el.rotation ? elementRotator(el.rotation) : undefined;
    for (const face of FACES) {
      const f = el.faces[face];
      if (!f) continue;
      const texture = resolveTexture(f.texture, textures) ?? MISSING_TEXTURE;
      const [u1, v1, u2, v2] = f.uv ?? defaultUv(face, from, to);
      const corners: UV[] = [
        [u1 / 16, v1 / 16],
        [u1 / 16, v2 / 16],
        [u2 / 16, v2 / 16],
        [u2 / 16, v1 / 16]
      ];
      const uvShift = ((((f.rotation ?? 0) / 90) % 4) + 4) % 4;
      const finalFace = rotateFaceDir(face, (v) => rotateDir(elementRotate ? sub(elementRotate(v), elementRotate([0, 0, 0])) : v));
      const positions: V3[] = [];
      const uvs: UV[] = [];
      FACE_CORNERS[face].forEach((pick, i) => {
        let p: V3 = [
          (pick[0] ? to[0] : from[0]) / 16,
          (pick[1] ? to[1] : from[1]) / 16,
          (pick[2] ? to[2] : from[2]) / 16
        ];
        if (elementRotate) p = elementRotate(p);
        p = rotate(p).map(clean) as V3;
        positions.push(p);
        uvs.push(ref.uvlock && !elementRotate ? (lockedUv(finalFace, p).map(clean) as UV) : corners[(i + uvShift) % 4]);
      });
      quads.push({
        positions,
        uvs,
        texture,
        tint: f.tintindex !== undefined ? tint : 'none',
        ...(f.cullface ? { cullface: rotateFaceDir(f.cullface, rotateDir) } : {}),
        shadeFace: el.shade === false ? null : finalFace
      });
    }
  }
  return quads;
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Axis-aligned box quads (0..1 coordinates) with one texture, used for fluids, entities and missing models. */
function boxQuads(min: V3, max: V3, texture: string, tint: BakedQuad['tint'], cull: boolean): BakedQuad[] {
  return FACES.map((face) => {
    const positions = FACE_CORNERS[face].map(
      (pick) => [pick[0] ? max[0] : min[0], pick[1] ? max[1] : min[1], pick[2] ? max[2] : min[2]].map(clean) as V3
    );
    const uvs: UV[] = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0]
    ];
    return { positions, uvs, texture, tint, ...(cull ? { cullface: face } : {}), shadeFace: face };
  });
}

/** Directions whose 1x1 block face is fully covered by the given quads (rasterised on a 16x16 grid). */
function computeFullFaces(quads: BakedQuad[]): Face[] {
  const full: Face[] = [];
  for (const face of FACES) {
    const normal = FACE_NORMAL[face];
    const axis = normal[0] !== 0 ? 0 : normal[1] !== 0 ? 1 : 2;
    const plane = normal[axis] > 0 ? 1 : 0;
    const [a, b] = [0, 1, 2].filter((i) => i !== axis);
    const covered = new Uint8Array(256);
    for (const q of quads) {
      if (!q.positions.every((p) => Math.abs(p[axis] - plane) < 1e-6)) continue;
      if (faceFromNormal(quadNormal(q)) !== face) continue;
      const amin = Math.min(...q.positions.map((p) => p[a]));
      const amax = Math.max(...q.positions.map((p) => p[a]));
      const bmin = Math.min(...q.positions.map((p) => p[b]));
      const bmax = Math.max(...q.positions.map((p) => p[b]));
      for (let i = Math.round(amin * 16); i < Math.round(amax * 16); i++) {
        for (let j = Math.round(bmin * 16); j < Math.round(bmax * 16); j++) covered[i * 16 + j] = 1;
      }
    }
    if (covered.every((c) => c === 1)) full.push(face);
  }
  return full;
}

function quadNormal(q: BakedQuad): V3 {
  const [p0, p1, p2] = q.positions;
  const u = sub(p1, p0);
  const v = sub(p2, p1);
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

function unresolved(): BakedModel {
  return {
    quads: boxQuads([0, 0, 0], [1, 1, 1], MISSING_TEXTURE, 'none', true),
    fullFaces: [...FACES],
    renderType: 'opaque',
    status: 'unresolved'
  };
}

function bakeUncached(block: BlockState, src: ModelSource): BakedModel {
  const name = stripNamespace(block.id);
  if (AIR_IDS.has(name)) return { quads: [], fullFaces: [], renderType: 'cutout', status: 'ok' };
  if (name === 'water' || name === 'lava') {
    const water = name === 'water';
    return {
      quads: boxQuads([0, 0, 0], [1, 14 / 16, 1], water ? 'block/water_still' : 'block/lava_still', water ? 'water' : 'none', true),
      fullFaces: [],
      renderType: water ? 'translucent' : 'opaque',
      status: 'fluid'
    };
  }

  const refs = selectModels(src.readJson(`blockstates/${name}.json`), block.properties ?? {});
  if (!refs) return unresolved();

  const renderType = renderTypeOf(block.id);
  const tint = tintOf(block.id);
  const quads: BakedQuad[] = [];
  for (const ref of refs) {
    const model = resolveModel(ref.model, src);
    if (model.kind === 'missing') return unresolved();
    if (model.kind === 'entity') {
      const inset = 1 / 16;
      return {
        quads: boxQuads([inset, 0, inset], [1 - inset, 1 - inset, 1 - inset], model.particle ?? MISSING_TEXTURE, 'none', false),
        fullFaces: [],
        renderType,
        status: 'entity'
      };
    }
    quads.push(...bakeElements(model.elements, model.textures, ref, tint));
  }
  return { quads, fullFaces: renderType === 'opaque' ? computeFullFaces(quads) : [], renderType, status: 'ok' };
}

const caches = new WeakMap<ModelSource, Map<string, BakedModel>>();

/** Bakes a block state into quads; results are cached per source and state string. */
export function bakeBlockState(block: BlockState, src: ModelSource): BakedModel {
  let cache = caches.get(src);
  if (!cache) {
    cache = new Map();
    caches.set(src, cache);
  }
  const key = blockStateKey(block);
  let baked = cache.get(key);
  if (!baked) {
    baked = bakeUncached(block, src);
    cache.set(key, baked);
  }
  return baked;
}
