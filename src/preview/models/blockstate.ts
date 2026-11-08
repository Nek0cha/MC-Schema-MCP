/** A model reference picked from a blockstate definition, with its variant rotation. */
export interface ModelRef {
  model: string;
  x: number;
  y: number;
  uvlock: boolean;
}

type Properties = Readonly<Record<string, string>>;

function toRef(raw: unknown): ModelRef | undefined {
  // Weighted variant lists: always take the first entry so a block looks the same every time.
  const entry = Array.isArray(raw) ? raw[0] : raw;
  if (!entry || typeof entry !== 'object' || typeof (entry as { model?: unknown }).model !== 'string') return undefined;
  const e = entry as { model: string; x?: number; y?: number; uvlock?: boolean };
  return { model: e.model, x: e.x ?? 0, y: e.y ?? 0, uvlock: e.uvlock === true };
}

/**
 * A variant key such as "facing=east,half=bottom" matches when every listed
 * property equals the block's value. Properties the block doesn't specify
 * match anything, so a bare id still resolves to the first fitting variant.
 */
function variantMatches(key: string, props: Properties): boolean {
  if (key === '' || key === 'normal') return true;
  return key.split(',').every((pair) => {
    const [name, value] = pair.split('=');
    const actual = props[name];
    return actual === undefined || actual === value;
  });
}

function conditionMatches(when: unknown, props: Properties): boolean {
  if (!when || typeof when !== 'object') return true;
  const w = when as Record<string, unknown>;
  if (Array.isArray(w.OR)) return w.OR.some((c) => conditionMatches(c, props));
  if (Array.isArray(w.AND)) return w.AND.every((c) => conditionMatches(c, props));
  return Object.entries(w).every(([name, expected]) => {
    const actual = props[name];
    if (actual === undefined) return false;
    return String(expected).split('|').includes(actual);
  });
}

/**
 * Picks the model references for a block state. Returns undefined when the
 * definition is missing or nothing matches.
 */
export function selectModels(definition: unknown, props: Properties): ModelRef[] | undefined {
  if (!definition || typeof definition !== 'object') return undefined;
  const def = definition as { variants?: Record<string, unknown>; multipart?: { when?: unknown; apply: unknown }[] };
  if (def.variants) {
    for (const [key, raw] of Object.entries(def.variants)) {
      if (variantMatches(key, props)) {
        const ref = toRef(raw);
        return ref ? [ref] : undefined;
      }
    }
    return undefined;
  }
  if (Array.isArray(def.multipart)) {
    const refs: ModelRef[] = [];
    for (const part of def.multipart) {
      if (!conditionMatches(part.when, props)) continue;
      const ref = toRef(part.apply);
      if (ref) refs.push(ref);
    }
    return refs;
  }
  return undefined;
}
