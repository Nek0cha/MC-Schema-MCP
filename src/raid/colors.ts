import { readFileSync } from 'node:fs';
import type { BlockState } from '../core/types.js';
import { colorFor } from '../preview/block-colors.js';
import type { AssetStore } from '../preview/assets/asset-store.js';
import { decodePng } from './png.js';

export type Rgb = [number, number, number];

/** Converts the CSS colors of colorFor ("#rrggbb" or "hsl(h, s%, l%)") to RGB. */
export function parseCssColor(css: string): Rgb {
  if (css.startsWith('#')) {
    const n = parseInt(css.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = /hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/.exec(css);
  if (!m) return [128, 128, 128];
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = ((t % 1) + 1) % 1;
    const v = u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p;
    return Math.round(v * 255);
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

const SUFFIXES = ['_stairs', '_slab', '_wall', '_fence_gate', '_fence', '_button', '_pressure_plate'];
// Biome-tinted textures are gray in the jar, so the fallback color looks better.
const TINTED = /grass|leaves|vine|water|fern/;

function textureCandidates(id: string): string[] {
  const name = id.replace(/^minecraft:/, '');
  let base = name;
  for (const suffix of SUFFIXES) {
    if (base.endsWith(suffix)) {
      base = base.slice(0, -suffix.length);
      break;
    }
  }
  const out = [`block/${name}_top`, `block/${name}`];
  if (base !== name) out.push(`block/${base}`, `block/${base}_planks`, `block/${base}_block`, `block/${base}s`);
  return out;
}

/**
 * Block color for the preview image: the average of the block's texture when the
 * assets are available, otherwise the hash/manual color used by the 2D viewer.
 */
export function makeColorOf(assets: AssetStore | null): (block: BlockState) => Rgb {
  const cache = new Map<string, Rgb>();
  const lookup = (id: string): Rgb => {
    if (assets && assets.state === 'ready' && !TINTED.test(id)) {
      for (const candidate of textureCandidates(id)) {
        const file = assets.texturePath(candidate);
        if (!file) continue;
        try {
          const { width, rgba } = decodePng(readFileSync(file));
          // Animated textures are tall strips; the first square frame is enough.
          const pixels = Math.min(rgba.length / 4, width * width);
          let r = 0;
          let g = 0;
          let b = 0;
          let n = 0;
          for (let i = 0; i < pixels; i++) {
            if (rgba[i * 4 + 3] < 128) continue;
            r += rgba[i * 4];
            g += rgba[i * 4 + 1];
            b += rgba[i * 4 + 2];
            n++;
          }
          if (n > 0) return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
        } catch {
          // try the next candidate
        }
      }
    }
    return parseCssColor(colorFor(id));
  };
  return (block) => {
    let c = cache.get(block.id);
    if (!c) {
      c = lookup(block.id);
      cache.set(block.id, c);
    }
    return c;
  };
}
