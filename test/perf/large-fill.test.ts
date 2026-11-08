import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BuildProject } from '../../src/core/build-project.js';
import { loadProject, saveProject } from '../../src/core/project-store.js';
import { fillBox } from '../../src/core/shapes.js';

const MB = 1024 * 1024;

function memoryUsed(): number {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  const m = process.memoryUsage();
  // arrayBuffers covers the Uint16Array chunk storage, which lives outside the JS heap.
  return m.heapUsed + m.arrayBuffers;
}

describe('large fill performance (400x80x400)', () => {
  const root = mkdtempSync(join(tmpdir(), 'mc-perf-'));
  const project = new BuildProject('perf');
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('fills 400x80x400 within 10s and 200MB of memory', () => {
    const before = memoryUsed();
    const t0 = performance.now();
    fillBox(project, { x: 0, y: -16, z: 0 }, { x: 399, y: 63, z: 399 }, { id: 'minecraft:stone' });
    const elapsed = performance.now() - t0;
    const delta = memoryUsed() - before;
    console.log(`fill: ${elapsed.toFixed(0)} ms, memory delta: ${(delta / MB).toFixed(1)} MB`);
    expect(project.blockCount).toBe(400 * 80 * 400);
    expect(elapsed).toBeLessThan(10_000);
    expect(delta).toBeLessThan(200 * MB);
  });

  it('saves that fill within 15s total and a single-block follow-up save within 1s', () => {
    const t0 = performance.now();
    saveProject(root, project);
    const full = performance.now() - t0;

    project.setBlock({ x: 5, y: 0, z: 5 }, { id: 'minecraft:dirt' });
    const t1 = performance.now();
    saveProject(root, project);
    const followUp = performance.now() - t1;

    const t2 = performance.now();
    const loaded = loadProject(root, 'perf');
    const loadTime = performance.now() - t2;

    console.log(
      `full save: ${full.toFixed(0)} ms, follow-up save: ${followUp.toFixed(0)} ms, load: ${loadTime.toFixed(0)} ms`
    );
    expect(full).toBeLessThan(15_000);
    expect(followUp).toBeLessThan(1_000);
    expect(loaded.blockCount).toBe(project.blockCount);
  });
}, 120_000);
