/**
 * Camera poses for the fixed view presets. Pure math, no three.js, so it is
 * testable in Node. Minecraft axes: +X east, -Z north, +Y up.
 */
export type ViewPreset = 'top' | 'iso_ne' | 'iso_nw' | 'iso_se' | 'iso_sw' | 'north' | 'south' | 'east' | 'west';

export const VIEW_PRESETS: readonly ViewPreset[] = ['top', 'iso_ne', 'iso_nw', 'iso_se', 'iso_sw', 'north', 'south', 'east', 'west'];

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
}

export interface Bounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

const ISO_ELEVATION_DEG = 35;

/** Unit vector from the target toward the camera. */
function directionOf(preset: ViewPreset): [number, number, number] {
  const e = (ISO_ELEVATION_DEG * Math.PI) / 180;
  const h = Math.cos(e) / Math.SQRT2;
  const v = Math.sin(e);
  switch (preset) {
    case 'top':
      return [0, 1, 0];
    case 'iso_ne':
      return [h, v, -h];
    case 'iso_nw':
      return [-h, v, -h];
    case 'iso_se':
      return [h, v, h];
    case 'iso_sw':
      return [-h, v, h];
    case 'north':
      return [0, 0, -1];
    case 'south':
      return [0, 0, 1];
    case 'east':
      return [1, 0, 0];
    case 'west':
      return [-1, 0, 0];
  }
}

/**
 * Places the camera so the whole block box (max is inclusive, so the box ends
 * at max + 1) fits a perspective view with vertical field of view `fovDeg`.
 * The top view uses -Z as the screen-up direction so north is at the top.
 */
export function presetPose(preset: ViewPreset, bounds: Bounds, fovDeg: number, aspect: number): CameraPose {
  const lo = [bounds.min.x, bounds.min.y, bounds.min.z];
  const hi = [bounds.max.x + 1, bounds.max.y + 1, bounds.max.z + 1];
  const target: [number, number, number] = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const radius = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
  const vHalf = (fovDeg * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const distance = radius / Math.sin(Math.min(vHalf, hHalf));
  const d = directionOf(preset);
  return {
    position: [target[0] + d[0] * distance, target[1] + d[1] * distance, target[2] + d[2] * distance],
    target,
    up: preset === 'top' ? [0, 0, -1] : [0, 1, 0]
  };
}
