import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ProjectManager } from './core/project-manager.js';
import {
  createProjectHandler,
  listProjectsHandler,
  switchProjectHandler,
  deleteProjectHandler
} from './tools/project-tools.js';
import { setBlockHandler, setBlocksHandler } from './tools/block-tools.js';
import {
  fillBoxHandler,
  outlineBoxHandler,
  wallHandler,
  lineHandler,
  sphereHandler,
  cylinderHandler
} from './tools/shape-tools.js';
import { getBuildInfoHandler, exportSchematicHandler } from './tools/info-tools.js';

// Factories, not shared instances: each call site gets its own zod schema
// object so zod-to-json-schema inlines the generated JSON Schema instead of
// emitting internal $ref pointers between tool input schemas.
const vec3Shape = () => ({ x: z.number().int(), y: z.number().int(), z: z.number().int() });
const projectNameSchema = () =>
  z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]*$/, 'Project name may contain only letters, digits, spaces, hyphens and underscores.');
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

export function createServer(): McpServer {
  const manager = new ProjectManager();
  const server = new McpServer({ name: 'mc-schema-mcp', version: '0.1.0' });

  server.registerTool(
    'createProject',
    { description: 'Create a new build project and make it active.', inputSchema: { name: projectNameSchema() } },
    async ({ name }) => createProjectHandler(manager, { name })
  );

  server.registerTool(
    'listProjects',
    { description: 'List all build project names.', inputSchema: {} },
    async () => listProjectsHandler(manager)
  );

  server.registerTool(
    'switchProject',
    { description: 'Switch the active build project.', inputSchema: { name: z.string() } },
    async ({ name }) => switchProjectHandler(manager, { name })
  );

  server.registerTool(
    'deleteProject',
    { description: 'Delete a build project.', inputSchema: { name: z.string() } },
    async ({ name }) => deleteProjectHandler(manager, { name })
  );

  server.registerTool(
    'setBlock',
    {
      description: 'Set a single block in the active project.',
      inputSchema: { pos: z.object(vec3Shape()), block: blockStateSchema() }
    },
    async (args) => setBlockHandler(manager, args)
  );

  server.registerTool(
    'setBlocks',
    {
      description: 'Set multiple blocks in the active project in one call.',
      inputSchema: { blocks: z.array(z.object({ pos: z.object(vec3Shape()), block: blockStateSchema() })) }
    },
    async (args) => setBlocksHandler(manager, args)
  );

  server.registerTool(
    'fillBox',
    {
      description: 'Fill a solid rectangular box.',
      inputSchema: { from: z.object(vec3Shape()), to: z.object(vec3Shape()), block: blockOrPaletteSchema() }
    },
    async (args) => fillBoxHandler(manager, args)
  );

  server.registerTool(
    'outlineBox',
    {
      description: 'Build a hollow rectangular box (shell only).',
      inputSchema: { from: z.object(vec3Shape()), to: z.object(vec3Shape()), block: blockOrPaletteSchema() }
    },
    async (args) => outlineBoxHandler(manager, args)
  );

  server.registerTool(
    'wall',
    {
      description: 'Build a vertical wall along the line between two points.',
      inputSchema: {
        from: z.object(vec3Shape()),
        to: z.object(vec3Shape()),
        height: z.number().int().positive(),
        block: blockOrPaletteSchema()
      }
    },
    async (args) => wallHandler(manager, args)
  );

  server.registerTool(
    'line',
    {
      description: 'Draw a straight line of blocks between two points.',
      inputSchema: { from: z.object(vec3Shape()), to: z.object(vec3Shape()), block: blockOrPaletteSchema() }
    },
    async (args) => lineHandler(manager, args)
  );

  server.registerTool(
    'sphere',
    {
      description: 'Build a sphere.',
      inputSchema: {
        center: z.object(vec3Shape()),
        radius: z.number().nonnegative(),
        block: blockOrPaletteSchema(),
        hollow: z.boolean().optional()
      }
    },
    async (args) => sphereHandler(manager, args)
  );

  server.registerTool(
    'cylinder',
    {
      description: 'Build a cylinder.',
      inputSchema: {
        center: z.object(vec3Shape()),
        radius: z.number().nonnegative(),
        height: z.number().int().positive(),
        block: blockOrPaletteSchema(),
        hollow: z.boolean().optional()
      }
    },
    async (args) => cylinderHandler(manager, args)
  );

  server.registerTool(
    'getBuildInfo',
    { description: 'Get a summary of the active project (size, bounding box, block counts).', inputSchema: {} },
    async () => getBuildInfoHandler(manager)
  );

  server.registerTool(
    'exportSchematic',
    {
      description:
        'Export the active project to ./output/<projectName>.schem and return the absolute path. ' +
        'Project names may contain only letters, digits, spaces, hyphens and underscores.',
      inputSchema: {}
    },
    async () => exportSchematicHandler(manager)
  );

  return server;
}
