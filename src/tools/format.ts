import type { BoundingBox } from '../core/build-project.js';
import type { Vec3 } from '../core/types.js';

export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatPos(pos: Vec3): string {
  return `(${pos.x}, ${pos.y}, ${pos.z})`;
}

export function formatBounds(bounds: BoundingBox | null): string {
  return bounds ? `${formatPos(bounds.min)}..${formatPos(bounds.max)}` : '(empty)';
}
