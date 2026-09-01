import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';

describe('MCP server wiring', () => {
  it('registers tools and runs a basic build flow end-to-end', async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    await client.callTool({ name: 'createProject', arguments: { name: 'test-house' } });
    await client.callTool({
      name: 'setBlock',
      arguments: { pos: { x: 0, y: 0, z: 0 }, block: { id: 'minecraft:stone' } }
    });
    const infoResult = await client.callTool({ name: 'getBuildInfo', arguments: {} });

    const text = (infoResult.content as { type: string; text: string }[])[0].text;
    expect(text).toContain('test-house');
    expect(text).toContain('minecraft:stone: 1');

    await client.close();
    await server.close();
  });
});
