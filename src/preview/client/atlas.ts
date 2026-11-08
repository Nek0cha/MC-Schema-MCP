/**
 * Texture atlas for the block textures: a fixed 1024x1024 canvas of 16x16
 * tiles. Slots are handed out in order of first use and never move, so
 * rectangles stay valid when more textures are added later.
 */
import type { Rect } from './mesher.js';

export const ATLAS_SIZE = 1024;
const TILE = 16;
const COLUMNS = ATLAS_SIZE / TILE;
/** Keeps sampling inside a tile (in texels). */
const INSET = 0.02;

export const MISSING_TEXTURE = '#missing';

export class Atlas {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly slots = new Map<string, Rect>();
  private readonly failed = new Set<string>();
  private next = 0;
  readonly white: Rect;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_SIZE;
    this.canvas.height = ATLAS_SIZE;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available.');
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.white = this.allocate((x, y) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, TILE, TILE);
    });
  }

  /** Rectangles of every texture added so far (the white tile is separate). */
  rects(includeMissing: boolean): Record<string, Rect> {
    const out: Record<string, Rect> = {};
    for (const [name, rect] of this.slots) {
      if (name === MISSING_TEXTURE && !includeMissing) continue;
      out[name] = rect;
    }
    return out;
  }

  /** Adds the magenta/black checker used for block ids that did not resolve. */
  addMissing(): void {
    if (this.slots.has(MISSING_TEXTURE)) return;
    const ctx = this.ctx;
    this.slots.set(
      MISSING_TEXTURE,
      this.allocate((x, y) => {
        for (let row = 0; row < 2; row++) {
          for (let col = 0; col < 2; col++) {
            ctx.fillStyle = (row + col) % 2 === 0 ? '#F800F8' : '#000000';
            ctx.fillRect(x + col * 8, y + row * 8, 8, 8);
          }
        }
      })
    );
  }

  /**
   * Loads textures by name (e.g. "block/stone") from `urlFor(name)`. Names that
   * fail to load are remembered and stay out of the atlas (they render in the
   * fallback color). Returns true when the atlas canvas changed.
   */
  async add(names: Iterable<string>, urlFor: (name: string) => string): Promise<boolean> {
    const todo = [...new Set(names)].filter((n) => n !== MISSING_TEXTURE && !this.slots.has(n) && !this.failed.has(n));
    for (let i = 0; i < todo.length; i += 24) {
      await Promise.all(
        todo.slice(i, i + 24).map(async (name) => {
          try {
            const res = await fetch(urlFor(name));
            if (!res.ok) throw new Error(String(res.status));
            const bitmap = await createImageBitmap(await res.blob());
            if (this.next >= COLUMNS * COLUMNS) throw new Error('atlas full');
            this.slots.set(
              name,
              this.allocate((x, y) => {
                // Animated textures are tall strips; use the first square frame.
                const side = Math.min(bitmap.width, bitmap.height);
                this.ctx.drawImage(bitmap, 0, 0, side, side, x, y, TILE, TILE);
              })
            );
            bitmap.close();
          } catch {
            this.failed.add(name);
          }
        })
      );
    }
    return todo.length > 0;
  }

  private allocate(draw: (x: number, y: number) => void): Rect {
    const slot = this.next++;
    const x = (slot % COLUMNS) * TILE;
    const y = Math.floor(slot / COLUMNS) * TILE;
    draw(x, y);
    return [(x + INSET) / ATLAS_SIZE, (y + INSET) / ATLAS_SIZE, (x + TILE - INSET) / ATLAS_SIZE, (y + TILE - INSET) / ATLAS_SIZE];
  }
}
