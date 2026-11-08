import type { BlockMatcher, KeepProperties } from '../core/block-match.js';
import type { ProjectManager } from '../core/project-manager.js';
import {
  clearRegion,
  copyRegion,
  decayRegion,
  replaceInRegion,
  stackRegion,
  type StackDirection
} from '../core/region-ops.js';
import type { BlockOrPalette } from '../core/shapes.js';
import type { Flip, Rotation } from '../core/transform.js';
import type { Vec3 } from '../core/types.js';
import { formatBounds, formatCount } from './format.js';
import { textResult, type ToolTextResult } from './result.js';

export function copyRegionHandler(
  manager: ProjectManager,
  args: { from: Vec3; to: Vec3; dest: Vec3; rotate?: Rotation; flip?: Flip }
): ToolTextResult {
  const result = copyRegion(manager.getActive(), args.from, args.to, args.dest, {
    rotate: args.rotate,
    flip: args.flip
  });
  return textResult(`Copied ${formatCount(result.changed)} block(s) to ${formatBounds(result.bounds)}.`);
}

export function stackRegionHandler(
  manager: ProjectManager,
  args: { from: Vec3; to: Vec3; direction: StackDirection; count: number; gap?: number }
): ToolTextResult {
  const result = stackRegion(manager.getActive(), args.from, args.to, args.direction, args.count, args.gap);
  return textResult(
    `Stacked ${formatCount(result.changed)} block(s) ${args.direction} to ${formatBounds(result.bounds)}.`
  );
}

export function replaceInRegionHandler(
  manager: ProjectManager,
  args: {
    from: Vec3;
    to: Vec3;
    match: BlockMatcher[];
    replacement: BlockOrPalette;
    keepProperties?: KeepProperties;
    seed?: number;
  }
): ToolTextResult {
  const result = replaceInRegion(
    manager.getActive(),
    args.from,
    args.to,
    args.match,
    args.replacement,
    args.keepProperties,
    args.seed
  );
  return textResult(`Replaced ${formatCount(result.changed)} block(s) in ${formatBounds(result.bounds)}.`);
}

export function clearRegionHandler(
  manager: ProjectManager,
  args: { from: Vec3; to: Vec3; mode?: 'unset' | 'air' }
): ToolTextResult {
  const result = clearRegion(manager.getActive(), args.from, args.to, args.mode);
  return textResult(`Cleared ${formatCount(result.changed)} cell(s) in ${formatBounds(result.bounds)}.`);
}

export function decayRegionHandler(
  manager: ProjectManager,
  args: {
    from: Vec3;
    to: Vec3;
    intensity: number;
    topBias?: boolean;
    protect?: BlockMatcher[];
    rubble?: boolean;
    rubbleChance?: number;
    rubbleBlocks?: BlockOrPalette;
    seed?: number;
  }
): ToolTextResult {
  const { from, to, intensity, ...options } = args;
  const result = decayRegion(manager.getActive(), from, to, intensity, options);
  return textResult(
    `Decayed ${formatCount(result.changed)} block(s) and placed ${formatCount(result.rubble ?? 0)} rubble block(s) ` +
      `in ${formatBounds(result.bounds)}.`
  );
}
