import type { BuildProject } from '../core/build-project.js';
import type { AssetStore } from '../preview/assets/asset-store.js';

export interface BlockCatalog {
  has(id: string): boolean;
  propertyNames(id: string): ReadonlySet<string>;
}

/**
 * Properties that exist on blocks but never change the model, so blockstate
 * files do not mention them. They are always treated as known.
 */
const MODEL_NEUTRAL_PROPERTIES = new Set([
  'waterlogged',
  'powered',
  'persistent',
  'distance',
  'occupied',
  'locked',
  'triggered',
  'enabled',
  'inverted',
  'conditional'
]);

/** Valid blocks that have no blockstate file (air and fluids), so the catalog cannot list them. */
const NO_BLOCKSTATE_IDS = new Set([
  'minecraft:air',
  'minecraft:cave_air',
  'minecraft:void_air',
  'minecraft:water',
  'minecraft:lava',
  'minecraft:bubble_column'
]);

const EMPTY: ReadonlySet<string> = new Set();

function bareId(id: string): string {
  return id.startsWith('minecraft:') ? id.slice('minecraft:'.length) : id;
}

function collectWhenKeys(when: unknown, into: Set<string>): void {
  if (Array.isArray(when)) {
    for (const part of when) collectWhenKeys(part, into);
    return;
  }
  if (typeof when !== 'object' || when === null) return;
  for (const [key, value] of Object.entries(when)) {
    if (key === 'OR' || key === 'AND') collectWhenKeys(value, into);
    else into.add(key);
  }
}

function propertyNamesOf(json: unknown): Set<string> {
  const names = new Set<string>();
  if (typeof json !== 'object' || json === null) return names;
  const { variants, multipart } = json as { variants?: unknown; multipart?: unknown };
  if (typeof variants === 'object' && variants !== null) {
    for (const key of Object.keys(variants)) {
      if (key === '' || key === 'normal') continue;
      for (const pair of key.split(',')) {
        const name = pair.split('=')[0];
        if (name) names.add(name);
      }
    }
  }
  if (Array.isArray(multipart)) {
    for (const part of multipart) collectWhenKeys((part as { when?: unknown }).when, names);
  }
  return names;
}

/** Block ids come from the cached `blockstates/*.json` file names; property names are read lazily per block. */
export function catalogFromAssets(assets: AssetStore): BlockCatalog {
  const ids = new Set(assets.listBlockstates());
  const cache = new Map<string, ReadonlySet<string>>();
  return {
    has: (id) => ids.has(bareId(id)),
    propertyNames: (id) => {
      const bare = bareId(id);
      let names = cache.get(bare);
      if (!names) {
        names = ids.has(bare) ? propertyNamesOf(assets.readJson(`blockstates/${bare}.json`)) : EMPTY;
        cache.set(bare, names);
      }
      return names;
    }
  };
}

/** One message per unknown block id, and one per (id, unknown property name), each with a block count. */
export function checkCompat(project: BuildProject, catalog: BlockCatalog | null): { message: string }[] {
  if (catalog === null) {
    return [
      {
        message:
          'Could not check compatibility with the target version: its Minecraft assets are not available. ' +
          'Block ids and property names were not verified.'
      }
    ];
  }
  const missing = new Map<string, number>();
  const unknownProps = new Map<string, number>();
  for (const { block, count } of project.getStateCounts()) {
    if (NO_BLOCKSTATE_IDS.has(block.id)) continue;
    if (!catalog.has(block.id)) {
      missing.set(block.id, (missing.get(block.id) ?? 0) + count);
      continue;
    }
    if (!block.properties) continue;
    const known = catalog.propertyNames(block.id);
    for (const name of Object.keys(block.properties)) {
      if (known.has(name) || MODEL_NEUTRAL_PROPERTIES.has(name)) continue;
      const key = `${block.id}\u0000${name}`;
      unknownProps.set(key, (unknownProps.get(key) ?? 0) + count);
    }
  }
  const issues: { message: string }[] = [];
  for (const [id, count] of missing) {
    issues.push({ message: `Block "${id}" does not exist in the target version (${count} block(s)).` });
  }
  for (const [key, count] of unknownProps) {
    const [id, name] = key.split('\u0000');
    issues.push({
      message: `Block "${id}" uses property "${name}", which the target version does not know (${count} block(s)).`
    });
  }
  return issues;
}
