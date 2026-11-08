import type { BlockState } from './types.js';

export interface BlockMatcher {
  id: string;
  properties?: Record<string, string>;
}

export type KeepProperties = 'auto' | boolean;

const NAMESPACE = 'minecraft:';

export function normalizeId(id: string): string {
  return id.includes(':') ? id : `${NAMESPACE}${id}`;
}

function escapeRegex(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

const patternCache = new Map<string, RegExp>();

/** Compiles an id pattern where `*` matches any run of characters and everything else is literal. */
function idPattern(pattern: string): RegExp {
  let compiled = patternCache.get(pattern);
  if (!compiled) {
    compiled = new RegExp(`^${normalizeId(pattern).split('*').map(escapeRegex).join('.*')}$`);
    patternCache.set(pattern, compiled);
  }
  return compiled;
}

export function matchesAny(block: Readonly<BlockState>, matchers: BlockMatcher[]): boolean {
  for (const matcher of matchers) {
    if (!idPattern(matcher.id).test(block.id)) continue;
    if (matcher.properties) {
      const props = block.properties ?? {};
      if (!Object.entries(matcher.properties).every(([key, value]) => props[key] === value)) continue;
    }
    return true;
  }
  return false;
}

function bareId(id: string): string {
  return id.startsWith(NAMESPACE) ? id.slice(NAMESPACE.length) : id.slice(id.indexOf(':') + 1);
}

/** The part after the last underscore ("oak_stairs" -> "stairs"), or the whole id when there is none. */
function familyOf(id: string): string {
  const bare = bareId(id);
  return bare.slice(bare.lastIndexOf('_') + 1);
}

/**
 * Wall-mounted and standing variants (oak_wall_sign / oak_sign, wall_torch /
 * torch, ...) share a family suffix but not their property sets.
 */
function isWallMountedPair(a: string, b: string): boolean {
  return bareId(a).includes('wall_') !== bareId(b).includes('wall_');
}

function shouldKeep(source: string, replacement: string, keep: KeepProperties): boolean {
  if (keep !== 'auto') return keep;
  if (isWallMountedPair(source, replacement)) return false;
  return familyOf(source) === familyOf(replacement);
}

/** Builds the replacement block as a new object, optionally carrying over the source's properties. */
export function applyReplacement(
  source: Readonly<BlockState>,
  replacement: BlockState,
  keep: KeepProperties
): BlockState {
  const merged: Record<string, string> = shouldKeep(source.id, replacement.id, keep)
    ? { ...source.properties, ...replacement.properties }
    : { ...replacement.properties };
  return Object.keys(merged).length > 0 ? { id: replacement.id, properties: merged } : { id: replacement.id };
}
