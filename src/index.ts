import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

try {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
} catch (error) {
  console.error(`mc-schema-mcp failed to start: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
