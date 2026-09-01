/**
 * Hand-picked colors for blocks that are common enough to deserve a
 * natural-looking color instead of a hashed one. Not exhaustive by
 * design — everything else falls back to colorFor's hash-based color.
 */
export const MANUAL_COLORS: Record<string, string> = {
  'minecraft:air': '#2a2a2a',
  'minecraft:stone': '#8a8a8a',
  'minecraft:cobblestone': '#7a7a7a',
  'minecraft:dirt': '#7a5230',
  'minecraft:grass_block': '#5b8a3c',
  'minecraft:oak_planks': '#b98b52',
  'minecraft:oak_log': '#6b5233',
  'minecraft:sand': '#ded2a0',
  'minecraft:gravel': '#8d8478',
  'minecraft:water': '#3d6fd1',
  'minecraft:glass': '#bfe3f0',
  'minecraft:white_wool': '#e8e8e8',
  'minecraft:bricks': '#9a5040',
  'minecraft:iron_bars': '#a8a8a8',
  'minecraft:oak_fence': '#b98b52',
  'minecraft:cobblestone_wall': '#7a7a7a'
};

/**
 * A simple, fast string hash (djb2-ish). Only used to pick a color, so it
 * doesn't need to be cryptographically sound — just deterministic and
 * reasonably well-distributed across the hue circle.
 */
function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function colorFor(blockId: string): string {
  const manual = MANUAL_COLORS[blockId];
  if (manual) {
    return manual;
  }
  const hue = hashString(blockId) % 360;
  return `hsl(${hue}, 55%, 55%)`;
}
