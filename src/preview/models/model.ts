import type { Face, ModelSource } from './types.js';

export interface ModelFace {
  texture: string;
  uv?: [number, number, number, number];
  rotation?: number;
  cullface?: Face;
  tintindex?: number;
}

export interface ModelElement {
  from: [number, number, number];
  to: [number, number, number];
  rotation?: { origin: [number, number, number]; axis: 'x' | 'y' | 'z'; angle: number; rescale?: boolean };
  shade?: boolean;
  faces: Partial<Record<Face, ModelFace>>;
}

export type ResolvedModel =
  | { kind: 'elements'; elements: ModelElement[]; textures: Record<string, string> }
  | { kind: 'entity'; particle?: string }
  | { kind: 'missing'; reason: string };

/** "minecraft:block/stone" or "block/stone" → "block/stone". */
export function stripNamespace(name: string): string {
  const i = name.indexOf(':');
  return i >= 0 ? name.slice(i + 1) : name;
}

const MAX_PARENT_DEPTH = 32;

/**
 * Walks the parent chain, merging textures (children override parents) and
 * taking elements from the nearest model that defines them.
 */
export function resolveModel(name: string, src: ModelSource): ResolvedModel {
  const textures: Record<string, string> = {};
  let elements: ModelElement[] | undefined;
  let current: string | undefined = stripNamespace(name);
  for (let depth = 0; current !== undefined; depth++) {
    if (depth > MAX_PARENT_DEPTH) return { kind: 'missing', reason: `parent chain of ${name} is too deep` };
    if (current.startsWith('builtin/')) {
      return { kind: 'entity', particle: resolveTexture('#particle', textures) };
    }
    const json = src.readJson(`models/${current}.json`) as
      | { parent?: string; textures?: Record<string, string>; elements?: ModelElement[] }
      | undefined;
    if (!json) return { kind: 'missing', reason: `model ${current} not found` };
    for (const [key, value] of Object.entries(json.textures ?? {})) {
      if (!(key in textures)) textures[key] = value;
    }
    if (!elements && Array.isArray(json.elements)) elements = json.elements;
    current = json.parent !== undefined ? stripNamespace(json.parent) : undefined;
  }
  if (!elements || elements.length === 0) {
    return { kind: 'entity', particle: resolveTexture('#particle', textures) };
  }
  return { kind: 'elements', elements, textures };
}

/** Resolves "#var" references through the texture map; returns a namespace-free texture name. */
export function resolveTexture(ref: string, textures: Record<string, string>): string | undefined {
  let value: string | undefined = ref;
  for (let i = 0; i < 16 && value !== undefined; i++) {
    if (!value.startsWith('#')) return stripNamespace(value);
    value = textures[value.slice(1)];
  }
  return undefined;
}
