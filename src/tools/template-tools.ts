import type { ProjectManager } from '../core/project-manager.js';
import { listTemplateFiles, moveTemplateToTrash } from '../core/template-store.js';
import { placeTemplate, saveTemplate, type PlacementReplace } from '../core/templates.js';
import type { Flip, Rotation } from '../core/transform.js';
import type { Vec3 } from '../core/types.js';
import { formatBounds, formatCount } from './format.js';
import { textResult, type ToolTextResult } from './result.js';

const tuple = (v: readonly number[]) => `(${v.join(', ')})`;

export function saveTemplateHandler(
  manager: ProjectManager,
  templateDir: string,
  args: { name: string; from: Vec3; to: Vec3; anchor?: Vec3; description?: string; overwrite?: boolean }
): ToolTextResult {
  const info = saveTemplate(templateDir, manager.getActive(), args.name, args.from, args.to, {
    anchor: args.anchor,
    description: args.description,
    overwrite: args.overwrite
  });
  return textResult(
    `Saved template "${info.name}" (${info.size.join('x')}, anchor offset ${tuple(info.anchor)} from its min corner).`
  );
}

export function listTemplatesHandler(templateDir: string): ToolTextResult {
  const templates = listTemplateFiles(templateDir);
  if (templates.length === 0) return textResult('(no templates yet)');
  return textResult(
    templates
      .map(
        (t) =>
          `${t.name}: ${t.size.join('x')}, anchor ${tuple(t.anchor)}` + (t.description ? ` - ${t.description}` : '')
      )
      .join('\n')
  );
}

export function deleteTemplateHandler(templateDir: string, args: { name: string }): ToolTextResult {
  const trashedTo = moveTemplateToTrash(templateDir, args.name);
  return textResult(
    `Deleted template "${args.name}". Its file was moved to ${trashedTo} and can be restored manually.`
  );
}

export function placeTemplateHandler(
  manager: ProjectManager,
  templateDir: string,
  args: {
    name: string;
    at: Vec3;
    rotate?: Rotation;
    flip?: Flip;
    replace?: PlacementReplace[];
    seed?: number;
  }
): ToolTextResult {
  const result = placeTemplate(templateDir, manager.getActive(), args.name, args.at, {
    rotate: args.rotate,
    flip: args.flip,
    replace: args.replace,
    seed: args.seed
  });
  return textResult(
    `Placed ${formatCount(result.changed)} block(s) from template "${args.name}" at ${formatBounds(result.bounds)}` +
      (result.markers ? ` and ${result.markers} marker(s).` : '.')
  );
}
