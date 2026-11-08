import { z } from 'zod';
import type { ProjectManager } from '../core/project-manager.js';
import { setBlockHandler, setBlocksHandler } from './block-tools.js';
import { batchHandler, MAX_BATCH_OPERATIONS } from './batch-tool.js';
import { getBuildInfoHandler, exportSchematicHandler } from './info-tools.js';
import { VIEW_PRESETS, type ViewPreset } from '../preview/client/camera-presets.js';
import { previewBuildHandler, renderViewHandler, type PreviewServerState } from './preview-tools.js';
import {
  createProjectHandler,
  deleteProjectHandler,
  listProjectsHandler,
  switchProjectHandler
} from './project-tools.js';
import {
  clearRegionHandler,
  copyRegionHandler,
  decayRegionHandler,
  replaceInRegionHandler,
  stackRegionHandler
} from './region-tools.js';
import type { ToolResult } from './result.js';
import {
  fillBoxHandler,
  outlineBoxHandler,
  wallHandler,
  lineHandler,
  sphereHandler,
  cylinderHandler
} from './shape-tools.js';
import {
  deleteTemplateHandler,
  listTemplatesHandler,
  placeTemplateHandler,
  saveTemplateHandler
} from './template-tools.js';

export interface ToolContext {
  manager: ProjectManager;
  templateDir: string;
  previewState: PreviewServerState;
}

