import type { ModelSource } from '../../../src/preview/models/types.js';

/**
 * Hand-written stand-ins for vanilla blockstates/models. They mirror the
 * structure of the real files but are not copied from the game assets.
 */
const files: Record<string, unknown> = {
  'models/block/block.json': { textures: { particle: '#all' } },
  'models/block/cube.json': {
    parent: 'block/block',
    elements: [
      {
        from: [0, 0, 0],
        to: [16, 16, 16],
        faces: {
          down: { texture: '#down', cullface: 'down' },
          up: { texture: '#up', cullface: 'up' },
          north: { texture: '#north', cullface: 'north' },
          south: { texture: '#south', cullface: 'south' },
          west: { texture: '#west', cullface: 'west' },
          east: { texture: '#east', cullface: 'east' }
        }
      }
    ]
  },
  'models/block/cube_all.json': {
    parent: 'block/cube',
    textures: { down: '#all', up: '#all', north: '#all', south: '#all', west: '#all', east: '#all' }
  },
  'models/block/stone.json': { parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/stone' } },
  'blockstates/stone.json': { variants: { '': { model: 'minecraft:block/stone' } } },

  'models/block/grass_block.json': {
    parent: 'block/block',
    textures: { top: 'block/grass_block_top', side: 'block/grass_block_side', bottom: 'block/dirt' },
    elements: [
      {
        from: [0, 0, 0],
        to: [16, 16, 16],
        faces: {
          up: { texture: '#top', cullface: 'up', tintindex: 0 },
          down: { texture: '#bottom', cullface: 'down' },
          north: { texture: '#side', cullface: 'north' },
          south: { texture: '#side', cullface: 'south' },
          west: { texture: '#side', cullface: 'west' },
          east: { texture: '#side', cullface: 'east' }
        }
      }
    ]
  },
  'blockstates/grass_block.json': { variants: { 'snowy=false': { model: 'block/grass_block' }, 'snowy=true': { model: 'block/stone' } } },

  'models/block/slab.json': {
    textures: { particle: '#side' },
    elements: [
      {
        from: [0, 0, 0],
        to: [16, 8, 16],
        faces: {
          down: { texture: '#bottom', cullface: 'down' },
          up: { texture: '#top' },
          north: { texture: '#side', cullface: 'north' },
          south: { texture: '#side', cullface: 'south' },
          west: { texture: '#side', cullface: 'west' },
          east: { texture: '#side', cullface: 'east' }
        }
      }
    ]
  },
  'models/block/oak_slab.json': {
    parent: 'block/slab',
    textures: { bottom: 'block/oak_planks', top: 'block/oak_planks', side: 'block/oak_planks' }
  },
  'blockstates/oak_slab.json': {
    variants: {
      'type=bottom': { model: 'block/oak_slab' },
      'type=top': { model: 'block/oak_slab', x: 180 },
      'type=double': { model: 'block/stone' }
    }
  },

  // Simplified stairs: a bottom slab plus a back step on the east half (vanilla stairs face east by default).
  'models/block/stairs.json': {
    textures: { particle: '#side' },
    elements: [
      {
        from: [0, 0, 0],
        to: [16, 8, 16],
        faces: {
          down: { texture: '#bottom', cullface: 'down' },
          up: { texture: '#top' },
          north: { texture: '#side', cullface: 'north' },
          south: { texture: '#side', cullface: 'south' },
          west: { texture: '#side', cullface: 'west' },
          east: { texture: '#side', cullface: 'east' }
        }
      },
      {
        from: [8, 8, 0],
        to: [16, 16, 16],
        faces: {
          up: { texture: '#top', cullface: 'up' },
          north: { texture: '#side', cullface: 'north' },
          south: { texture: '#side', cullface: 'south' },
          west: { texture: '#side' },
          east: { texture: '#side', cullface: 'east' }
        }
      }
    ]
  },
  'models/block/oak_stairs.json': {
    parent: 'block/stairs',
    textures: { bottom: 'block/oak_planks', top: 'block/oak_planks', side: 'block/oak_planks' }
  },
  'blockstates/oak_stairs.json': {
    variants: {
      'facing=east,half=bottom,shape=straight': { model: 'block/oak_stairs' },
      'facing=south,half=bottom,shape=straight': { model: 'block/oak_stairs', y: 90, uvlock: true },
      'facing=west,half=bottom,shape=straight': { model: 'block/oak_stairs', y: 180, uvlock: true },
      'facing=north,half=bottom,shape=straight': { model: 'block/oak_stairs', y: 270, uvlock: true }
    }
  },

  'models/block/fence_post.json': {
    textures: { particle: '#texture' },
    elements: [{ from: [6, 0, 6], to: [10, 16, 10], faces: { up: { texture: '#texture', cullface: 'up' }, north: { texture: '#texture' } } }]
  },
  'models/block/fence_side.json': {
    textures: { particle: '#texture' },
    elements: [{ from: [7, 12, 0], to: [9, 15, 9], faces: { north: { texture: '#texture', cullface: 'north' } } }]
  },
  'models/block/oak_fence_post.json': { parent: 'block/fence_post', textures: { texture: 'block/oak_planks' } },
  'models/block/oak_fence_side.json': { parent: 'block/fence_side', textures: { texture: 'block/oak_planks' } },
  'blockstates/oak_fence.json': {
    multipart: [
      { apply: { model: 'block/oak_fence_post' } },
      { when: { north: 'true' }, apply: { model: 'block/oak_fence_side', uvlock: true } },
      { when: { east: 'true' }, apply: { model: 'block/oak_fence_side', y: 90, uvlock: true } },
      { when: { OR: [{ south: 'true' }, { west: 'true|low' }] }, apply: { model: 'block/oak_fence_side', y: 180, uvlock: true } }
    ]
  },

  'models/block/tilted.json': {
    textures: { t: 'block/stone' },
    elements: [
      {
        from: [0, 0, 8],
        to: [16, 16, 8],
        rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true },
        shade: false,
        faces: { north: { texture: '#t', uv: [0, 0, 16, 16], rotation: 90 } }
      }
    ]
  },
  'blockstates/tilted.json': { variants: { '': { model: 'block/tilted' } } },

  'models/block/chest.json': { textures: { particle: 'block/oak_planks' } },
  'blockstates/chest.json': { variants: { 'facing=north': { model: 'block/chest' } } },

  'models/block/oak_leaves.json': { parent: 'block/cube_all', textures: { all: 'block/oak_leaves' } },
  'blockstates/oak_leaves.json': { variants: { '': { model: 'block/oak_leaves' } } },

  'blockstates/broken_parent.json': { variants: { '': { model: 'block/broken_parent' } } },
  'models/block/broken_parent.json': { parent: 'block/does_not_exist' }
};

export function fixtureSource(): ModelSource {
  return { readJson: (relPath: string) => files[relPath] };
}
