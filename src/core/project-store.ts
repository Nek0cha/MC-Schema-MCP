import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { endianness } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { BuildProject, parseChunkKey } from './build-project.js';
import type { BlockState } from './types.js';

export const FORMAT_VERSION = 1;

const CHUNK_BYTES = 4096 * 2;
const CHUNK_FILE_RE = /^(-?\d+)_(-?\d+)_(-?\d+)\.bin$/;
const BIG_ENDIAN = endianness() === 'BE';

interface ProjectFile {
  formatVersion: number;
  name: string;
  palette: (BlockState | null)[];
  createdAt: string;
  updatedAt: string;
}

export function projectDir(root: string, name: string): string {
  return join(root, name);
}

export function listStoredProjects(root: string): string[] {
  if (!existsSync(root)) return [];
  const names: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (existsSync(join(root, entry.name, 'project.json'))) names.push(entry.name);
  }
  return names;
}

export function writeAtomic(dest: string, data: string | Buffer): void {
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, dest);
}

function chunkFileName(key: string): string {
  const { cx, cy, cz } = parseChunkKey(key);
  return `${cx}_${cy}_${cz}.bin`;
}

function readExistingCreatedAt(file: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<ProjectFile>;
    return typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Writes project.json first, then the dirty chunks. Palette entries are
 * append-only, so a crash in between always leaves a readable project.
 * Chunks that were written (or deleted) successfully are marked clean even
 * if a later chunk fails; the error is rethrown afterwards.
 */
export function saveProject(root: string, project: BuildProject): void {
  const dir = projectDir(root, project.name);
  const chunksDir = join(dir, 'chunks');
  mkdirSync(chunksDir, { recursive: true });

  const jsonPath = join(dir, 'project.json');
  const now = new Date().toISOString();
  const file: ProjectFile = {
    formatVersion: FORMAT_VERSION,
    name: project.name,
    palette: [...project.getPalette()] as (BlockState | null)[],
    createdAt: readExistingCreatedAt(jsonPath) ?? now,
    updatedAt: now
  };
  writeAtomic(jsonPath, JSON.stringify(file));

  const done: string[] = [];
  try {
    for (const key of project.getDirtyChunkKeys()) {
      const path = join(chunksDir, chunkFileName(key));
      const chunk = project.getChunk(key);
      if (chunk) {
        let bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        if (BIG_ENDIAN) {
          bytes = Buffer.from(bytes);
          bytes.swap16();
        }
        writeAtomic(path, gzipSync(bytes));
      } else {
        rmSync(path, { force: true });
      }
      done.push(key);
    }
  } finally {
    project.clearDirty(done);
  }
}

export function loadProject(root: string, name: string): BuildProject {
  const dir = projectDir(root, name);
  const fail = (reason: string, cause?: unknown): never => {
    throw new Error(`Cannot load project "${name}" from ${resolve(dir)}: ${reason}`, { cause });
  };
  const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  let file: ProjectFile;
  try {
    file = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as ProjectFile;
  } catch (error) {
    return fail(`project.json is missing or corrupt (${describe(error)}).`, error);
  }
  if (file.formatVersion !== FORMAT_VERSION) {
    return fail(`unsupported formatVersion ${String(file.formatVersion)} (expected ${FORMAT_VERSION}).`);
  }
  if (!Array.isArray(file.palette) || file.palette[0] !== null) {
    return fail('project.json has an invalid palette.');
  }

  const chunks = new Map<string, Uint16Array>();
  const chunksDir = join(dir, 'chunks');
  if (existsSync(chunksDir) && statSync(chunksDir).isDirectory()) {
    for (const entry of readdirSync(chunksDir)) {
      const match = CHUNK_FILE_RE.exec(entry);
      if (!match) continue;
      let raw: Buffer;
      try {
        raw = gunzipSync(readFileSync(join(chunksDir, entry)));
      } catch (error) {
        return fail(`chunk file ${entry} is corrupt (${describe(error)}).`, error);
      }
      if (raw.length !== CHUNK_BYTES) {
        return fail(`chunk file ${entry} is corrupt (unexpected size ${raw.length}).`);
      }
      if (BIG_ENDIAN) raw.swap16();
      const chunk = new Uint16Array(4096);
      new Uint8Array(chunk.buffer).set(raw);
      chunks.set(`${match[1]},${match[2]},${match[3]}`, chunk);
    }
  }

  try {
    return BuildProject.fromStored(name, file.palette, chunks);
  } catch (error) {
    return fail(describe(error), error);
  }
}

/** Moves the project directory to <root>/.trash/<name>-<ms>[-<n>] and returns the absolute destination. */
export function moveProjectToTrash(root: string, name: string): string {
  const src = projectDir(root, name);
  const trashRoot = join(root, '.trash');
  mkdirSync(trashRoot, { recursive: true });
  const base = `${name}-${Date.now()}`;
  let dest = join(trashRoot, base);
  for (let n = 1; existsSync(dest); n++) {
    dest = join(trashRoot, `${base}-${n}`);
  }
  renameSync(src, dest);
  return resolve(dest);
}
