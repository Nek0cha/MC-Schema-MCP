import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ProjectManager } from '../src/core/project-manager.js';
import { loadProject } from '../src/core/project-store.js';
import { createServer, withSave } from '../src/server.js';
import { textResult } from '../src/tools/result.js';

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

  it('autosaves mutating tool calls so a new server instance can resume', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mc-srv-'));
    try {
      const server = createServer({ dataDir: root });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'c', version: '0.0.0' });
      await Promise.all([server.connect(st), client.connect(ct)]);
      await client.callTool({ name: 'createProject', arguments: { name: 'saved' } });
      await client.callTool({
        name: 'fillBox',
        arguments: { from: { x: 0, y: 0, z: 0 }, to: { x: 2, y: 2, z: 2 }, block: { id: 'minecraft:stone' } }
      });
      await client.close();
      await server.close();

      const loaded = loadProject(root, 'saved');
      expect(loaded.blockCount).toBe(27);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('tool registration', () => {
  async function listTools() {
    const server = createServer();
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'c', version: '0.0.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
    const result = await client.listTools();
    await client.close();
    await server.close();
    return result;
  }

  it('registers all new tools', async () => {
    const names = (await listTools()).tools.map((tool) => tool.name);
    for (const name of [
      'copyRegion',
      'stackRegion',
      'replaceInRegion',
      'clearRegion',
      'decayRegion',
      'saveTemplate',
      'listTemplates',
      'deleteTemplate',
      'placeTemplate',
      'batch'
    ]) {
      expect(names).toContain(name);
    }
  });

  it('keeps every existing tool', async () => {
    const names = (await listTools()).tools.map((tool) => tool.name);
    for (const name of [
      'createProject',
      'listProjects',
      'switchProject',
      'deleteProject',
      'setBlock',
      'setBlocks',
      'fillBox',
      'outlineBox',
      'wall',
      'line',
      'sphere',
      'cylinder',
      'getBuildInfo',
      'exportSchematic',
      'previewBuild'
    ]) {
      expect(names).toContain(name);
    }
  });

  it('generates inline JSON schemas without $ref', async () => {
    expect(JSON.stringify(await listTools())).not.toContain('"$ref"');
  });

  it('accepts rotate only as 0, 90, 180 or 270', async () => {
    const server = createServer();
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'c', version: '0.0.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
    await client.callTool({ name: 'createProject', arguments: { name: 'r' } });
    const base = { from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 0 }, dest: { x: 5, y: 0, z: 0 } };
    expect((await client.callTool({ name: 'copyRegion', arguments: { ...base, rotate: 45 } })).isError).toBe(true);
    expect((await client.callTool({ name: 'copyRegion', arguments: { ...base, rotate: 90 } })).isError).toBeFalsy();
    await client.close();
    await server.close();
  });
});

describe('withSave', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mc-ws-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('reports a failed save as an error without asking to retry', () => {
    const manager = new ProjectManager({ dataDir: root });
    manager.createProject('p');
    vi.spyOn(manager, 'saveActive').mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });
    const result = withSave(manager, () => {
      manager.getActive().setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
      return textResult('ok');
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/applied in memory/);
    expect(result.content[0].text).toMatch(/Do not repeat/);
    expect(result.content[0].text).toMatch(/ENOSPC/);
    expect(manager.getActive().getBlock({ x: 0, y: 0, z: 0 })).toEqual({ id: 'minecraft:stone' });
  });

  it('retries previously unsaved chunks on the next change', () => {
    const manager = new ProjectManager({ dataDir: root });
    manager.createProject('p');
    const realSave = manager.saveActive.bind(manager);
    vi.spyOn(manager, 'saveActive').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const first = withSave(manager, () => {
      manager.getActive().setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
      return textResult('ok');
    });
    expect(first.isError).toBe(true);
    vi.spyOn(manager, 'saveActive').mockImplementation(realSave);
    const second = withSave(manager, () => {
      manager.getActive().setBlock({ x: 100, y: 0, z: 0 }, { id: 'minecraft:dirt' });
      return textResult('ok');
    });
    expect(second.isError).toBeUndefined();
    const loaded = loadProject(root, 'p');
    expect(loaded.getBlock({ x: 0, y: 0, z: 0 })).toEqual({ id: 'minecraft:stone' });
    expect(loaded.getBlock({ x: 100, y: 0, z: 0 })).toEqual({ id: 'minecraft:dirt' });
  });

  it('passes handler results through untouched on success', () => {
    const manager = new ProjectManager({ dataDir: root });
    manager.createProject('p');
    expect(withSave(manager, () => textResult('hello')).content[0].text).toBe('hello');
  });
});

describe('project name validation', () => {
  it.each(['nul', 'COM1', 'town '])('rejects %j as a project name', async (name) => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'c', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: 'createProject', arguments: { name } });
    expect(result.isError).toBe(true);
    await client.close();
    await server.close();
  });
});
