import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectManager } from '../core/project-manager.js';
import { writeSchematic } from '../schematic/writer.js';
import { textResult, type ToolTextResult } from './result.js';

const OUTPUT_DIR = './output';

export function getBuildInfoHandler(manager: ProjectManager): ToolTextResult {
  const project = manager.getActive();
  const bbox = project.getBoundingBox();

  if (!bbox) {
    return textResult(`Project "${project.name}" is empty.`);
  }

  const width = bbox.max.x - bbox.min.x + 1;
  const height = bbox.max.y - bbox.min.y + 1;
  const length = bbox.max.z - bbox.min.z + 1;
  const countsText = Object.entries(project.getBlockCounts())
    .map(([id, count]) => `${id}: ${count}`)
    .join(', ');

  return textResult(
    `Project "${project.name}": ${width}x${height}x${length} blocks. ` +
      `Bounding box min=(${bbox.min.x},${bbox.min.y},${bbox.min.z}) ` +
      `max=(${bbox.max.x},${bbox.max.y},${bbox.max.z}). Block counts: ${countsText}.`
  );
}

export function exportSchematicHandler(manager: ProjectManager): ToolTextResult {
  const project = manager.getActive();
  const buffer = writeSchematic(project);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = join(OUTPUT_DIR, `${project.name}.schem`);
  writeFileSync(outputPath, buffer);
  return textResult(`Exported to ${outputPath}`);
}
