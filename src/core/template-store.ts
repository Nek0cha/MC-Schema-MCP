import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { assertSafeName } from './names.js';
import { writeAtomic } from './project-store.js';
import type { TemplateMarker } from './marker-ops.js';
import type { BlockState } from './types.js';

export const TEMPLATE_FORMAT_VERSION = 1;
export const MAX_TEMPLATE_CELLS = 2_097_152;

export interface TemplateInfo {
  name: string;
  description?: string;
  size: [number, number, number];
  anchor: [number, number, number];
  createdAt: string;
}

export interface TemplateData extends TemplateInfo {
  /** Index 0 is always null (unset); block cells reference entries from 1. */
  palette: (BlockState | null)[];
  /** index = (y * sizeZ + z) * sizeX + x */
  blocks: Uint16Array;
  /** loot / enemy_spawn markers; `pos` is an offset from the anchor. Absent when there are none. */
  markers?: TemplateMarker[];
}

interface TemplateFile extends TemplateInfo {
  formatVersion: number;
  palette: (BlockState | null)[];
  /** base64 of gzip(Uint16 little-endian palette numbers) */
  blocks: string;
  markers?: TemplateMarker[];
}

const TRASH_DIR = '.trash';

function encodeBlocks(blocks: Uint16Array): string {
  const bytes = Buffer.alloc(blocks.length * 2);
  for (let i = 0; i < blocks.length; i++) bytes.writeUInt16LE(blocks[i], i * 2);
  return gzipSync(bytes).toString('base64');
}

function decodeBlocks(encoded: string, cells: number): Uint16Array {
  const bytes = gunzipSync(Buffer.from(encoded, 'base64'));
  if (bytes.length !== cells * 2) {
    throw new Error(`block data has ${bytes.length} bytes, expected ${cells * 2}`);
  }
  const blocks = new Uint16Array(cells);
  for (let i = 0; i < cells; i++) blocks[i] = bytes.readUInt16LE(i * 2);
  return blocks;
}

/** Finds the stored file for a name, ignoring case. Returns its canonical template name. */
function findStoredName(root: string, name: string): string | undefined {
  if (!existsSync(root)) return undefined;
  const wanted = `${name.toLowerCase()}.json`;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase() === wanted) return entry.name.slice(0, -'.json'.length);
  }
  return undefined;
}

export function saveTemplateFile(root: string, data: TemplateData, overwrite: boolean): void {
  assertSafeName(data.name, 'Template');
  mkdirSync(root, { recursive: true });
  const existing = findStoredName(root, data.name);
  if (existing !== undefined && !overwrite) {
    throw new Error(`Template "${existing}" already exists. Pass overwrite: true to replace it.`);
  }
  const file: TemplateFile = {
    formatVersion: TEMPLATE_FORMAT_VERSION,
    name: data.name,
    ...(data.description !== undefined ? { description: data.description } : {}),
    size: data.size,
    anchor: data.anchor,
    palette: data.palette,
    blocks: encodeBlocks(data.blocks),
    ...(data.markers && data.markers.length > 0 ? { markers: data.markers } : {}),
    createdAt: data.createdAt
  };
  if (existing !== undefined && existing !== data.name) {
    rmSync(join(root, `${existing}.json`), { force: true });
  }
  writeAtomic(join(root, `${data.name}.json`), JSON.stringify(file));
}

function parseTemplateFile(path: string, name: string): TemplateData {
  const fail = (reason: string, cause?: unknown): never => {
    throw new Error(`Cannot load template "${name}" from ${resolve(path)}: ${reason}`, { cause });
  };
  let file: TemplateFile;
  try {
    file = JSON.parse(readFileSync(path, 'utf8')) as TemplateFile;
  } catch (error) {
    return fail(`file is missing or corrupt (${error instanceof Error ? error.message : String(error)}).`, error);
  }
  if (file.formatVersion !== TEMPLATE_FORMAT_VERSION) {
    return fail(`unsupported formatVersion ${String(file.formatVersion)} (expected ${TEMPLATE_FORMAT_VERSION}).`);
  }
  const validTriple = (v: unknown): v is [number, number, number] =>
    Array.isArray(v) && v.length === 3 && v.every((n) => Number.isInteger(n));
  if (!validTriple(file.size) || file.size.some((n) => n < 1) || !validTriple(file.anchor)) {
    return fail('size or anchor is invalid.');
  }
  const cells = file.size[0] * file.size[1] * file.size[2];
  if (cells > MAX_TEMPLATE_CELLS) {
    return fail(`size ${file.size.join('x')} exceeds the ${MAX_TEMPLATE_CELLS.toLocaleString('en-US')} cell limit.`);
  }
  if (!Array.isArray(file.palette) || file.palette[0] !== null || typeof file.blocks !== 'string') {
    return fail('palette or block data is invalid.');
  }
  let blocks: Uint16Array;
  try {
    blocks = decodeBlocks(file.blocks, cells);
  } catch (error) {
    return fail(`block data is corrupt (${error instanceof Error ? error.message : String(error)}).`, error);
  }
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i] >= file.palette.length) return fail(`block data references unknown palette index ${blocks[i]}.`);
  }
  return {
    name: file.name,
    ...(file.description !== undefined ? { description: file.description } : {}),
    size: file.size,
    anchor: file.anchor,
    palette: file.palette,
    blocks,
    ...(Array.isArray(file.markers) && file.markers.length > 0 ? { markers: file.markers } : {}),
    createdAt: file.createdAt
  };
}

export function loadTemplateFile(root: string, name: string): TemplateData {
  assertSafeName(name, 'Template');
  const stored = findStoredName(root, name);
  if (stored === undefined) throw new Error(`Template "${name}" does not exist.`);
  return parseTemplateFile(join(root, `${stored}.json`), stored);
}

export function listTemplateFiles(root: string): TemplateInfo[] {
  if (!existsSync(root)) return [];
  const infos: TemplateInfo[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const { name, description, size, anchor, createdAt } = parseTemplateFile(
        join(root, entry.name),
        entry.name.slice(0, -'.json'.length)
      );
      infos.push({ name, ...(description !== undefined ? { description } : {}), size, anchor, createdAt });
    } catch {
      // Skip unreadable files so one bad template does not hide the others.
    }
  }
  return infos.sort((a, b) => a.name.localeCompare(b.name));
}

/** Moves the template file to <root>/.trash/<name>-<ms>[-<n>].json and returns the absolute destination. */
export function moveTemplateToTrash(root: string, name: string): string {
  assertSafeName(name, 'Template');
  const stored = findStoredName(root, name);
  if (stored === undefined) throw new Error(`Template "${name}" does not exist.`);
  const trashRoot = join(root, TRASH_DIR);
  mkdirSync(trashRoot, { recursive: true });
  const base = `${stored}-${Date.now()}`;
  let dest = join(trashRoot, `${base}.json`);
  for (let n = 1; existsSync(dest); n++) {
    dest = join(trashRoot, `${base}-${n}.json`);
  }
  renameSync(join(root, `${stored}.json`), dest);
  return resolve(dest);
}
