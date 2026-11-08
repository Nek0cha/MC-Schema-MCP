import { describe, expect, it } from 'vitest';
import { presetPose, type CameraPose, type ViewPreset } from '../../../src/preview/client/camera-presets.js';

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

function basis(p: CameraPose) {
  const forward = norm(sub(p.target, p.position));
  const right = norm(cross(forward, p.up));
  const up = cross(right, forward);
  return { forward, right, up };
}

const bounds = { min: { x: 0, y: -16, z: 0 }, max: { x: 399, y: 63, z: 299 } };

describe('presetPose', () => {
  it('north view stands on the north side and puts +X on the screen left', () => {
    const p = presetPose('north', bounds, 50, 1.6);
    expect(p.position[2]).toBeLessThan(p.target[2]);
    expect(basis(p).right[0]).toBeLessThan(-0.99);
  });

  it('south view puts +X on the screen right', () => {
    expect(basis(presetPose('south', bounds, 50, 1.6)).right[0]).toBeGreaterThan(0.99);
  });

  it('east and west views look along the x axis', () => {
    expect(basis(presetPose('east', bounds, 50, 1.6)).forward[0]).toBeLessThan(-0.99);
    expect(basis(presetPose('west', bounds, 50, 1.6)).forward[0]).toBeGreaterThan(0.99);
  });

  it('top view puts -Z at the screen top and +X at the right', () => {
    const b = basis(presetPose('top', bounds, 50, 1.6));
    expect(b.forward[1]).toBeLessThan(-0.99);
    expect(b.up[2]).toBeLessThan(-0.99);
    expect(b.right[0]).toBeGreaterThan(0.99);
  });

  it.each([
    ['iso_ne', 1, -1],
    ['iso_nw', -1, -1],
    ['iso_se', 1, 1],
    ['iso_sw', -1, 1]
  ] as const)('%s looks from its corner and from above', (preset, sx, sz) => {
    const p = presetPose(preset, bounds, 50, 1.6);
    expect(Math.sign(p.position[0] - p.target[0])).toBe(sx);
    expect(Math.sign(p.position[2] - p.target[2])).toBe(sz);
    expect(p.position[1]).toBeGreaterThan(p.target[1]);
    expect(p.up).toEqual([0, 1, 0]);
  });

  it.each(['top', 'iso_ne', 'iso_sw', 'north', 'east'] as ViewPreset[])('%s fits the whole bounds in view', (preset) => {
    const fov = 50;
    const aspect = 1.6;
    const p = presetPose(preset, bounds, fov, aspect);
    const { forward, right, up } = basis(p);
    const t = Math.tan(((fov / 2) * Math.PI) / 180);
    for (const x of [bounds.min.x, bounds.max.x + 1]) {
      for (const y of [bounds.min.y, bounds.max.y + 1]) {
        for (const z of [bounds.min.z, bounds.max.z + 1]) {
          const d = sub([x, y, z], p.position);
          const depth = dot(d, forward);
          expect(depth).toBeGreaterThan(0);
          expect(Math.abs(dot(d, up) / depth)).toBeLessThanOrEqual(t + 1e-9);
          expect(Math.abs(dot(d, right) / depth)).toBeLessThanOrEqual(t * aspect + 1e-9);
        }
      }
    }
  });
});
