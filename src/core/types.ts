export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface BlockState {
  id: string;
  properties?: Record<string, string>;
}

export interface PaletteEntry {
  block: BlockState;
  weight: number;
}

export type Palette = PaletteEntry[];

/**
 * Renders a BlockState as a Minecraft blockstate string, e.g.
 * "minecraft:oak_stairs[facing=north,half=bottom]".
 */
export function blockStateKey(block: BlockState): string {
  if (!block.properties || Object.keys(block.properties).length === 0) {
    return block.id;
  }
  const props = Object.entries(block.properties)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
  return `${block.id}[${props}]`;
}
