import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ProjectManager } from '../../src/core/project-manager.js';
import { loadProject } from '../../src/core/project-store.js';
import { createServer } from '../../src/server.js';
import { buildToolDefs } from '../../src/tools/registry.js';
import type { ToolTextResult } from '../../src/tools/result.js';
import { createPreviewServerState } from '../../src/tools/preview-tools.js';

let templateDir: string;
beforeEach(() => {
  templateDir = mkdtempSync(join(tmpdir(), 'mc-batch-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(templateDir, { recursive: true, force: true });
});

function setup() {
  const manager = new ProjectManager();
  manager.createProject('demo');
  const ctx = { manager, templateDir, previewState: createPreviewServerState() };
  const batch = buildToolDefs().find((d) => d.name === 'batch')!;
  return { manager, run: (operations: unknown[]) => batch.run(ctx, { operations }) as ToolTextResult };
}

const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;
const isError = (r: unknown) => (r as { isError?: boolean }).isError === true;
const setBlockOp = (x: number) => ({ tool: 'setBlock', args: { pos: { x, y: 0, z: 0 }, block: { id: 'minecraft:stone' } } });

describe('batch tool', () => {
  it('runs operations in order and reports one line each', () => {
    const { manager, run } = setup();
    const result = run([
      setBlockOp(0),
      { tool: 'fillBox', args: { from: { x: 0, y: 1, z: 0 }, to: { x: 1, y: 1, z: 0 }, block: { id: 'minecraft:dirt' } } }
    ]);
    expect(isError(result)).toBe(false);
    expect(text(result)).toContain('Applied 2 operation(s).');
    expect(text(result)).toContain('1. setBlock: Set block at (0, 0, 0).');
    expect(text(result)).toContain('2. fillBox: Filled box.');
    expect(manager.getActive().blockCount).toBe(3);
  });

  it('validates every operation before running any', () => {
    const { manager, run } = setup();
    const result = run([setBlockOp(0), { tool: 'fillBox', args: { to: { x: 1, y: 1, z: 0 }, block: { id: 'minecraft:dirt' } } }]);
    expect(isError(result)).toBe(true);
    expect(text(result)).toContain('operation 2');
    expect(text(result)).toContain('from');
    expect(manager.getActive().blockCount).toBe(0);
  });

  it('stops at the first runtime error and reports how many were applied', () => {
    const { manager, run } = setup();
    const result = run([
      setBlockOp(0),
      { tool: 'placeTemplate', args: { name: 'missing', at: { x: 0, y: 0, z: 0 } } },
      setBlockOp(5)
    ]);
    expect(isError(result)).toBe(true);
    expect(text(result)).toMatch(/1 of 3 operations? applied/);
    expect(text(result)).toContain('operation 2');
    expect(text(result)).toContain('does not exist');
    expect(manager.getActive().getBlock({ x: 0, y: 0, z: 0 })).toBeDefined();
    expect(manager.getActive().getBlock({ x: 5, y: 0, z: 0 })).toBeUndefined();
  });

  it('rejects non-batchable tools', () => {
    const { manager, run } = setup();
    const exportResult = run([setBlockOp(0), { tool: 'exportSchematic', args: {} }]);
    expect(isError(exportResult)).toBe(true);
    expect(text(exportResult)).toContain('operation 2');
    expect(text(exportResult)).toContain('exportSchematic');
    const nested = run([{ tool: 'batch', args: { operations: [] } }]);
    expect(isError(nested)).toBe(true);
    const unknown = run([{ tool: 'nope', args: {} }]);
    expect(isError(unknown)).toBe(true);
    expect(manager.getActive().blockCount).toBe(0);
  });

  it('allows exactly the documented set of tools', () => {
    const batchable = buildToolDefs()
      .filter((d) => d.batchable)
      .map((d) => d.name)
      .sort();
    expect(batchable).toEqual(
      [
        'setBlock',
        'setBlocks',
        'fillBox',
        'outlineBox',
        'wall',
        'line',
        'sphere',
        'cylinder',
        'copyRegion',
        'stackRegion',
        'replaceInRegion',
        'clearRegion',
        'decayRegion',
        'placeTemplate',
        'addMarkers',
        'removeMarkers'
      ].sort()
    );
  });

  it('truncates long success output', () => {
    const { run } = setup();
    const result = run(Array.from({ length: 60 }, (_, i) => setBlockOp(i)));
    const lines = text(result).split('\n');
    expect(text(result)).toContain('Applied 60 operation(s).');
    expect(text(result)).toContain('(35 more)');
    expect(lines.some((l) => l.startsWith('20. '))).toBe(true);
    expect(lines.some((l) => l.startsWith('21. '))).toBe(false);
    expect(lines.some((l) => l.startsWith('55. '))).toBe(false);
    expect(lines.some((l) => l.startsWith('56. '))).toBe(true);
    expect(lines.some((l) => l.startsWith('60. '))).toBe(true);
  });

  it('enforces 1 to 1000 operations', () => {
    const { run } = setup();
    expect(isError(run([]))).toBe(true);
    expect(isError(run(Array.from({ length: 1001 }, (_, i) => setBlockOp(i))))).toBe(true);
  });
});

describe('batch through the server', () => {
  async function connect(dataDir: string) {
    const server = createServer({ dataDir, templateDir });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'c', version: '0.0.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
    return { server, client };
  }

  it('saves once per batch and keeps applied operations on disk after an error', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'mc-batchdata-'));
    try {
      const { server, client } = await connect(dataDir);
      await client.callTool({ name: 'createProject', arguments: { name: 'b' } });
      const spy = vi.spyOn(ProjectManager.prototype, 'saveActive');
      const ok = await client.callTool({
        name: 'batch',
        arguments: { operations: [setBlockOp(0), setBlockOp(1), setBlockOp(2)] }
      });
      expect(ok.isError).toBeFalsy();
      expect(spy).toHaveBeenCalledTimes(1);

      spy.mockClear();
      const failed = await client.callTool({
        name: 'batch',
        arguments: {
          operations: [setBlockOp(10), { tool: 'placeTemplate', args: { name: 'missing', at: { x: 0, y: 0, z: 0 } } }]
        }
      });
      expect(failed.isError).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      await client.close();
      await server.close();

      const loaded = loadProject(dataDir, 'b');
      expect(loaded.getBlock({ x: 2, y: 0, z: 0 })).toBeDefined();
      expect(loaded.getBlock({ x: 10, y: 0, z: 0 })).toBeDefined();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
