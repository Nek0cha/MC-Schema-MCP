import type { RenderType, Tint } from './types.js';

function strip(id: string): string {
  return id.startsWith('minecraft:') ? id.slice('minecraft:'.length) : id;
}

const TRANSLUCENT_EXACT = new Set(['ice', 'frosted_ice', 'slime_block', 'honey_block', 'water', 'nether_portal', 'tinted_glass', 'bubble_column']);

const CUTOUT_EXACT = new Set([
  'glass', 'glass_pane', 'iron_bars', 'chain', 'iron_chain', 'ladder', 'torch', 'wall_torch', 'soul_torch', 'soul_wall_torch',
  'redstone_torch', 'redstone_wall_torch', 'lantern', 'soul_lantern', 'cobweb', 'scaffolding', 'vine', 'glow_lichen',
  'short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'sugar_cane', 'bamboo', 'kelp', 'kelp_plant', 'seagrass',
  'tall_seagrass', 'lily_pad', 'sweet_berry_bush', 'cactus', 'hanging_roots', 'spore_blossom',
  'wheat', 'carrots', 'potatoes', 'beetroots', 'melon_stem', 'pumpkin_stem', 'attached_melon_stem', 'attached_pumpkin_stem',
  'poppy', 'dandelion', 'blue_orchid', 'allium', 'azure_bluet', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley',
  'wither_rose', 'torchflower', 'sunflower', 'lilac', 'rose_bush', 'peony', 'pink_petals', 'brown_mushroom', 'red_mushroom',
  'crimson_fungus', 'warped_fungus', 'crimson_roots', 'warped_roots', 'nether_sprouts', 'weeping_vines', 'weeping_vines_plant',
  'twisting_vines', 'twisting_vines_plant', 'cave_vines', 'cave_vines_plant', 'beacon', 'spawner', 'trial_spawner',
  'flower_pot', 'campfire', 'soul_campfire', 'bell', 'hopper', 'brewing_stand', 'repeater', 'comparator', 'redstone_wire',
  'tripwire', 'tripwire_hook', 'lever', 'end_rod', 'lightning_rod', 'conduit', 'turtle_egg', 'sea_pickle', 'azalea',
  'flowering_azalea', 'big_dripleaf', 'big_dripleaf_stem', 'small_dripleaf', 'mangrove_roots', 'mangrove_propagule',
  'pointed_dripstone', 'amethyst_cluster', 'large_amethyst_bud', 'medium_amethyst_bud', 'small_amethyst_bud', 'fire', 'soul_fire'
]);

const CUTOUT_SUFFIXES = [
  '_leaves', '_sapling', '_door', '_trapdoor', '_bars', '_chain', '_rail', '_coral', '_coral_fan', '_coral_wall_fan',
  '_tulip', '_candle', '_candles', '_lantern', '_button', '_pressure_plate', '_sign', '_hanging_sign', '_banner',
  '_head', '_skull', '_bed'
];

/**
 * Render type by id pattern. Block models don't carry this reliably, so it
 * is a hand-kept table; anything unknown is treated as opaque.
 */
export function renderTypeOf(id: string): RenderType {
  const name = strip(id);
  if (TRANSLUCENT_EXACT.has(name) || name.includes('stained_glass')) return 'translucent';
  if (name === 'rail' || CUTOUT_EXACT.has(name)) return 'cutout';
  if (name.startsWith('potted_')) return 'cutout';
  if (CUTOUT_SUFFIXES.some((suffix) => name.endsWith(suffix))) return 'cutout';
  return 'opaque';
}

const GRASS_TINTED = new Set(['grass_block', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'sugar_cane', 'potted_fern']);
const FOLIAGE_TINTED = new Set(['vine', 'lily_pad', 'mangrove_leaves', 'oak_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'spruce_leaves', 'birch_leaves']);

/** Tint applied to quads that declare a tintindex. */
export function tintOf(id: string): Tint {
  const name = strip(id);
  if (name === 'water' || name === 'water_cauldron' || name === 'bubble_column') return 'water';
  if (GRASS_TINTED.has(name)) return 'grass';
  if (FOLIAGE_TINTED.has(name) || name.endsWith('_leaves')) return 'foliage';
  return 'none';
}
