import type { BlockState, Vec3 } from './types.js';

export type Rotation = 0 | 90 | 180 | 270;
export type Flip = 'x' | 'z';
export interface Transform {
  rotate?: Rotation;
  flip?: Flip;
}

/** Compass order, clockwise seen from above. */
const COMPASS = ['north', 'east', 'south', 'west'] as const;
type Compass = (typeof COMPASS)[number];

function isCompass(value: string): value is Compass {
  return (COMPASS as readonly string[]).includes(value);
}

function quarterTurns(t: Transform): number {
  return (((t.rotate ?? 0) / 90) % 4 + 4) % 4;
}

function flipDirection(dir: Compass, flip: Flip | undefined): Compass {
  if (flip === 'x') return dir === 'east' ? 'west' : dir === 'west' ? 'east' : dir;
  if (flip === 'z') return dir === 'north' ? 'south' : dir === 'south' ? 'north' : dir;
  return dir;
}

function rotateDirection(dir: Compass, turns: number): Compass {
  return COMPASS[(COMPASS.indexOf(dir) + turns) % 4];
}

/** Flip first, then rotate. */
function mapDirection(dir: Compass, t: Transform): Compass {
  return rotateDirection(flipDirection(dir, t.flip), quarterTurns(t));
}

function swapSides(value: string): string {
  if (value === 'left') return 'right';
  if (value === 'right') return 'left';
  return value;
}

function swapStairShapeSides(shape: string): string {
  if (shape.endsWith('_left')) return `${shape.slice(0, -5)}_right`;
  if (shape.endsWith('_right')) return `${shape.slice(0, -6)}_left`;
  return shape;
}

const RAIL_ORDER: Compass[] = ['north', 'south', 'east', 'west'];

/** Maps rail shapes such as north_east, ascending_south or east_west; returns undefined for non-rail values. */
function transformRailShape(shape: string, t: Transform): string | undefined {
  const parts = shape.split('_');
  if (parts[0] === 'ascending' && parts.length === 2 && isCompass(parts[1])) {
    return `ascending_${mapDirection(parts[1], t)}`;
  }
  if (parts.length === 2 && isCompass(parts[0]) && isCompass(parts[1])) {
    const mapped = parts.map((p) => mapDirection(p as Compass, t));
    mapped.sort((a, b) => RAIL_ORDER.indexOf(a) - RAIL_ORDER.indexOf(b));
    return mapped.join('_');
  }
  return undefined;
}

function transformRotationValue(value: number, t: Transform): number {
  let r = value;
  if (t.flip === 'z') r = (8 - r + 16) % 16;
  else if (t.flip === 'x') r = (16 - r) % 16;
  return (r + 4 * quarterTurns(t)) % 16;
}

/** Returns a new BlockState with direction-dependent properties rotated/flipped. Never mutates the input. */
export function transformBlockState(block: Readonly<BlockState>, t: Transform): BlockState {
  const source = block.properties;
  if (!source) return { id: block.id };
  const turns = quarterTurns(t);
  const out: Record<string, string> = { ...source };

  if (source.facing !== undefined && isCompass(source.facing)) {
    out.facing = mapDirection(source.facing, t);
  }

  if (source.axis === 'x' || source.axis === 'z') {
    if (turns % 2 === 1) out.axis = source.axis === 'x' ? 'z' : 'x';
  }

  if (source.rotation !== undefined && /^\d+$/.test(source.rotation)) {
    out.rotation = String(transformRotationValue(Number(source.rotation), t));
  }

  if (COMPASS.some((dir) => source[dir] !== undefined)) {
    for (const dir of COMPASS) delete out[dir];
    for (const dir of COMPASS) {
      if (source[dir] !== undefined) out[mapDirection(dir, t)] = source[dir];
    }
  }

  if (source.shape !== undefined) {
    const rail = transformRailShape(source.shape, t);
    if (rail !== undefined) out.shape = rail;
    else if (t.flip) out.shape = swapStairShapeSides(source.shape);
  }
  if (t.flip) {
    if (source.hinge !== undefined) out.hinge = swapSides(source.hinge);
    if (source.type === 'left' || source.type === 'right') out.type = swapSides(source.type);
    if (source.side_chain !== undefined) out.side_chain = swapSides(source.side_chain);
  }

  return { id: block.id, properties: out };
}

/** Transforms an offset around the origin: flip first, then rotate clockwise seen from above. */
export function transformOffset(offset: Vec3, t: Transform): Vec3 {
  let { x, z } = offset;
  if (t.flip === 'x') x = -x;
  else if (t.flip === 'z') z = -z;
  for (let i = 0; i < quarterTurns(t); i++) {
    [x, z] = [-z, x];
  }
  // `+ 0` turns -0 into 0 so results compare equal under Object.is.
  return { x: x + 0, y: offset.y, z: z + 0 };
}
