import type { BlockState, Vec3 } from './types.js';

export interface BoundingBox {
  min: Vec3;
  max: Vec3;
}

export function voxelKey(pos: Vec3): string {
  return `${pos.x},${pos.y},${pos.z}`;
}

export class BuildProject {
  readonly name: string;
  readonly voxels = new Map<string, BlockState>();

  constructor(name: string) {
    this.name = name;
  }

  setBlock(pos: Vec3, block: BlockState): void {
    this.voxels.set(voxelKey(pos), block);
  }

  getBlock(pos: Vec3): BlockState | undefined {
    return this.voxels.get(voxelKey(pos));
  }

  getBoundingBox(): BoundingBox | null {
    if (this.voxels.size === 0) {
      return null;
    }
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const key of this.voxels.keys()) {
      const [x, y, z] = key.split(',').map(Number);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
  }

  getBlockCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const block of this.voxels.values()) {
      counts[block.id] = (counts[block.id] ?? 0) + 1;
    }
    return counts;
  }
}
