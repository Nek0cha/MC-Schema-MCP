import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ProjectManager } from './core/project-manager.js';
import { createPreviewServerState } from './tools/preview-tools.js';
import { buildToolDefs, type ToolContext } from './tools/registry.js';
import type { ToolTextResult } from './tools/result.js';

/**
 * Runs a mutating tool handler, then persists the active project. If saving
 * fails the in-memory change stays applied (and stays dirty, so the next save
 * retries it) and the result is turned into an error that tells the caller so.
 */
export function withSave(manager: ProjectManager, run: () => ToolTextResult): ToolTextResult {
  let result: ToolTextResult;
  try {
    result = run();
  } catch (error) {
    try {
      manager.saveActive();
    } catch {
      // Keep the original error; unsaved chunks stay dirty and are retried later.
    }
    throw error;
  }
  try {
    manager.saveActive();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Change applied in memory but could not be saved to disk: ${message}. Do not repeat the operation; it will be saved with the next change.`
        }
      ],
      isError: true
    };
  }
  return result;
}

export interface CreateServerOptions {
  /** Root directory for project persistence. Omit to keep projects in memory only. */
  dataDir?: string;
  /** Directory for saved templates. Defaults to ./templates. */
  templateDir?: string;
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const manager = new ProjectManager({ dataDir: options.dataDir });
  const ctx: ToolContext = {
    manager,
    templateDir: options.templateDir ?? './templates',
    previewState: createPreviewServerState()
  };
  const server = new McpServer({ name: 'mc-schema-mcp', version: '0.1.0' });

  for (const def of buildToolDefs()) {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.inputShape() },
      async (args: unknown) => {
        if (!def.mutating) return def.run(ctx, args);
        return withSave(manager, () => {
          const result = def.run(ctx, args);
          if (result instanceof Promise) {
            throw new Error(`Tool ${def.name} is marked mutating but returned an asynchronous result.`);
          }
          return result;
        });
      }
    );
  }

  return server;
}
