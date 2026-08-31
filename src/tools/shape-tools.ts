import type { ProjectManager } from '../core/project-manager.js';
import { fillBox, outlineBox, line, wall, sphere, cylinder, type BlockOrPalette } from '../core/shapes.js';
import type { Vec3 } from '../core/types.js';
import { textResult, type ToolTextResult } from './result.js';

export function fillBoxHandler(
  manager: ProjectManager,
  args: { from: Vec3; to: Vec3; block: BlockOrPalette }
): ToolTextResult {
  fillBox(manager.getActive(), args.from, args.to, args.block);
  return textResult('Filled box.');
}

export function outlineBoxHandler(
  manager: ProjectManager,
  args: { from: Vec3; to: Vec3; block: BlockOrPalette }
): ToolTextResult {
  outlineBox(manager.getActive(), args.from, args.to, args.block);
  return textResult('Outlined box.');
}

export function wallHandler(
  manager: ProjectManager,
  args: { from: Vec3; to: Vec3; height: number; block: BlockOrPalette }
): ToolTextResult {
  wall(manager.getActive(), args.from, args.to, args.height, args.block);
  return textResult('Built wall.');
}

export function lineHandler(
  manager: ProjectManager,
  args: { from: Vec3; to: Vec3; block: BlockOrPalette }
): ToolTextResult {
  line(manager.getActive(), args.from, args.to, args.block);
  return textResult('Drew line.');
}

export function sphereHandler(
  manager: ProjectManager,
  args: { center: Vec3; radius: number; block: BlockOrPalette; hollow?: boolean }
): ToolTextResult {
  sphere(manager.getActive(), args.center, args.radius, args.block, args.hollow ?? false);
  return textResult('Built sphere.');
}

export function cylinderHandler(
  manager: ProjectManager,
  args: { center: Vec3; radius: number; height: number; block: BlockOrPalette; hollow?: boolean }
): ToolTextResult {
  cylinder(manager.getActive(), args.center, args.radius, args.height, args.block, args.hollow ?? false);
  return textResult('Built cylinder.');
}
