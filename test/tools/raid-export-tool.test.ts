import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ProjectManager } from '../../src/core/project-manager.js';
import { fillBox } from '../../src/core/shapes.js';
import { AssetStore } from '../../src/preview/assets/asset-store.js';
import { createPreviewServerState } from '../../src/tools/preview-tools.js';
import { exportRaidMapHandler, setMapSettingsHandler, validateRaidMapHandler } from '../../src/tools/raid-tools.js';
import { buildToolDefs } from '../../src/tools/registry.js';

const root = mkdtempSync(join(tmpdir(), 'mc-raid-tool-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function setup() {
  const manager = new ProjectManager();
  const project = manager.createProject('raid');
  setMapSettingsHandler(manager, { id: 'tiny', name: 'Tiny', size: [20, 6, 20] });
  fillBox(project, { x: 0, y: 0, z: 0 }, { x: 19, y: 0, z: 19 }, { id: 'minecraft:stone' });
  return manager;
}

// Assets that can never be downloaded: the export must go on with a "could not check" warning.
const offline = () =>
  createPreviewServerState(
    new AssetStore({ cacheDir: join(root, 'cache'), version: '1.21.1', fetchImpl: (async () => { throw new Error('offline'); }) as typeof fetch })
  );

describe('validateRaidMap / exportRaidMap tools', () => {
  it('are registered and do not mutate the project', () => {
    const defs = buildToolDefs();
    expect(defs.find((d) => d.name === 'validateRaidMap')).toMatchObject({ mutating: false, batchable: false });
    expect(defs.find((d) => d.name === 'exportRaidMap')).toMatchObject({ mutating: false, batchable: false });
  });

  it('both explain that setMapSettings is needed', async () => {
    const manager = new ProjectManager();
    manager.createProject('plain');
    expect(() => validateRaidMapHandler(manager)).toThrow(/setMapSettings/);
    await expect(exportRaidMapHandler(manager, offline(), {})).rejects.toThrow(/setMapSettings/);
  });

  it('validateRaidMap reports without exporting or flagging missing files', () => {
    const text = validateRaidMapHandler(setup()).content[0].text;
    expect(text).not.toMatch(/preview\.png could not|tile file/i);
    expect(text).not.toContain('Exported to');
  });

  it('exportRaidMap writes the files, reports the folder and a compat warning when offline', async () => {
    const out = join(root, 'out');
    const text = (await exportRaidMapHandler(setup(), offline(), { outputDir: out }, 5_000)).content[0].text;
    expect(text).toContain('Exported to');
    expect(text).toContain(out);
    expect(existsSync(join(out, 'tiles', 'tile_0_0.nbt'))).toBe(true);
    expect(existsSync(join(out, 'preview.png'))).toBe(true);
    const validation = JSON.parse(readFileSync(join(out, 'validation.json'), 'utf8'));
    expect(validation.warnings.some((w: { check: number }) => w.check === 12)).toBe(true);
  });
});
