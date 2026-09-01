import type { BuildProject } from './build-project.js';
import type { BlockState, Palette, Vec3 } from './types.js';

export type BlockOrPalette = BlockState | Palette;

function isPalette(value: BlockOrPalette): value is Palette {
  return Array.isArray(value);
}

function resolveBlock(value: BlockOrPalette): BlockState {
  if (!isPalette(value)) {
    return value;
  }
  if (value.length === 0) {
    throw new Error('Palette must contain at least one entry.');
  }
  const totalWeight = value.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const entry of value) {
    roll -= entry.weight;
    if (roll <= 0) {
      return entry.block;
    }
  }
  return value[value.length - 1].block;
}

function sortMinMax(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function pointsAlongLine(from: Vec3, to: Vec3): Vec3[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz), 1);
  const points: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: Math.round(from.x + dx * t),
      y: Math.round(from.y + dy * t),
      z: Math.round(from.z + dz * t)
    });
  }
  return points;
}

export function fillBox(project: BuildProject, from: Vec3, to: Vec3, block: BlockOrPalette): void {
  const [minX, maxX] = sortMinMax(from.x, to.x);
  const [minY, maxY] = sortMinMax(from.y, to.y);
  const [minZ, maxZ] = sortMinMax(from.z, to.z);
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        project.setBlock({ x, y, z }, resolveBlock(block));
      }
    }
  }
}

export function outlineBox(project: BuildProject, from: Vec3, to: Vec3, block: BlockOrPalette): void {
  const [minX, maxX] = sortMinMax(from.x, to.x);
  const [minY, maxY] = sortMinMax(from.y, to.y);
  const [minZ, maxZ] = sortMinMax(from.z, to.z);
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        const onShell =
          x === minX || x === maxX || y === minY || y === maxY || z === minZ || z === maxZ;
        if (onShell) {
          project.setBlock({ x, y, z }, resolveBlock(block));
        }
      }
    }
  }
}

export function line(project: BuildProject, from: Vec3, to: Vec3, block: BlockOrPalette): void {
  for (const pos of pointsAlongLine(from, to)) {
    project.setBlock(pos, resolveBlock(block));
  }
}

export function wall(
  project: BuildProject,
  from: Vec3,
  to: Vec3,
  height: number,
  block: BlockOrPalette
): void {
  if (height < 1) {
    throw new Error(`wall height must be at least 1, got ${height}.`);
  }
  for (const basePos of pointsAlongLine(from, to)) {
    for (let dy = 0; dy < height; dy++) {
      project.setBlock({ x: basePos.x, y: basePos.y + dy, z: basePos.z }, resolveBlock(block));
    }
  }
}

export function sphere(
  project: BuildProject,
  center: Vec3,
  radius: number,
  block: BlockOrPalette,
  hollow = false
): void {
  if (radius < 0) {
    throw new Error(`sphere radius must be non-negative, got ${radius}.`);
  }
  const r = Math.round(radius);
  const rSquared = r * r;
  // Below radius 2 there's no interior layer to hollow out (r-1 would be
  // 0 or negative), so hollow degrades to solid rather than silently
  // placing nothing.
  const innerSquared = hollow && r >= 2 ? (r - 1) * (r - 1) : -1;

  for (let x = -r; x <= r; x++) {
    for (let y = -r; y <= r; y++) {
      for (let z = -r; z <= r; z++) {
        const distSquared = x * x + y * y + z * z;
        if (distSquared > rSquared) continue;
        if (hollow && distSquared < innerSquared) continue;
        project.setBlock(
          { x: center.x + x, y: center.y + y, z: center.z + z },
          resolveBlock(block)
        );
      }
    }
  }
}

export function cylinder(
  project: BuildProject,
  center: Vec3,
  radius: number,
  height: number,
  block: BlockOrPalette,
  hollow = false
): void {
  if (radius < 0) {
    throw new Error(`cylinder radius must be non-negative, got ${radius}.`);
  }
  if (height < 1) {
    throw new Error(`cylinder height must be at least 1, got ${height}.`);
  }
  const r = Math.round(radius);
  const rSquared = r * r;
  // Below radius 2 there's no interior layer to hollow out (r-1 would be
  // 0 or negative), so hollow degrades to solid rather than silently
  // placing nothing.
  const innerSquared = hollow && r >= 2 ? (r - 1) * (r - 1) : -1;

  for (let dy = 0; dy < height; dy++) {
    for (let x = -r; x <= r; x++) {
      for (let z = -r; z <= r; z++) {
        const distSquared = x * x + z * z;
        if (distSquared > rSquared) continue;
        if (hollow && distSquared < innerSquared) continue;
        project.setBlock(
          { x: center.x + x, y: center.y + dy, z: center.z + z },
          resolveBlock(block)
        );
      }
    }
  }
}
