import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BuildProject } from '../../src/core/build-project.js';
import { fillBox } from '../../src/core/shapes.js';
import {
  listTemplateFiles,
  loadTemplateFile,
  moveTemplateToTrash
} from '../../src/core/template-store.js';
import { MAX_TEMPLATE_CELLS, placeTemplate, saveTemplate } from '../../src/core/templates.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mc-tpl-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const stone = { id: 'minecraft:stone' };

function dump(p: BuildProject): string[] {
  const out: string[] = [];
  p.forEachBlock((pos, block) =>
    out.push(`${pos.x},${pos.y},${pos.z}=${block.id}${block.properties ? JSON.stringify(block.properties) : ''}`)
  );
  return out.sort();
}

describe('templates', () => {
  it('round-trips a template through disk', () => {
    const src = new BuildProject('src');
    src.setBlock({ x: 10, y: 0, z: 10 }, stone);
    src.setBlock({ x: 12, y: 1, z: 10 }, { id: 'minecraft:oak_stairs', properties: { facing: 'north', half: 'top' } });
    src.setBlock({ x: 11, y: 0, z: 11 }, { id: 'minecraft:air' });
    // (11,0,10) etc. stay unset

    const info = saveTemplate(root, src, 'tower', { x: 10, y: 0, z: 10 }, { x: 12, y: 1, z: 11 }, {
      description: 'a test tower'
    });
    expect(info).toMatchObject({ name: 'tower', description: 'a test tower', size: [3, 2, 2] });

    const loaded = loadTemplateFile(root, 'tower');
    expect(loaded.size).toEqual([3, 2, 2]);
    expect(loaded.blocks.length).toBe(12);
    expect(loaded.palette[0]).toBeNull();
    expect(listTemplateFiles(root).map((t) => t.name)).toEqual(['tower']);

    const dest = new BuildProject('dest');
    const result = placeTemplate(root, dest, 'tower', { x: 100, y: 5, z: 100 });
    // Default anchor: bottom-center, floor((size-1)/2) on x and z -> offset (1,0,0).
    expect(dump(dest)).toEqual([
      '100,5,101=minecraft:air',
      '101,6,100=minecraft:oak_stairs{"facing":"north","half":"top"}',
      '99,5,100=minecraft:stone'
    ]);
    expect(result.changed).toBe(3);
  });

  it('stores the anchor relative to the template corner and defaults to the bottom center', () => {
    const src = new BuildProject('src');
    fillBox(src, { x: 0, y: 3, z: 0 }, { x: 4, y: 5, z: 2 }, stone);
    expect(saveTemplate(root, src, 'a', { x: 0, y: 3, z: 0 }, { x: 4, y: 5, z: 2 }).anchor).toEqual([2, 0, 1]);
    expect(
      saveTemplate(root, src, 'b', { x: 0, y: 3, z: 0 }, { x: 4, y: 5, z: 2 }, { anchor: { x: 2, y: 3, z: 5 } }).anchor
    ).toEqual([2, 0, 5]);
    expect(loadTemplateFile(root, 'b').anchor).toEqual([2, 0, 5]);
  });

  it('places so the transformed anchor lands on `at`', () => {
    const src = new BuildProject('src');
    // template (0,0,0)..(4,2,2), anchor (2,0,2); marker at (4,0,0)
    src.setBlock({ x: 0, y: 0, z: 0 }, stone);
    src.setBlock({ x: 4, y: 0, z: 0 }, { id: 'minecraft:gold_block' });
    src.setBlock({ x: 4, y: 2, z: 2 }, stone);
    saveTemplate(root, src, 'house', { x: 0, y: 0, z: 0 }, { x: 4, y: 2, z: 2 }, { anchor: { x: 2, y: 0, z: 2 } });

    const dest = new BuildProject('dest');
    const result = placeTemplate(root, dest, 'house', { x: 100, y: 10, z: 100 }, { rotate: 90 });
    // marker offset from anchor (2,0,-2) rotated 90 -> (2,0,2)
    expect(dest.getBlock({ x: 102, y: 10, z: 102 })?.id).toBe('minecraft:gold_block');
    // corner (0,0,0): offset (-2,0,-2) -> (2,0,-2)
    expect(dest.getBlock({ x: 102, y: 10, z: 98 })?.id).toBe('minecraft:stone');
    expect(result.bounds).toEqual({ min: { x: 100, y: 10, z: 98 }, max: { x: 102, y: 12, z: 102 } });
    expect(result.changed).toBe(3);

    const flipped = new BuildProject('flipped');
    placeTemplate(root, flipped, 'house', { x: 0, y: 0, z: 0 }, { flip: 'x' });
    expect(flipped.getBlock({ x: -2, y: 0, z: -2 })?.id).toBe('minecraft:gold_block');
  });

  it('applies replace before rotation', () => {
    const src = new BuildProject('src');
    src.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:oak_stairs', properties: { facing: 'north' } });
    src.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:oak_stairs', properties: { facing: 'south' } });
    saveTemplate(root, src, 'stairs', { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { anchor: { x: 0, y: 0, z: 0 } });

    const dest = new BuildProject('dest');
    placeTemplate(root, dest, 'stairs', { x: 0, y: 0, z: 0 }, {
      rotate: 90,
      replace: [
        { match: [{ id: 'oak_stairs', properties: { facing: 'north' } }], replacement: { id: 'minecraft:spruce_stairs' } }
      ]
    });
    expect(dest.getBlock({ x: 0, y: 0, z: 0 })).toEqual({
      id: 'minecraft:spruce_stairs',
      properties: { facing: 'east' }
    });
    // Unmatched: south stairs become west stairs and stay oak.
    expect(dest.getBlock({ x: 0, y: 0, z: 1 })).toEqual({ id: 'minecraft:oak_stairs', properties: { facing: 'west' } });
  });

  it('uses the first matching replace rule and is reproducible with a seed', () => {
    const src = new BuildProject('src');
    fillBox(src, { x: 0, y: 0, z: 0 }, { x: 7, y: 0, z: 7 }, stone);
    saveTemplate(root, src, 'floor', { x: 0, y: 0, z: 0 }, { x: 7, y: 0, z: 7 });
    const palette = [
      { block: { id: 'minecraft:dirt' }, weight: 1 },
      { block: { id: 'minecraft:gravel' }, weight: 1 }
    ];
    const run = (seed: number) => {
      const dest = new BuildProject('dest');
      placeTemplate(root, dest, 'floor', { x: 0, y: 0, z: 0 }, {
        seed,
        replace: [
          { match: [{ id: 'stone' }], replacement: palette },
          { match: [{ id: 'stone' }], replacement: { id: 'minecraft:diamond_block' } }
        ]
      });
      return dump(dest);
    };
    expect(run(4)).toEqual(run(4));
    expect(run(4)).not.toEqual(run(5));
    expect(run(4).some((s) => s.includes('diamond_block'))).toBe(false);
  });

  it('does not overwrite destination cells from unset template cells, but air overwrites', () => {
    const src = new BuildProject('src');
    src.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:air' });
    src.setBlock({ x: 2, y: 0, z: 0 }, stone);
    saveTemplate(root, src, 'gap', { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { anchor: { x: 0, y: 0, z: 0 } });

    const dest = new BuildProject('dest');
    for (let x = 0; x < 3; x++) dest.setBlock({ x, y: 0, z: 0 }, { id: 'minecraft:dirt' });
    placeTemplate(root, dest, 'gap', { x: 0, y: 0, z: 0 });
    expect(dest.getBlock({ x: 0, y: 0, z: 0 })?.id).toBe('minecraft:air');
    expect(dest.getBlock({ x: 1, y: 0, z: 0 })?.id).toBe('minecraft:dirt');
    expect(dest.getBlock({ x: 2, y: 0, z: 0 })?.id).toBe('minecraft:stone');
  });

  it('rejects templates over 2,097,152 cells and empty ranges', () => {
    expect(MAX_TEMPLATE_CELLS).toBe(2_097_152);
    const src = new BuildProject('src');
    src.setBlock({ x: 0, y: 0, z: 0 }, stone);
    expect(() => saveTemplate(root, src, 'big', { x: 0, y: 0, z: 0 }, { x: 128, y: 127, z: 127 })).toThrow(
      /2,097,152/
    );
    expect(() => saveTemplate(root, src, 'empty', { x: 5, y: 5, z: 5 }, { x: 6, y: 6, z: 6 })).toThrow(/no blocks/i);
    expect(existsSync(join(root, 'big.json'))).toBe(false);
  });

  it('refuses to overwrite unless asked and treats names case-insensitively', () => {
    const src = new BuildProject('src');
    src.setBlock({ x: 0, y: 0, z: 0 }, stone);
    const save = (name: string, overwrite?: boolean) =>
      saveTemplate(root, src, name, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { overwrite });
    save('Tower');
    expect(() => save('tower')).toThrow(/already exists/);
    expect(() => save('TOWER', false)).toThrow(/already exists/);
    save('tower', true);
    expect(listTemplateFiles(root).map((t) => t.name)).toEqual(['tower']);
    expect(loadTemplateFile(root, 'TOWER').name).toBe('tower');
    expect(readdirSync(root).filter((f) => f.endsWith('.json'))).toHaveLength(1);
  });

  it('rejects unsafe names', () => {
    const src = new BuildProject('src');
    src.setBlock({ x: 0, y: 0, z: 0 }, stone);
    for (const name of ['../evil', 'a/b', 'con', 'trailing ', '']) {
      expect(() => saveTemplate(root, src, name, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), name).toThrow();
    }
    expect(() => loadTemplateFile(root, '../evil')).toThrow();
  });

  it('moves deleted templates to trash and hides them from the list', () => {
    const src = new BuildProject('src');
    src.setBlock({ x: 0, y: 0, z: 0 }, stone);
    saveTemplate(root, src, 'gone', { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    const trashed = moveTemplateToTrash(root, 'GONE');
    expect(existsSync(trashed)).toBe(true);
    expect(trashed).toContain('.trash');
    expect(listTemplateFiles(root)).toEqual([]);
    expect(() => loadTemplateFile(root, 'gone')).toThrow(/does not exist/);
    expect(() => moveTemplateToTrash(root, 'gone')).toThrow(/does not exist/);
  });

  it('reports a missing or corrupt template clearly', () => {
    const dest = new BuildProject('dest');
    expect(() => placeTemplate(root, dest, 'nope', { x: 0, y: 0, z: 0 })).toThrow(/does not exist/);
    writeFileSync(join(root, 'bad.json'), '{not json');
    expect(() => loadTemplateFile(root, 'bad')).toThrow(/bad/);
    expect(listTemplateFiles(root)).toEqual([]);
  });

  it('rejects stored templates whose size exceeds the limit', () => {
    const src = new BuildProject('src');
    src.setBlock({ x: 0, y: 0, z: 0 }, stone);
    saveTemplate(root, src, 'tiny', { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    const file = join(root, 'tiny.json');
    const json = JSON.parse(readFileSync(file, 'utf8'));
    json.size = [4000, 4000, 4000];
    writeFileSync(file, JSON.stringify(json));
    expect(() => loadTemplateFile(root, 'tiny')).toThrow();
  });

  describe('markers inside templates', () => {
    function source(): BuildProject {
      const src = new BuildProject('src');
      fillBox(src, { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 4 }, stone);
      // Anchor will be (2, 0, 2); a crate at (4, 1, 3) and an enemy at (0, 1, 1).
      src.addMarkers([
        { kind: 'loot', pos: [4, 1, 3], type: 'crate', tier: 2 },
        { kind: 'enemy_spawn', pos: [0, 1, 1], squadSize: [1, 2], tier: 1 },
        { kind: 'player_spawn', pos: [1, 1, 1], facing: 0 },
        { kind: 'loot', pos: [40, 1, 3], type: 'safe', tier: 3 }
      ]);
      return src;
    }

    it('saves only loot and enemy_spawn markers inside the range, relative to the anchor', () => {
      saveTemplate(root, source(), 'house', { x: 0, y: 0, z: 0 }, { x: 4, y: 3, z: 4 }, { anchor: { x: 2, y: 0, z: 2 } });
      expect(loadTemplateFile(root, 'house').markers).toEqual([
        { kind: 'loot', pos: [2, 1, 1], type: 'crate', tier: 2 },
        { kind: 'enemy_spawn', pos: [-2, 1, -1], squadSize: [1, 2], tier: 1 }
      ]);
    });

    it('places markers translated, and rotated together with the blocks', () => {
      saveTemplate(root, source(), 'house', { x: 0, y: 0, z: 0 }, { x: 4, y: 3, z: 4 }, { anchor: { x: 2, y: 0, z: 2 } });
      const dest = new BuildProject('dest');
      const plain = placeTemplate(root, dest, 'house', { x: 100, y: 10, z: 100 });
      expect(plain.markers).toBe(2);
      expect(dest.getMarkers().map((m) => (m as { pos: number[] }).pos)).toEqual([
        [102, 11, 101],
        [98, 11, 99]
      ]);

      const rotated = new BuildProject('rot');
      placeTemplate(root, rotated, 'house', { x: 100, y: 10, z: 100 }, { rotate: 90 });
      // Offset (2, 1, 1) rotated 90 degrees -> (-1, 1, 2); (-2, 1, -1) -> (1, 1, -2).
      expect(rotated.getMarkers().map((m) => (m as { pos: number[] }).pos)).toEqual([
        [99, 11, 102],
        [101, 11, 98]
      ]);
      expect(rotated.getMarkers()[0]).toMatchObject({ kind: 'loot', type: 'crate', tier: 2 });
    });

    it('does not add a markers field or count when the range has no markers', () => {
      const src = new BuildProject('src');
      fillBox(src, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 2 }, stone);
      saveTemplate(root, src, 'plain', { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 2 });
      expect(loadTemplateFile(root, 'plain').markers).toBeUndefined();
      const result = placeTemplate(root, new BuildProject('d'), 'plain', { x: 0, y: 0, z: 0 });
      expect(result.markers).toBeUndefined();
    });
  });
});
