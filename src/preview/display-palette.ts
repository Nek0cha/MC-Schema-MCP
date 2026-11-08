import { blockStateKey, type BlockState } from '../core/types.js';
import { colorFor } from './block-colors.js';
import { bakeBlockState } from './models/bake.js';
import type { BakedModel, ModelSource } from './models/types.js';

export interface DisplayEntry {
  id: number;
  key: string;
  model: BakedModel | null;
  /** Fallback color as #rrggbb, from colorFor. */
  color: string;
  /** Touching cells of the same non-null group hide their shared faces (glass, water, ice, ...). */
  cullGroup: string | null;
}

/** colorFor returns "#rrggbb" or "hsl(h, s%, l%)"; the viewer wants plain hex. */
export function colorHex(blockId: string): string {
  const css = colorFor(blockId);
  const m = /^hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)$/.exec(css);
  if (!m) return css;
  const h = Number(m[1]);
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Append-only numbering of the (connection-resolved) block states a project
 * displays. Ids start at 1; 0 is "nothing to draw". When the model source
 * changes (assets became ready) every entry is re-baked in place, ids stay
 * the same and `version` is bumped so clients refetch the whole palette.
 */
export class DisplayPalette {
  private readonly entries: DisplayEntry[] = [];
  private readonly blocks: BlockState[] = [];
  private readonly index = new Map<string, number>();
  private source: ModelSource;
  private ready: boolean;
  private ver = 0;

  constructor(source: ModelSource, ready: boolean) {
    this.source = source;
    this.ready = ready;
  }

  /** Bumped by every rebake. */
  get version(): number {
    return this.ver;
  }

  /** Highest id handed out so far. */
  get size(): number {
    return this.entries.length;
  }

  get isReady(): boolean {
    return this.ready;
  }

  idFor(block: BlockState): number {
    const name = block.id.startsWith('minecraft:') ? block.id.slice(10) : block.id;
    if (name === 'air' || name === 'cave_air' || name === 'void_air') return 0;
    const key = blockStateKey(block);
    let id = this.index.get(key);
    if (id === undefined) {
      id = this.entries.length + 1;
      this.index.set(key, id);
      this.blocks.push({ id: block.id, ...(block.properties ? { properties: { ...block.properties } } : {}) });
      this.entries.push(this.makeEntry(id, key, this.blocks[id - 1]));
    }
    return id;
  }

  entriesSince(n: number): DisplayEntry[] {
    return this.entries.slice(Math.max(0, n));
  }

  rebake(source: ModelSource, ready: boolean): void {
    this.source = source;
    this.ready = ready;
    for (let i = 0; i < this.entries.length; i++) {
      this.entries[i] = this.makeEntry(i + 1, this.entries[i].key, this.blocks[i]);
    }
    this.ver++;
  }

  private makeEntry(id: number, key: string, block: BlockState): DisplayEntry {
    const model = bakeBlockState(block, this.source);
    const leaves = block.id.endsWith('_leaves');
    return {
      id,
      key,
      model,
      color: colorHex(block.id),
      cullGroup: model.renderType !== 'opaque' && !leaves ? block.id : null
    };
  }
}
