import type { TargetVersion } from '../core/markers.js';

/**
 * NBT DataVersion for Minecraft Java Edition 1.21.11.
 * Source: https://minecraft.wiki/w/Java_Edition_1.21.11 (Data version: 4671).
 * Update this constant when targeting a different game version.
 */
export const DATA_VERSION = 4671;

/** DataVersion per supported target version (1.21.1 = 3955, 1.21.11 = 4671). */
export const DATA_VERSIONS: Record<TargetVersion, number> = {
  '1.21.1': 3955,
  '1.21.11': 4671
};
