import type { BuildProject } from './build-project.js';
import { applyReplacement, matchesAny, type BlockMatcher, type KeepProperties } from './block-match.js';
import { createRng, pickFromPalette } from './random.js';
import type { RegionResult } from './region-ops.js';
import type { BlockOrPalette } from './shapes.js';
import {
  loadTemplateFile,
  MAX_TEMPLATE_CELLS,
  saveTemplateFile,
  type TemplateData,
  type TemplateInfo
} from './template-store.js';
import { transformBlockState, transformOffset, type Flip, type Rotation, type Transform } from './transform.js';
import { blockStateKey, type BlockState, type Vec3 } from './types.js';

export { MAX_TEMPLATE_CELLS };

export interface PlacementReplace {
  match: BlockMatcher[];
  replacement: BlockOrPalette;
  keepProperties?: KeepProperties;
}

function info(data: TemplateData): TemplateInfo {
  return {
    name: data.name,
    ...(data.description !== undefined ? { description: data.description } : {}),
    size: data.size,
    anchor: data.anchor,
    createdAt: data.createdAt
  };
}

/** Saves the blocks in the range as a template. `anchor` is an absolute coordinate and may lie outside the range. */
export function saveTemplate(
  root: string,
  project: BuildProject,
  name: string,
  from: Vec3,
  to: Vec3,
  opts: { anchor?: Vec3; description?: string; overwrite?: boolean } = {}
): TemplateInfo {
  const min = { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), z: Math.min(from.z, to.z) };
  const max = { x: Math.max(from.x, to.x), y: Math.max(from.y, to.y), z: Math.max(from.z, to.z) };
  const size: [number, number, number] = [max.x - min.x + 1, max.y - min.y + 1, max.z - min.z + 1];
  const cells = size[0] * size[1] * size[2];
  if (cells > MAX_TEMPLATE_CELLS) {
    throw new Error(
      `Template is too large: ${cells.toLocaleString('en-US')} cells (max ${MAX_TEMPLATE_CELLS.toLocaleString('en-US')}).`
    );
  }

  const palette: (BlockState | null)[] = [null];
  const paletteIndex = new Map<string, number>();
  const blocks = new Uint16Array(cells);
  let found = 0;
  for (let y = 0; y < size[1]; y++) {
    for (let z = 0; z < size[2]; z++) {
      for (let x = 0; x < size[0]; x++) {
        const block = project.getBlock({ x: min.x + x, y: min.y + y, z: min.z + z });
        if (!block) continue;
        const key = blockStateKey(block as BlockState);
        let index = paletteIndex.get(key);
        if (index === undefined) {
          index = palette.length;
          palette.push({ id: block.id, ...(block.properties ? { properties: { ...block.properties } } : {}) });
          paletteIndex.set(key, index);
        }
        blocks[(y * size[2] + z) * size[0] + x] = index;
        found++;
      }
    }
  }
  if (found === 0) {
    throw new Error('The range contains no blocks, so there is nothing to save as a template.');
  }

  const anchor: [number, number, number] = opts.anchor
    ? [opts.anchor.x - min.x, opts.anchor.y - min.y, opts.anchor.z - min.z]
    : [Math.floor((size[0] - 1) / 2), 0, Math.floor((size[2] - 1) / 2)];

  const data: TemplateData = {
    name,
    ...(opts.description !== undefined ? { description: opts.description } : {}),
    size,
    anchor,
    palette,
    blocks,
    createdAt: new Date().toISOString()
  };
  saveTemplateFile(root, data, opts.overwrite ?? false);
  return info(data);
}

/**
 * Places a template so that its (transformed) anchor lands on `at`. Replacements
 * apply to the template's own blocks first (the first matching rule wins), then
 * the result is flipped/rotated. Unset template cells leave the destination alone.
 */
export function placeTemplate(
  root: string,
  project: BuildProject,
  name: string,
  at: Vec3,
  opts: { rotate?: Rotation; flip?: Flip; replace?: PlacementReplace[]; seed?: number } = {}
): RegionResult {
  const data = loadTemplateFile(root, name);
  const t: Transform = { rotate: opts.rotate, flip: opts.flip };
  const transformed = (opts.rotate ?? 0) !== 0 || opts.flip !== undefined;
  const replace = opts.replace ?? [];
  const rng = createRng(opts.seed);
  const [sx, sy, sz] = data.size;
  const [ax, ay, az] = data.anchor;

  let changed = 0;
  let index = 0;
  for (let y = 0; y < sy; y++) {
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++, index++) {
        const paletteId = data.blocks[index];
        if (paletteId === 0) continue;
        let block = data.palette[paletteId] as BlockState;
        const rule = replace.find((r) => matchesAny(block, r.match));
        if (rule) {
          block = applyReplacement(block, pickFromPalette(rule.replacement, rng), rule.keepProperties ?? 'auto');
        }
        if (transformed) block = transformBlockState(block, t);
        const offset = transformOffset({ x: x - ax, y: y - ay, z: z - az }, t);
        project.setBlock({ x: at.x + offset.x, y: at.y + offset.y, z: at.z + offset.z }, block);
        changed++;
      }
    }
  }

  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const cx of [0, sx - 1]) {
    for (const cz of [0, sz - 1]) {
      const o = transformOffset({ x: cx - ax, y: 0, z: cz - az }, t);
      min.x = Math.min(min.x, at.x + o.x);
      max.x = Math.max(max.x, at.x + o.x);
      min.z = Math.min(min.z, at.z + o.z);
      max.z = Math.max(max.z, at.z + o.z);
    }
  }
  min.y = at.y - ay;
  max.y = at.y - ay + sy - 1;
  return { changed, bounds: { min, max } };
}
