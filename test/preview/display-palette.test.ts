import { describe, expect, it } from 'vitest';
import { DisplayPalette } from '../../src/preview/display-palette.js';
import { fixtureSource } from './models/fixture-source.js';

const empty = { readJson: () => undefined };

/** The fixture source plus a glass and a leaves block (both non-opaque). */
function withGlass() {
  const base = fixtureSource();
  const extra: Record<string, unknown> = {
    'blockstates/glass.json': { variants: { '': { model: 'minecraft:block/glass' } } },
    'models/block/glass.json': { parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/glass' } },
    'blockstates/oak_leaves.json': { variants: { '': { model: 'minecraft:block/oak_leaves' } } },
    'models/block/oak_leaves.json': { parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/oak_leaves' } }
  };
  return { readJson: (p: string) => (p in extra ? extra[p] : base.readJson(p)) };
}

describe('DisplayPalette', () => {
  it('numbers block states from 1 and returns the same id for the same state', () => {
    const p = new DisplayPalette(fixtureSource(), true);
    const a = p.idFor({ id: 'minecraft:stone' });
    const b = p.idFor({ id: 'minecraft:stone' });
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(p.idFor({ id: 'minecraft:stone', properties: { x: '1' } })).toBe(2);
  });

  it('returns only entries after n', () => {
    const p = new DisplayPalette(fixtureSource(), true);
    p.idFor({ id: 'minecraft:stone' });
    p.idFor({ id: 'minecraft:glass' });
    expect(p.entriesSince(1).map((e) => e.id)).toEqual([2]);
    expect(p.entriesSince(0).map((e) => e.id)).toEqual([1, 2]);
  });

  it('gives cull groups to non-opaque blocks except leaves', () => {
    const p = new DisplayPalette(withGlass(), true);
    p.idFor({ id: 'minecraft:glass' });
    p.idFor({ id: 'minecraft:oak_leaves' });
    p.idFor({ id: 'minecraft:stone' });
    const [g, l, s] = p.entriesSince(0);
    expect(g.cullGroup).toBe('minecraft:glass');
    expect(l.cullGroup).toBeNull();
    expect(s.cullGroup).toBeNull();
  });

  it('keeps ids stable and bumps the version when re-baked with a ready source', () => {
    const p = new DisplayPalette(empty, false);
    const id = p.idFor({ id: 'minecraft:stone' });
    expect(p.entriesSince(0)[0].model?.status).toBe('unresolved');
    const v = p.version;
    p.rebake(fixtureSource(), true);
    expect(p.version).toBe(v + 1);
    expect(p.entriesSince(0)[0].id).toBe(id);
    expect(p.entriesSince(0)[0].model?.status).toBe('ok');
  });

  it('colours by colorFor before assets are ready and reports colors as hex', () => {
    const p = new DisplayPalette(empty, false);
    p.idFor({ id: 'minecraft:stone' });
    expect(p.entriesSince(0)[0].color).toBe('#8a8a8a');
    p.idFor({ id: 'minecraft:definitely_unknown' });
    expect(p.entriesSince(0)[1].color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('treats air as no display block', () => {
    const p = new DisplayPalette(fixtureSource(), true);
    expect(p.idFor({ id: 'minecraft:air' })).toBe(0);
  });
});
