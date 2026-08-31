import type { ProjectManager } from '../core/project-manager.js';
import type { BlockState, Vec3 } from '../core/types.js';
import { textResult, type ToolTextResult } from './result.js';

export function setBlockHandler(
  manager: ProjectManager,
  args: { pos: Vec3; block: BlockState }
): ToolTextResult {
  manager.getActive().setBlock(args.pos, args.block);
  return textResult(`Set block at (${args.pos.x}, ${args.pos.y}, ${args.pos.z}).`);
}

export function setBlocksHandler(
  manager: ProjectManager,
  args: { blocks: { pos: Vec3; block: BlockState }[] }
): ToolTextResult {
  const project = manager.getActive();
  for (const entry of args.blocks) {
    project.setBlock(entry.pos, entry.block);
  }
  return textResult(`Set ${args.blocks.length} block(s).`);
}