export interface ToolDef {
  name: string;
  description: string;
  /** A factory: every caller gets fresh zod instances (see the note below). */
  inputShape: () => z.ZodRawShape;
  /** The server wraps mutating tools in withSave so the project is persisted afterwards. */
  mutating: boolean;
  /** Whether the tool may be used as an operation inside `batch`. */
  batchable: boolean;
  /** Unwrapped handler: no saving, arguments already validated against inputShape. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (ctx: ToolContext, args: any) => ToolResult | Promise<ToolResult>;
}

// Factories, not shared instances: each call site gets its own zod schema
// object so zod-to-json-schema inlines the generated JSON Schema instead of
// emitting internal $ref pointers between tool input schemas.
const vec3Shape = () => ({ x: z.number().int(), y: z.number().int(), z: z.number().int() });
const projectNameSchema = () =>
  z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]*$/, 'Project name may contain only letters, digits, spaces, hyphens and underscores.')
    // Names become directory names: Windows strips trailing spaces and reserves device names.
    .refine((name) => !name.endsWith(' '), 'Project name must not end with a space.')
    .refine(
      (name) => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name),
      'Project name must not be a reserved Windows device name (CON, PRN, AUX, NUL, COM1-9, LPT1-9).'
    );
const templateNameSchema = () =>
  z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]*$/, 'Template name may contain only letters, digits, spaces, hyphens and underscores.')
    .refine((name) => !name.endsWith(' '), 'Template name must not end with a space.')
    .refine(
      (name) => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name),
      'Template name must not be a reserved Windows device name (CON, PRN, AUX, NUL, COM1-9, LPT1-9).'
    );
const blockStateSchema = () =>
  z.object({
    id: z.string(),
    properties: z.record(z.string()).optional()
  });
const blockOrPaletteSchema = () =>
  z.union([
    blockStateSchema(),
    z.array(z.object({ block: blockStateSchema(), weight: z.number().positive() }))
  ]);
const matcherSchema = () =>
  z.object({
    id: z.string().describe('Block id; "minecraft:" is optional and * is a wildcard, e.g. "*_stairs".'),
    properties: z.record(z.string()).optional().describe('Only blocks having all of these property values match.')
  });
const rotateSchema = () =>
  z
    .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
    .optional()
    .describe('Clockwise rotation seen from above, in degrees. Applied after flip.');
const flipSchema = () =>
  z.enum(['x', 'z']).optional().describe('"x" mirrors east/west, "z" mirrors north/south. Applied before rotate.');
const keepPropertiesSchema = () =>
  z
    .union([z.literal('auto'), z.boolean()])
    .optional()
    .describe(
      'Carry over the old block\'s properties (facing, half, ...). Default "auto": only when both ids end with the same word (oak_stairs -> spruce_stairs).'
    );
const seedSchema = () =>
  z.number().int().optional().describe('Makes random choices reproducible. Omit for a different result each time.');

export function buildToolDefs(): ToolDef[] {
  const defs: ToolDef[] = [
    {
      name: 'createProject',
      description: 'Create a new build project and make it active.',
      inputShape: () => ({ name: projectNameSchema() }),
      mutating: false,
      batchable: false,
      run: ({ manager }, args) => createProjectHandler(manager, args)
    },
    {
      name: 'listProjects',
      description: 'List all build project names.',
      inputShape: () => ({}),
      mutating: false,
      batchable: false,
      run: ({ manager }) => listProjectsHandler(manager)
    },
    {
      name: 'switchProject',
      description: 'Switch the active build project.',
      inputShape: () => ({ name: z.string() }),
      mutating: false,
      batchable: false,
      run: ({ manager }, args) => switchProjectHandler(manager, args)
    },
    {
      name: 'deleteProject',
      description: 'Delete a build project.',
      inputShape: () => ({ name: z.string() }),
      mutating: false,
      batchable: false,
      run: ({ manager }, args) => deleteProjectHandler(manager, args)
    },
    {
      name: 'setBlock',
      description: 'Set a single block in the active project.',
      inputShape: () => ({ pos: z.object(vec3Shape()), block: blockStateSchema() }),
      mutating: true,
      batchable: true,
      run: ({ manager }, args) => setBlockHandler(manager, args)
    },
    {
      name: 'setBlocks',
      description: 'Set multiple blocks in the active project in one call.',
      inputShape: () => ({ blocks: z.array(z.object({ pos: z.object(vec3Shape()), block: blockStateSchema() })) }),
      mutating: true,
      batchable: true,
      run: ({ manager }, args) => setBlocksHandler(manager, args)
    },
    {
      name: 'fillBox',
      description: 'Fill a solid rectangular box.',
      inputShape: () => ({ from: z.object(vec3Shape()), to: z.object(vec3Shape()), block: blockOrPaletteSchema() }),
      mutating: true,
      batchable: true,
      run: ({ manager }, args) => fillBoxHandler(manager, args)
    },
    {
      name: 'outlineBox',
      description: 'Build a hollow rectangular box (shell only).',
      inputShape: () => ({ from: z.object(vec3Shape()), to: z.object(vec3Shape()), block: blockOrPaletteSchema() }),
      mutating: true,
      batchable: true,
      run: ({ manager }, args) => outlineBoxHandler(manager, args)
    },
    {
      name: 'wall',
      description: 'Build a vertical wall along the line between two points.',
      inputShape: () => ({
        from: z.object(vec3Shape()),
        to: z.object(vec3Shape()),
        height: z.number().int().positive(),
        block: blockOrPaletteSchema()
      }),
      mutating: true,
      batchable: true,
      run: ({ manager }, args) => wallHandler(manager, args)
    },
    {
      name: 'line',
      description: 'Draw a straight line of blocks between two points.',
      inputShape: () => ({ from: z.object(vec3Shape()), to: z.object(vec3Shape()), block: blockOrPaletteSchema() }),
      mutating: true,
      batchable: true,
      run: ({ manager }, args) => lineHandler(manager, args)
    },
    {
      name: 'sphere',
      description: 'Build a sphere.',
      inputShape: () => ({
        center: z.object(vec3Shape()),
        radius: z.number().nonnegative(),
        block: blockOrPaletteSchema(),
        hollow: z.boolean().optional()
      }),
      mutating: true,
      batchable: true,
      run: ({ manager }, args) => sphereHandler(manager, args)
    },
    {
      name: 'cylinder',
      description: 'Build a cylinder.',
      inputShape: () => ({
        center: z.object(vec3Shape()),
        radius: z.number().nonnegative(),
        height: z.number().int().positive(),
        block: blockOrPaletteSchema(),
        hollow: z.boolean().optional()
      }),
      mutating: true,
      batchable: true,
      run: ({ manager }, args) => cylinderHandler(manager, args)
    },
    {
      name: 'copyRegion',
      description:
        'Copy the blocks in a box to another place in the active project, optionally flipped and/or rotated ' +
        '(stairs, doors, logs, signs etc. turn with it). `dest` is where the minimum corner of the transformed ' +
        'copy goes. Unset cells in the source leave the destination untouched; explicit air overwrites. ' +
        'Source and destination may overlap. Returns the destination bounds.',
      inputShape: () => ({
        from: z.object(vec3Shape()),
        to: z.object(vec3Shape()),
        dest: z.object(vec3Shape()),
        rotate: rotateSchema(),
        flip: flipSchema()
      }),
      mutating: true,
      batchable: true,
      run: ({ manager }, args) => copyRegionHandler(manager, args)
    },
    {
      name: 'stackRegion',
      description:
        'Repeat the blocks in a box along one direction (like WorldEdit //stack). Each copy is shifted by the ' +
        "box's length in that direction plus `gap`. `count` is the number of extra copies (the original is not counted).",
      inputShape: () => ({
        from: z.object(vec3Shape()),
        to: z.object(vec3Shape()),
        direction: z.enum(['north', 'south', 'east', 'west', 'up', 'down']),
        count: z.number().int().min(1).max(256),
        gap: z.number().int().min(0).optional()
      }),
      mutating: true,
      batchable: true,
      run: ({ manager }, args) => stackRegionHandler(manager, args)
    },
    {
      name: 'replaceInRegion',
      description:
        'Replace every block in a box that matches one of the `match` entries (ids may use * wildcards, ' +
        'optional property filters) with a block or weighted palette. Properties such as stair facing are kept ' +
        'according to `keepProperties`. Unset cells are skipped; use id "minecraft:air" to match explicit air.',
      inputShape: () => ({
        from: z.object(vec3Shape()),
        to: z.object(vec3Shape()),
        match: z.array(matcherSchema()).min(1),
        replacement: blockOrPaletteSchema(),
        keepProperties: keepPropertiesSchema(),
        seed: seedSchema()
      }),
      mutating: true,
      batchable: true,
      run: ({ manager }, args) => replaceInRegionHandler(manager, args)
    },
    {
      name: 'clearRegion',
      description:
        'Remove all blocks in a box. mode "unset" (default) makes the cells empty again; "air" places explicit ' +
        'air, which later overwrites terrain when pasted over it.',
      inputShape: () => ({
        from: z.object(vec3Shape()),
        to: z.object(vec3Shape()),
        mode: z.enum(['unset', 'air']).optional()
      }),
      mutating: true,
      batchable: true,
      run: ({ manager }, args) => clearRegionHandler(manager, args)
    },
    {
      name: 'decayRegion',
      description:
        'Randomly break down the blocks in a box to make a ruin. Each block is removed with probability ' +
        'intensity x height weight (higher blocks crumble more when topBias is on). `protect` lists blocks to keep. ' +
        'Some removed blocks leave rubble resting on whatever is below. Run this before validating a build.',
      inputShape: () => ({
        from: z.object(vec3Shape()),
        to: z.object(vec3Shape()),
        intensity: z.number().min(0).max(1),
        topBias: z.boolean().optional(),
        protect: z.array(matcherSchema()).optional(),
        rubble: z.boolean().optional(),
        rubbleChance: z.number().min(0).max(1).optional(),
        rubbleBlocks: blockOrPaletteSchema().optional(),
        seed: seedSchema()
      }),
      mutating: true,
      batchable: true,
      run: ({ manager }, args) => decayRegionHandler(manager, args)
    },
    {
      name: 'saveTemplate',
      description:
        'Save the blocks in a box of the active project as a reusable template (shared by all projects). ' +
        '`anchor` is an absolute coordinate that placeTemplate will put at its `at` point; it defaults to the ' +
        'center of the box bottom. A good anchor is the ground in front of the main entrance.',
      inputShape: () => ({
        name: templateNameSchema(),
        from: z.object(vec3Shape()),
        to: z.object(vec3Shape()),
        anchor: z.object(vec3Shape()).optional(),
        description: z.string().optional(),
        overwrite: z.boolean().optional()
      }),
      mutating: false,
      batchable: false,
      run: ({ manager, templateDir }, args) => saveTemplateHandler(manager, templateDir, args)
    },
    {
      name: 'listTemplates',
      description: 'List saved templates with their sizes, anchors and descriptions.',
      inputShape: () => ({}),
      mutating: false,
      batchable: false,
      run: ({ templateDir }) => listTemplatesHandler(templateDir)
    },
    {
      name: 'deleteTemplate',
      description: 'Delete a saved template (its file is moved to a .trash folder).',
      inputShape: () => ({ name: z.string() }),
      mutating: false,
      batchable: false,
      run: ({ templateDir }, args) => deleteTemplateHandler(templateDir, args)
    },
    {
      name: 'placeTemplate',
      description:
        'Place a saved template into the active project so that its anchor lands on `at`, optionally flipped ' +
        'and/or rotated. `replace` swaps blocks while placing (e.g. a different wood), using the template\'s ' +
        'original orientation to match; the first matching rule wins. Unset template cells leave the ' +
        'destination untouched. Returns the bounds of the placed area.',
      inputShape: () => ({
        name: z.string(),
        at: z.object(vec3Shape()),
        rotate: rotateSchema(),
        flip: flipSchema(),
        replace: z
          .array(
            z.object({
              match: z.array(matcherSchema()).min(1),
              replacement: blockOrPaletteSchema(),
              keepProperties: keepPropertiesSchema()
            })
          )
          .optional(),
        seed: seedSchema()
      }),
      mutating: true,
      batchable: true,
      run: ({ manager, templateDir }, args) => placeTemplateHandler(manager, templateDir, args)
    },
    {
      name: 'getBuildInfo',
      description: 'Get a summary of the active project (size, bounding box, block counts).',
      inputShape: () => ({}),
      mutating: false,
      batchable: false,
      run: ({ manager }) => getBuildInfoHandler(manager)
    },
    {
      name: 'exportSchematic',
      description:
        'Export the active project to ./output/<projectName>.schem and return the absolute path. ' +
        'Project names may contain only letters, digits, spaces, hyphens and underscores.',
      inputShape: () => ({}),
      mutating: false,
      batchable: false,
      run: ({ manager }) => exportSchematicHandler(manager)
    },
    {
      name: 'previewBuild',
      description:
        'Start (or reuse) a local preview server for the active project and return its URL. ' +
        'Open the URL in a browser to see a textured 3D view built from the real Minecraft models and textures ' +
        '(downloaded and cached on first use; plain colors until then): orbit, pan and zoom, jump to preset views ' +
        '(top, iso_*, north/south/east/west), cut everything above a height with the slider, hover a block for its ' +
        'coordinates and id, click to copy "x, y, z". The page follows changes within a few seconds. ' +
        'Append /2d to the URL for the older layer-by-layer 2D view. To look at the build yourself, use renderView.',
      inputShape: () => ({}),
      mutating: false,
      batchable: false,
      run: ({ manager, previewState }) => previewBuildHandler(manager, previewState)
    },
    {
      name: 'renderView',
      description:
        'Render the project in the 3D preview with headless Edge/Chrome and return a PNG so you can see what you built. ' +
        'Check your work with it after each stage: take an overview from above with an iso_* view, then use `focus` ' +
        'for a close look at a part you are unsure about. For interiors, `clipY` hides everything above that height, ' +
        'so an iso_* view looks into the rooms. Blocks use the real Minecraft textures when they are cached ' +
        '(otherwise plain colors); ids that do not resolve are drawn as a magenta/black checker and listed in the text. ' +
        'Views: top (north up), iso_ne/iso_nw/iso_se/iso_sw (45 degrees, seen from that corner), north/south/east/west ' +
        '(horizontal, seen from that side). The first call may take a while if the textures still have to be downloaded.',
      inputShape: () => ({
        view: z.enum(VIEW_PRESETS as unknown as [ViewPreset, ...ViewPreset[]]).optional().describe('Default iso_se.'),
        focus: z
          .object({ from: z.object(vec3Shape()), to: z.object(vec3Shape()) })
          .optional()
          .describe('Box to frame. Omit for the whole project.'),
        clipY: z.number().int().optional().describe('Do not draw blocks above this Y.'),
        width: z.number().int().min(64).max(1920).optional().describe('Default 1280.'),
        height: z.number().int().min(64).max(1200).optional().describe('Default 800.'),
        ortho: z.boolean().optional().describe('Orthographic projection; only used with view "top".'),
        project: projectNameSchema().optional().describe('Default: the active project.')
      }),
      mutating: false,
      batchable: false,
      run: ({ manager, previewState }, args) => renderViewHandler(manager, previewState, args)
    }
  ];

  defs.push({
    name: 'batch',
    description:
      `Run up to ${MAX_BATCH_OPERATIONS} build operations in one call. Each operation is { tool, args } with the ` +
      'same arguments as the tool itself. Allowed tools: setBlock, setBlocks, fillBox, outlineBox, wall, line, ' +
      'sphere, cylinder, copyRegion, stackRegion, replaceInRegion, clearRegion, decayRegion, placeTemplate. ' +
      'All operations are validated before any runs. If one fails at runtime the batch stops there and the ' +
      'earlier operations stay applied; the error says how many were applied. The project is saved once at the end.',
    inputShape: () => ({
      operations: z
        .array(z.object({ tool: z.string(), args: z.record(z.unknown()).optional() }))
        .min(1)
        .max(MAX_BATCH_OPERATIONS)
    }),
    mutating: true,
    batchable: false,
    run: (ctx, args) => batchHandler(ctx, args, defs)
  });
  return defs;
}
