# MC-Schema-MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript MCP server that lets Claude Code design Minecraft builds tool-call by tool-call and export them as Sponge Schematic v3 (`.schem`) files for a user to manually load via FAWE on Paper 1.21.11.

**Architecture:** A stdio MCP server (`@modelcontextprotocol/sdk`) wraps an in-memory `ProjectManager` holding named `BuildProject`s (sparse voxel maps). MCP tools mutate the active project via low-level (`setBlock`/`setBlocks`) and mid-level (`fillBox`, `sphere`, etc.) primitives. `exportSchematic` serializes the active project through a hand-written Sponge Schematic v3 NBT writer (since `@enginehub/schematicjs` only supports reading) and writes a gzip-compressed `.schem` file to a fixed `./output` directory.

**Tech Stack:** TypeScript (ESM, NodeNext), `pnpm`, `@modelcontextprotocol/sdk` ^1.30.0, `@enginehub/nbt-ts` ^1.4.1, `@enginehub/schematicjs` ^0.10.0 (test-only, read-side validation), `zod` ^3.25.0, `vitest` ^3.0.0.

**Spec:** `docs/superpowers/specs/2026-08-31-mc-schema-mcp-design.md`

## Global Constraints

- Target Minecraft version: Paper 1.21.11 → `DataVersion = 4671` in every exported schematic.
- Output format: Sponge Schematic v3 (gzip-compressed NBT), written to a fixed `./output/<projectName>.schem` path — never a per-call path argument.
- Blocks are specified as `{ id: string; properties?: Record<string, string> }`, never as raw blockstate strings from tool callers.
- `@enginehub/schematicjs` is a **read-only** library (verified against its source) — it must never be used to write `.schem` files, only to validate our own writer's output in tests.
- BlockEntities, Entities, and Biomes are out of scope for this plan (write an empty `BlockEntities` list; omit `Biomes`/`Entities` entirely).
- No undo/redo, no blockstate registry validation, no ASCII preview — YAGNI per spec section 9.
- Package manager is `pnpm` throughout (never `npm`/`yarn`).

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`

**Interfaces:**
- Produces: a buildable, testable empty TypeScript project (`pnpm build`, `pnpm test` both runnable) that every later task adds to.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "mc-schema-mcp",
  "version": "0.1.0",
  "description": "MCP server for designing Minecraft builds and exporting them as Sponge Schematic (.schem) files.",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.30.0",
    "@enginehub/nbt-ts": "^1.4.1",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@enginehub/schematicjs": "^0.10.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "@types/node": "^22.10.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create a placeholder entrypoint**

```typescript
// src/index.ts
export {};
```

- [ ] **Step 4: Install dependencies**

Run: `pnpm install`
Expected: lockfile created, `node_modules` populated, no errors.

- [ ] **Step 5: Verify the project builds and the test runner works**

Run: `pnpm build`
Expected: `dist/index.js` is created, no TypeScript errors.

Run: `pnpm test`
Expected: vitest runs and reports "no test files found" (or passes with 0 tests) — not an error.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json src/index.ts
git commit -m "chore: scaffold TypeScript project"
```

---

## Task 2: Core Types & BuildProject

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/build-project.ts`
- Test: `test/core/build-project.test.ts`

**Interfaces:**
- Consumes: nothing (foundational).
- Produces:
  - `Vec3 = { x: number; y: number; z: number }`
  - `BlockState = { id: string; properties?: Record<string, string> }`
  - `PaletteEntry = { block: BlockState; weight: number }`, `Palette = PaletteEntry[]`
  - `blockStateKey(block: BlockState): string`
  - `class BuildProject { name: string; voxels: Map<string, BlockState>; setBlock(pos, block): void; getBlock(pos): BlockState | undefined; getBoundingBox(): { min: Vec3; max: Vec3 } | null; getBlockCounts(): Record<string, number>; }`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/core/build-project.test.ts
import { describe, expect, it } from 'vitest';
import { BuildProject } from '../../src/core/build-project.js';

describe('BuildProject', () => {
  it('starts empty with no bounding box', () => {
    const project = new BuildProject('demo');
    expect(project.getBoundingBox()).toBeNull();
  });

  it('stores and retrieves a block by position', () => {
    const project = new BuildProject('demo');
    project.setBlock({ x: 1, y: 2, z: 3 }, { id: 'minecraft:stone' });
    expect(project.getBlock({ x: 1, y: 2, z: 3 })).toEqual({ id: 'minecraft:stone' });
    expect(project.getBlock({ x: 0, y: 0, z: 0 })).toBeUndefined();
  });

  it('computes the bounding box across all set blocks', () => {
    const project = new BuildProject('demo');
    project.setBlock({ x: -1, y: 0, z: 5 }, { id: 'minecraft:stone' });
    project.setBlock({ x: 3, y: 2, z: -2 }, { id: 'minecraft:dirt' });
    expect(project.getBoundingBox()).toEqual({
      min: { x: -1, y: 0, z: -2 },
      max: { x: 3, y: 2, z: 5 }
    });
  });

  it('counts blocks by id', () => {
    const project = new BuildProject('demo');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    project.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:stone' });
    project.setBlock({ x: 2, y: 0, z: 0 }, { id: 'minecraft:dirt' });
    expect(project.getBlockCounts()).toEqual({ 'minecraft:stone': 2, 'minecraft:dirt': 1 });
  });

  it('overwrites a block already set at the same position', () => {
    const project = new BuildProject('demo');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:dirt' });
    expect(project.getBlock({ x: 0, y: 0, z: 0 })).toEqual({ id: 'minecraft:dirt' });
    expect(project.voxels.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run test/core/build-project.test.ts`
Expected: FAIL — `src/core/build-project.ts` does not exist yet.

- [ ] **Step 3: Implement the types**

```typescript
// src/core/types.ts
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface BlockState {
  id: string;
  properties?: Record<string, string>;
}

export interface PaletteEntry {
  block: BlockState;
  weight: number;
}

export type Palette = PaletteEntry[];

/**
 * Renders a BlockState as a Minecraft blockstate string, e.g.
 * "minecraft:oak_stairs[facing=north,half=bottom]".
 */
export function blockStateKey(block: BlockState): string {
  if (!block.properties || Object.keys(block.properties).length === 0) {
    return block.id;
  }
  const props = Object.entries(block.properties)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
  return `${block.id}[${props}]`;
}
```

- [ ] **Step 4: Implement BuildProject**

```typescript
// src/core/build-project.ts
import type { BlockState, Vec3 } from './types.js';

export interface BoundingBox {
  min: Vec3;
  max: Vec3;
}

function voxelKey(pos: Vec3): string {
  return `${pos.x},${pos.y},${pos.z}`;
}

export class BuildProject {
  readonly name: string;
  readonly voxels = new Map<string, BlockState>();

  constructor(name: string) {
    this.name = name;
  }

  setBlock(pos: Vec3, block: BlockState): void {
    this.voxels.set(voxelKey(pos), block);
  }

  getBlock(pos: Vec3): BlockState | undefined {
    return this.voxels.get(voxelKey(pos));
  }

  getBoundingBox(): BoundingBox | null {
    if (this.voxels.size === 0) {
      return null;
    }
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const key of this.voxels.keys()) {
      const [x, y, z] = key.split(',').map(Number);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
  }

  getBlockCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const block of this.voxels.values()) {
      counts[block.id] = (counts[block.id] ?? 0) + 1;
    }
    return counts;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run test/core/build-project.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/build-project.ts test/core/build-project.test.ts
git commit -m "feat: add BuildProject voxel store"
```

---

## Task 3: ProjectManager

**Files:**
- Create: `src/core/project-manager.ts`
- Test: `test/core/project-manager.test.ts`

**Interfaces:**
- Consumes: `BuildProject` from Task 2 (`src/core/build-project.js`).
- Produces: `class ProjectManager { createProject(name): BuildProject; switchProject(name): BuildProject; deleteProject(name): void; listProjects(): string[]; getActive(): BuildProject; }` — throws `Error` on invalid name / no active project.

- [ ] **Step 1: Write the failing tests**

```typescript
// test/core/project-manager.test.ts
import { describe, expect, it } from 'vitest';
import { ProjectManager } from '../../src/core/project-manager.js';

describe('ProjectManager', () => {
  it('throws when there is no active project', () => {
    const manager = new ProjectManager();
    expect(() => manager.getActive()).toThrow();
  });

  it('creates a project and makes it active', () => {
    const manager = new ProjectManager();
    manager.createProject('house');
    expect(manager.getActive().name).toBe('house');
    expect(manager.listProjects()).toEqual(['house']);
  });

  it('refuses to create a project with a duplicate name', () => {
    const manager = new ProjectManager();
    manager.createProject('house');
    expect(() => manager.createProject('house')).toThrow();
  });

  it('switches the active project', () => {
    const manager = new ProjectManager();
    manager.createProject('house');
    manager.createProject('tower');
    expect(manager.getActive().name).toBe('tower');
    manager.switchProject('house');
    expect(manager.getActive().name).toBe('house');
  });

  it('throws when switching to a project that does not exist', () => {
    const manager = new ProjectManager();
    expect(() => manager.switchProject('missing')).toThrow();
  });

  it('deletes a project and clears active status if it was active', () => {
    const manager = new ProjectManager();
    manager.createProject('house');
    manager.deleteProject('house');
    expect(manager.listProjects()).toEqual([]);
    expect(() => manager.getActive()).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run test/core/project-manager.test.ts`
Expected: FAIL — `src/core/project-manager.ts` does not exist yet.

- [ ] **Step 3: Implement ProjectManager**

```typescript
// src/core/project-manager.ts
import { BuildProject } from './build-project.js';

export class ProjectManager {
  private readonly projects = new Map<string, BuildProject>();
  private activeProjectName: string | null = null;

  createProject(name: string): BuildProject {
    if (this.projects.has(name)) {
      throw new Error(`Project "${name}" already exists.`);
    }
    const project = new BuildProject(name);
    this.projects.set(name, project);
    this.activeProjectName = name;
    return project;
  }

  switchProject(name: string): BuildProject {
    const project = this.projects.get(name);
    if (!project) {
      throw new Error(`Project "${name}" does not exist.`);
    }
    this.activeProjectName = name;
    return project;
  }

  deleteProject(name: string): void {
    if (!this.projects.has(name)) {
      throw new Error(`Project "${name}" does not exist.`);
    }
    this.projects.delete(name);
    if (this.activeProjectName === name) {
      this.activeProjectName = null;
    }
  }

  listProjects(): string[] {
    return [...this.projects.keys()];
  }

  getActive(): BuildProject {
    if (!this.activeProjectName) {
      throw new Error('No active project. Call createProject or switchProject first.');
    }
    const project = this.projects.get(this.activeProjectName);
    if (!project) {
      throw new Error('Active project reference is invalid.');
    }
    return project;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run test/core/project-manager.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/project-manager.ts test/core/project-manager.test.ts
git commit -m "feat: add ProjectManager for named build projects"
```

---

## Task 4: VarInt Encoding Utility

**Files:**
- Create: `src/schematic/varint.ts`
- Test: `test/schematic/varint.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `encodeVarInt(value: number): number[]` — LEB128-style VarInt encoding (same scheme Minecraft's protocol and Sponge Schematic `BlockData`/`Data` arrays use), each returned entry a byte (0-255). Throws on negative input.

- [ ] **Step 1: Write the failing tests**

```typescript
// test/schematic/varint.test.ts
import { describe, expect, it } from 'vitest';
import { encodeVarInt } from '../../src/schematic/varint.js';

describe('encodeVarInt', () => {
  it('encodes single-byte values unchanged', () => {
    expect(encodeVarInt(0)).toEqual([0]);
    expect(encodeVarInt(1)).toEqual([1]);
    expect(encodeVarInt(127)).toEqual([127]);
  });

  it('encodes multi-byte values with continuation bits', () => {
    expect(encodeVarInt(128)).toEqual([0x80, 0x01]);
    expect(encodeVarInt(300)).toEqual([0xac, 0x02]);
    expect(encodeVarInt(16384)).toEqual([0x80, 0x80, 0x01]);
  });

  it('rejects negative values', () => {
    expect(() => encodeVarInt(-1)).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run test/schematic/varint.test.ts`
Expected: FAIL — `src/schematic/varint.ts` does not exist yet.

- [ ] **Step 3: Implement encodeVarInt**

```typescript
// src/schematic/varint.ts
/**
 * Encodes a non-negative integer as a VarInt: the same 7-bits-per-byte,
 * MSB-continuation-bit scheme used by Minecraft's protocol and by the
 * Sponge Schematic format's block/biome Data arrays.
 */
export function encodeVarInt(value: number): number[] {
  if (value < 0) {
    throw new Error(`encodeVarInt does not support negative values: ${value}`);
  }
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (remaining !== 0);
  return bytes;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run test/schematic/varint.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/schematic/varint.ts test/schematic/varint.test.ts
git commit -m "feat: add VarInt encoder for schematic block data"
```

---

## Task 5: Sponge Schematic v3 Writer

**Files:**
- Create: `src/schematic/data-version.ts`
- Create: `src/schematic/writer.ts`
- Test: `test/schematic/writer.test.ts`

**Interfaces:**
- Consumes: `BuildProject` (Task 2), `blockStateKey` (Task 2), `encodeVarInt` (Task 4).
- Produces: `writeSchematic(project: BuildProject): Buffer` — a gzip-compressed Sponge Schematic v3 NBT buffer. Throws if the project has no blocks.

**Background (from technical verification during brainstorming):**
- `@enginehub/nbt-ts`'s `encode(name, tag)` returns an **uncompressed** NBT buffer — gzip it yourself with `node:zlib`'s `gzipSync`.
- Plain JS `number` values encode as NBT `Double`. You must wrap every `Int`/`Short` field explicitly (`new Int(3)`, `new Short(width)`), or the field will be written with the wrong NBT tag type and readers (including FAWE) will reject or misread the file.
- An empty array (`[]`) is a valid, correctly-encoded empty NBT `List` — safe to use for `BlockEntities`.
- The real Sponge v3 root NBT tag is a Compound (root tag name `''`, i.e. an empty but present name field) whose single child key is `"Schematic"`, itself a Compound holding `Version`, `DataVersion`, `Width`, `Height`, `Length`, `Offset`, and `Blocks` (verified against `@enginehub/schematicjs`'s own reader source, which unwraps exactly this shape).
- `@enginehub/schematicjs`'s `readBlockPalette` (used only by our test, to validate the writer) strips everything up to and including the **first colon** in each palette key before parsing brackets — so `"minecraft:oak_stairs[facing=north]"` comes back out of its reader as `type: "oak_stairs[...]"` parsed to `{ type: "oak_stairs", properties: { facing: "north" } }`, i.e. **without the `minecraft:` namespace**. This is a quirk of that reader, not of the file format — our writer must still emit full `"minecraft:..."` keys (that's what FAWE expects), and the round-trip test below accounts for the stripped namespace when asserting.
- Block/biome `Data` arrays are ordered with `x` fastest, then `z`, then `y` (index `(y * length + z) * width + x`) — confirmed by reading `common.ts`'s `readBlockVarintToSchematic`.

- [ ] **Step 1: Write the failing tests**

```typescript
// test/schematic/writer.test.ts
import { describe, expect, it } from 'vitest';
import { decode, type TagMap } from '@enginehub/nbt-ts';
import { loadSchematic } from '@enginehub/schematicjs';
import { gunzipSync } from 'node:zlib';
import { BuildProject } from '../../src/core/build-project.js';
import { writeSchematic } from '../../src/schematic/writer.js';

/**
 * The schematicjs reader strips the "minecraft:" namespace when parsing
 * palette keys (see writer.ts comments). Mirror that here so round-trip
 * assertions compare like with like.
 */
function stripNamespace(id: string): string {
  const colonIndex = id.indexOf(':');
  return colonIndex === -1 ? id : id.slice(colonIndex + 1);
}

describe('writeSchematic', () => {
  it('round-trips a small build through the schematicjs reader', () => {
    const project = new BuildProject('roundtrip-test');
    project.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    project.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:oak_planks' });
    project.setBlock({ x: 0, y: 1, z: 0 }, {
      id: 'minecraft:oak_stairs',
      properties: { facing: 'north', half: 'bottom' }
    });

    const compressed = writeSchematic(project);
    const raw = gunzipSync(compressed);
    const { value } = decode(raw, { useMaps: true });
    const schematic = loadSchematic(value as TagMap);

    // Bounding box is x:[0,1], y:[0,1], z:[0,0] -> 2x2x1.
    expect(schematic.width).toBe(2);
    expect(schematic.height).toBe(2);
    expect(schematic.length).toBe(1);

    expect(schematic.getBlock({ x: 0, y: 0, z: 0 })?.type).toBe(stripNamespace('minecraft:stone'));
    expect(schematic.getBlock({ x: 1, y: 0, z: 0 })?.type).toBe(stripNamespace('minecraft:oak_planks'));

    const stairs = schematic.getBlock({ x: 0, y: 1, z: 0 });
    expect(stairs?.type).toBe(stripNamespace('minecraft:oak_stairs'));
    expect(stairs?.properties).toEqual({ facing: 'north', half: 'bottom' });

    // (1,1,0) was never set, so it must round-trip as air.
    expect(schematic.getBlock({ x: 1, y: 1, z: 0 })?.type).toBe(stripNamespace('minecraft:air'));
  });

  it('throws when the project has no blocks', () => {
    const project = new BuildProject('empty');
    expect(() => writeSchematic(project)).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run test/schematic/writer.test.ts`
Expected: FAIL — `src/schematic/writer.ts` does not exist yet.

- [ ] **Step 3: Implement the DataVersion constant**

```typescript
// src/schematic/data-version.ts
/**
 * NBT DataVersion for Minecraft Java Edition 1.21.11.
 * Source: https://minecraft.wiki/w/Java_Edition_1.21.11 (Data version: 4671).
 * Update this constant when targeting a different game version.
 */
export const DATA_VERSION = 4671;
```

- [ ] **Step 4: Implement the writer**

```typescript
// src/schematic/writer.ts
import { encode, Int, Short } from '@enginehub/nbt-ts';
import { gzipSync } from 'node:zlib';
import type { BuildProject } from '../core/build-project.js';
import { blockStateKey, type BlockState } from '../core/types.js';
import { encodeVarInt } from './varint.js';
import { DATA_VERSION } from './data-version.js';

const AIR: BlockState = { id: 'minecraft:air' };

/**
 * Serializes a BuildProject into a gzip-compressed Sponge Schematic v3
 * (.schem) buffer, ready to write to disk. Throws if the project has no
 * blocks (there is no meaningful bounding box to export).
 */
export function writeSchematic(project: BuildProject): Buffer {
  const bbox = project.getBoundingBox();
  if (!bbox) {
    throw new Error(`Project "${project.name}" has no blocks to export.`);
  }

  const width = bbox.max.x - bbox.min.x + 1;
  const height = bbox.max.y - bbox.min.y + 1;
  const length = bbox.max.z - bbox.min.z + 1;

  const palette = new Map<string, number>();
  function paletteIdFor(block: BlockState): number {
    const key = blockStateKey(block);
    let id = palette.get(key);
    if (id === undefined) {
      id = palette.size;
      palette.set(key, id);
    }
    return id;
  }
  // Reserve id 0 for air so the common "empty space" case is cheap.
  paletteIdFor(AIR);

  const dataBytes: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let z = 0; z < length; z++) {
      for (let x = 0; x < width; x++) {
        const worldPos = { x: x + bbox.min.x, y: y + bbox.min.y, z: z + bbox.min.z };
        const block = project.getBlock(worldPos) ?? AIR;
        dataBytes.push(...encodeVarInt(paletteIdFor(block)));
      }
    }
  }

  const paletteCompound: Record<string, Int> = {};
  for (const [key, id] of palette) {
    paletteCompound[key] = new Int(id);
  }

  const schematicCompound = {
    Version: new Int(3),
    DataVersion: new Int(DATA_VERSION),
    Width: new Short(width),
    Height: new Short(height),
    Length: new Short(length),
    Offset: new Int32Array([0, 0, 0]),
    Blocks: {
      Palette: paletteCompound,
      Data: Buffer.from(dataBytes),
      BlockEntities: [] as never[]
    }
  };

  const uncompressed = encode('', { Schematic: schematicCompound });
  return gzipSync(uncompressed);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run test/schematic/writer.test.ts`
Expected: PASS (2 tests). If the round-trip assertions fail, inspect the decoded `TagMap` (`console.log([...value.entries()])`) to see which field has the wrong NBT tag type — the most common mistake is a missing `Int`/`Short` wrapper.

- [ ] **Step 6: Commit**

```bash
git add src/schematic/data-version.ts src/schematic/writer.ts test/schematic/writer.test.ts
git commit -m "feat: write Sponge Schematic v3 files with a hand-rolled NBT writer"
```

---

## Task 6: Box & Line Shape Primitives

**Files:**
- Create: `src/core/shapes.ts`
- Test: `test/core/shapes.test.ts`

**Interfaces:**
- Consumes: `BuildProject`, `BlockState`, `Palette`, `Vec3` (Task 2).
- Produces:
  - `type BlockOrPalette = BlockState | Palette`
  - `fillBox(project, from: Vec3, to: Vec3, block: BlockOrPalette): void`
  - `outlineBox(project, from: Vec3, to: Vec3, block: BlockOrPalette): void`
  - `line(project, from: Vec3, to: Vec3, block: BlockOrPalette): void`
  - `wall(project, from: Vec3, to: Vec3, height: number, block: BlockOrPalette): void` — throws if `height < 1`.
  - (internal, not exported) `resolveBlock`, `pointsAlongLine` helpers reused by Task 7.

- [ ] **Step 1: Write the failing tests**

```typescript
// test/core/shapes.test.ts
import { describe, expect, it } from 'vitest';
import { BuildProject } from '../../src/core/build-project.js';
import { fillBox, outlineBox, line, wall } from '../../src/core/shapes.js';

const STONE = { id: 'minecraft:stone' };

describe('fillBox', () => {
  it('fills every position in the box, inclusive of both corners', () => {
    const project = new BuildProject('demo');
    fillBox(project, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }, STONE);
    expect(project.getBlockCounts()).toEqual({ 'minecraft:stone': 4 });
  });

  it('works regardless of corner order', () => {
    const project = new BuildProject('demo');
    fillBox(project, { x: 1, y: 1, z: 1 }, { x: 0, y: 0, z: 0 }, STONE);
    expect(project.getBoundingBox()).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } });
  });
});

describe('outlineBox', () => {
  it('only sets blocks on the shell of a 3x3x3 box', () => {
    const project = new BuildProject('demo');
    outlineBox(project, { x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }, STONE);
    // 3x3x3 = 27 total, minus the single interior cell (1,1,1) = 26 on the shell.
    expect(project.getBlockCounts()).toEqual({ 'minecraft:stone': 26 });
    expect(project.getBlock({ x: 1, y: 1, z: 1 })).toBeUndefined();
    expect(project.getBlock({ x: 0, y: 0, z: 0 })).toEqual(STONE);
  });
});

describe('line', () => {
  it('draws a straight axis-aligned line inclusive of both ends', () => {
    const project = new BuildProject('demo');
    line(project, { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, STONE);
    expect(project.getBlockCounts()).toEqual({ 'minecraft:stone': 5 });
    for (let x = 0; x <= 4; x++) {
      expect(project.getBlock({ x, y: 0, z: 0 })).toEqual(STONE);
    }
  });

  it('draws a diagonal line', () => {
    const project = new BuildProject('demo');
    line(project, { x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }, STONE);
    expect(project.getBlock({ x: 0, y: 0, z: 0 })).toEqual(STONE);
    expect(project.getBlock({ x: 1, y: 1, z: 0 })).toEqual(STONE);
    expect(project.getBlock({ x: 2, y: 2, z: 0 })).toEqual(STONE);
  });
});

describe('wall', () => {
  it('builds a vertical wall along the path with the given height', () => {
    const project = new BuildProject('demo');
    wall(project, { x: 0, y: 10, z: 0 }, { x: 2, y: 10, z: 0 }, 3, STONE);
    // 3 ground positions x 3 blocks tall = 9.
    expect(project.getBlockCounts()).toEqual({ 'minecraft:stone': 9 });
    expect(project.getBlock({ x: 1, y: 12, z: 0 })).toEqual(STONE);
    expect(project.getBlock({ x: 1, y: 13, z: 0 })).toBeUndefined();
  });

  it('rejects a non-positive height', () => {
    const project = new BuildProject('demo');
    expect(() => wall(project, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0, STONE)).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run test/core/shapes.test.ts`
Expected: FAIL — `src/core/shapes.ts` does not exist yet.

- [ ] **Step 3: Implement the shapes**

```typescript
// src/core/shapes.ts
import type { BuildProject } from './build-project.js';
import type { BlockState, Palette, Vec3 } from './types.js';

export type BlockOrPalette = BlockState | Palette;

function isPalette(value: BlockOrPalette): value is Palette {
  return Array.isArray(value);
}

function resolveBlock(value: BlockOrPalette): BlockState {
  if (!isPalette(value)) {
    return value;
  }
  if (value.length === 0) {
    throw new Error('Palette must contain at least one entry.');
  }
  const totalWeight = value.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const entry of value) {
    roll -= entry.weight;
    if (roll <= 0) {
      return entry.block;
    }
  }
  return value[value.length - 1].block;
}

function sortMinMax(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function pointsAlongLine(from: Vec3, to: Vec3): Vec3[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz), 1);
  const points: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: Math.round(from.x + dx * t),
      y: Math.round(from.y + dy * t),
      z: Math.round(from.z + dz * t)
    });
  }
  return points;
}

export function fillBox(project: BuildProject, from: Vec3, to: Vec3, block: BlockOrPalette): void {
  const [minX, maxX] = sortMinMax(from.x, to.x);
  const [minY, maxY] = sortMinMax(from.y, to.y);
  const [minZ, maxZ] = sortMinMax(from.z, to.z);
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        project.setBlock({ x, y, z }, resolveBlock(block));
      }
    }
  }
}

export function outlineBox(project: BuildProject, from: Vec3, to: Vec3, block: BlockOrPalette): void {
  const [minX, maxX] = sortMinMax(from.x, to.x);
  const [minY, maxY] = sortMinMax(from.y, to.y);
  const [minZ, maxZ] = sortMinMax(from.z, to.z);
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        const onShell =
          x === minX || x === maxX || y === minY || y === maxY || z === minZ || z === maxZ;
        if (onShell) {
          project.setBlock({ x, y, z }, resolveBlock(block));
        }
      }
    }
  }
}

export function line(project: BuildProject, from: Vec3, to: Vec3, block: BlockOrPalette): void {
  for (const pos of pointsAlongLine(from, to)) {
    project.setBlock(pos, resolveBlock(block));
  }
}

export function wall(
  project: BuildProject,
  from: Vec3,
  to: Vec3,
  height: number,
  block: BlockOrPalette
): void {
  if (height < 1) {
    throw new Error(`wall height must be at least 1, got ${height}.`);
  }
  for (const basePos of pointsAlongLine(from, to)) {
    for (let dy = 0; dy < height; dy++) {
      project.setBlock({ x: basePos.x, y: basePos.y + dy, z: basePos.z }, resolveBlock(block));
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run test/core/shapes.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/shapes.ts test/core/shapes.test.ts
git commit -m "feat: add fillBox, outlineBox, line, and wall shape primitives"
```

---

## Task 7: Curved Shape Primitives (Sphere & Cylinder)

**Files:**
- Modify: `src/core/shapes.ts` (append `sphere`, `cylinder`)
- Modify: `test/core/shapes.test.ts` (append test suites)

**Interfaces:**
- Consumes: `resolveBlock` (private helper already in `shapes.ts` from Task 6), `BuildProject`, `Vec3`, `BlockOrPalette`.
- Produces:
  - `sphere(project, center: Vec3, radius: number, block: BlockOrPalette, hollow?: boolean): void` — throws if `radius < 0`.
  - `cylinder(project, center: Vec3, radius: number, height: number, block: BlockOrPalette, hollow?: boolean): void` — throws if `radius < 0` or `height < 1`. Extrudes upward (+Y) from `center.y`.

- [ ] **Step 1: Write the failing tests**

```typescript
// append to test/core/shapes.test.ts
import { sphere, cylinder } from '../../src/core/shapes.js';

describe('sphere', () => {
  it('places a single block for radius 0', () => {
    const project = new BuildProject('demo');
    sphere(project, { x: 5, y: 5, z: 5 }, 0, STONE);
    expect(project.getBlockCounts()).toEqual({ 'minecraft:stone': 1 });
    expect(project.getBlock({ x: 5, y: 5, z: 5 })).toEqual(STONE);
  });

  it('leaves the center empty when hollow with radius 2', () => {
    const project = new BuildProject('demo');
    sphere(project, { x: 0, y: 0, z: 0 }, 2, STONE, true);
    expect(project.getBlock({ x: 0, y: 0, z: 0 })).toBeUndefined();
    expect(project.getBlock({ x: 2, y: 0, z: 0 })).toEqual(STONE);
  });

  it('rejects a negative radius', () => {
    const project = new BuildProject('demo');
    expect(() => sphere(project, { x: 0, y: 0, z: 0 }, -1, STONE)).toThrow();
  });
});

describe('cylinder', () => {
  it('builds a solid cylinder with the given radius and height', () => {
    const project = new BuildProject('demo');
    cylinder(project, { x: 0, y: 0, z: 0 }, 1, 2, STONE);
    // radius-1 circle on a square grid (-1..1, -1..1) covers 5 cells per
    // layer (corners excluded: dist^2 = 2 > 1), times 2 layers = 10.
    expect(project.getBlockCounts()).toEqual({ 'minecraft:stone': 10 });
    expect(project.getBlock({ x: 0, y: 0, z: 0 })).toEqual(STONE);
    expect(project.getBlock({ x: 1, y: 0, z: 1 })).toBeUndefined(); // corner excluded
    expect(project.getBlock({ x: 0, y: 2, z: 0 })).toBeUndefined(); // above height
  });

  it('rejects a non-positive height', () => {
    const project = new BuildProject('demo');
    expect(() => cylinder(project, { x: 0, y: 0, z: 0 }, 1, 0, STONE)).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run test/core/shapes.test.ts`
Expected: FAIL — `sphere`/`cylinder` are not exported yet.

- [ ] **Step 3: Implement sphere and cylinder**

Append to `src/core/shapes.ts`:

```typescript
export function sphere(
  project: BuildProject,
  center: Vec3,
  radius: number,
  block: BlockOrPalette,
  hollow = false
): void {
  if (radius < 0) {
    throw new Error(`sphere radius must be non-negative, got ${radius}.`);
  }
  const r = Math.round(radius);
  const rSquared = r * r;
  const innerSquared = hollow ? (r - 1) * (r - 1) : -1;

  for (let x = -r; x <= r; x++) {
    for (let y = -r; y <= r; y++) {
      for (let z = -r; z <= r; z++) {
        const distSquared = x * x + y * y + z * z;
        if (distSquared > rSquared) continue;
        if (hollow && distSquared < innerSquared) continue;
        project.setBlock(
          { x: center.x + x, y: center.y + y, z: center.z + z },
          resolveBlock(block)
        );
      }
    }
  }
}

export function cylinder(
  project: BuildProject,
  center: Vec3,
  radius: number,
  height: number,
  block: BlockOrPalette,
  hollow = false
): void {
  if (radius < 0) {
    throw new Error(`cylinder radius must be non-negative, got ${radius}.`);
  }
  if (height < 1) {
    throw new Error(`cylinder height must be at least 1, got ${height}.`);
  }
  const r = Math.round(radius);
  const rSquared = r * r;
  const innerSquared = hollow ? (r - 1) * (r - 1) : -1;

  for (let dy = 0; dy < height; dy++) {
    for (let x = -r; x <= r; x++) {
      for (let z = -r; z <= r; z++) {
        const distSquared = x * x + z * z;
        if (distSquared > rSquared) continue;
        if (hollow && distSquared < innerSquared) continue;
        project.setBlock(
          { x: center.x + x, y: center.y + dy, z: center.z + z },
          resolveBlock(block)
        );
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run test/core/shapes.test.ts`
Expected: PASS (10 tests total in the file).

- [ ] **Step 5: Commit**

```bash
git add src/core/shapes.ts test/core/shapes.test.ts
git commit -m "feat: add sphere and cylinder shape primitives"
```

---

## Task 8: Project-Management MCP Tool Handlers

**Files:**
- Create: `src/tools/result.ts`
- Create: `src/tools/project-tools.ts`
- Test: `test/tools/project-tools.test.ts`

**Interfaces:**
- Consumes: `ProjectManager` (Task 3).
- Produces:
  - `interface ToolTextResult { content: { type: 'text'; text: string }[] }`
  - `textResult(text: string): ToolTextResult`
  - `createProjectHandler(manager, { name }): ToolTextResult`
  - `listProjectsHandler(manager): ToolTextResult`
  - `switchProjectHandler(manager, { name }): ToolTextResult`
  - `deleteProjectHandler(manager, { name }): ToolTextResult`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/tools/project-tools.test.ts
import { describe, expect, it } from 'vitest';
import { ProjectManager } from '../../src/core/project-manager.js';
import {
  createProjectHandler,
  listProjectsHandler,
  switchProjectHandler,
  deleteProjectHandler
} from '../../src/tools/project-tools.js';

describe('project tool handlers', () => {
  it('creates and lists projects', () => {
    const manager = new ProjectManager();
    createProjectHandler(manager, { name: 'house' });
    expect(listProjectsHandler(manager).content[0].text).toBe('house');
  });

  it('reports no projects when none exist', () => {
    const manager = new ProjectManager();
    expect(listProjectsHandler(manager).content[0].text).toBe('(no projects yet)');
  });

  it('switches the active project', () => {
    const manager = new ProjectManager();
    createProjectHandler(manager, { name: 'house' });
    createProjectHandler(manager, { name: 'tower' });
    switchProjectHandler(manager, { name: 'house' });
    expect(manager.getActive().name).toBe('house');
  });

  it('deletes a project', () => {
    const manager = new ProjectManager();
    createProjectHandler(manager, { name: 'house' });
    deleteProjectHandler(manager, { name: 'house' });
    expect(listProjectsHandler(manager).content[0].text).toBe('(no projects yet)');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run test/tools/project-tools.test.ts`
Expected: FAIL — `src/tools/project-tools.ts` does not exist yet.

- [ ] **Step 3: Implement the shared result helper and the handlers**

```typescript
// src/tools/result.ts
export interface ToolTextResult {
  content: { type: 'text'; text: string }[];
}

export function textResult(text: string): ToolTextResult {
  return { content: [{ type: 'text', text }] };
}
```

```typescript
// src/tools/project-tools.ts
import type { ProjectManager } from '../core/project-manager.js';
import { textResult, type ToolTextResult } from './result.js';

export function createProjectHandler(manager: ProjectManager, args: { name: string }): ToolTextResult {
  manager.createProject(args.name);
  return textResult(`Created and activated project "${args.name}".`);
}

export function listProjectsHandler(manager: ProjectManager): ToolTextResult {
  const names = manager.listProjects();
  return textResult(names.length > 0 ? names.join(', ') : '(no projects yet)');
}

export function switchProjectHandler(manager: ProjectManager, args: { name: string }): ToolTextResult {
  manager.switchProject(args.name);
  return textResult(`Switched to project "${args.name}".`);
}

export function deleteProjectHandler(manager: ProjectManager, args: { name: string }): ToolTextResult {
  manager.deleteProject(args.name);
  return textResult(`Deleted project "${args.name}".`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run test/tools/project-tools.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/result.ts src/tools/project-tools.ts test/tools/project-tools.test.ts
git commit -m "feat: add project-management MCP tool handlers"
```

---

## Task 9: Block & Shape MCP Tool Handlers

**Files:**
- Create: `src/tools/block-tools.ts`
- Create: `src/tools/shape-tools.ts`
- Test: `test/tools/block-tools.test.ts`
- Test: `test/tools/shape-tools.test.ts`

**Interfaces:**
- Consumes: `ProjectManager` (Task 3), `Vec3`/`BlockState` (Task 2), `fillBox`/`outlineBox`/`wall`/`line`/`sphere`/`cylinder`/`BlockOrPalette` (Tasks 6-7), `textResult`/`ToolTextResult` (Task 8).
- Produces:
  - `setBlockHandler(manager, { pos, block }): ToolTextResult`
  - `setBlocksHandler(manager, { blocks: { pos, block }[] }): ToolTextResult`
  - `fillBoxHandler`, `outlineBoxHandler`, `wallHandler`, `lineHandler`, `sphereHandler`, `cylinderHandler` — each `(manager, args) => ToolTextResult` mirroring the underlying `src/core/shapes.ts` function's parameters.

- [ ] **Step 1: Write the failing tests**

```typescript
// test/tools/block-tools.test.ts
import { describe, expect, it } from 'vitest';
import { ProjectManager } from '../../src/core/project-manager.js';
import { setBlockHandler, setBlocksHandler } from '../../src/tools/block-tools.js';

describe('block tool handlers', () => {
  it('sets a single block on the active project', () => {
    const manager = new ProjectManager();
    manager.createProject('demo');
    setBlockHandler(manager, { pos: { x: 0, y: 0, z: 0 }, block: { id: 'minecraft:stone' } });
    expect(manager.getActive().getBlock({ x: 0, y: 0, z: 0 })).toEqual({ id: 'minecraft:stone' });
  });

  it('sets multiple blocks in one call', () => {
    const manager = new ProjectManager();
    manager.createProject('demo');
    setBlocksHandler(manager, {
      blocks: [
        { pos: { x: 0, y: 0, z: 0 }, block: { id: 'minecraft:stone' } },
        { pos: { x: 1, y: 0, z: 0 }, block: { id: 'minecraft:dirt' } }
      ]
    });
    expect(manager.getActive().getBlockCounts()).toEqual({
      'minecraft:stone': 1,
      'minecraft:dirt': 1
    });
  });

  it('throws when there is no active project', () => {
    const manager = new ProjectManager();
    expect(() =>
      setBlockHandler(manager, { pos: { x: 0, y: 0, z: 0 }, block: { id: 'minecraft:stone' } })
    ).toThrow();
  });
});
```

```typescript
// test/tools/shape-tools.test.ts
import { describe, expect, it } from 'vitest';
import { ProjectManager } from '../../src/core/project-manager.js';
import { fillBoxHandler, sphereHandler } from '../../src/tools/shape-tools.js';

describe('shape tool handlers', () => {
  it('fills a box on the active project', () => {
    const manager = new ProjectManager();
    manager.createProject('demo');
    fillBoxHandler(manager, {
      from: { x: 0, y: 0, z: 0 },
      to: { x: 1, y: 0, z: 0 },
      block: { id: 'minecraft:stone' }
    });
    expect(manager.getActive().getBlockCounts()).toEqual({ 'minecraft:stone': 2 });
  });

  it('builds a sphere on the active project', () => {
    const manager = new ProjectManager();
    manager.createProject('demo');
    sphereHandler(manager, {
      center: { x: 0, y: 0, z: 0 },
      radius: 0,
      block: { id: 'minecraft:stone' }
    });
    expect(manager.getActive().getBlockCounts()).toEqual({ 'minecraft:stone': 1 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run test/tools/block-tools.test.ts test/tools/shape-tools.test.ts`
Expected: FAIL — neither handler file exists yet.

- [ ] **Step 3: Implement the handlers**

```typescript
// src/tools/block-tools.ts
import type { ProjectManager } from '../core/project-manager.js';
import type { BlockState, Vec3 } from '../core/types.js';
import { textResult, type ToolTextResult } from './result.js';

export function setBlockHandler(
  manager: ProjectManager,
  args: { pos: Vec3; block: BlockState }
): ToolTextResult {
  manager.getActive().setBlock(args.pos, args.block);
  return textResult(`Set block at (${args.pos.x}, ${args.pos.y}, ${args.pos.z}).`);
}

export function setBlocksHandler(
  manager: ProjectManager,
  args: { blocks: { pos: Vec3; block: BlockState }[] }
): ToolTextResult {
  const project = manager.getActive();
  for (const entry of args.blocks) {
    project.setBlock(entry.pos, entry.block);
  }
  return textResult(`Set ${args.blocks.length} block(s).`);
}
```

```typescript
// src/tools/shape-tools.ts
import type { ProjectManager } from '../core/project-manager.js';
import { fillBox, outlineBox, line, wall, sphere, cylinder, type BlockOrPalette } from '../core/shapes.js';
import type { Vec3 } from '../core/types.js';
import { textResult, type ToolTextResult } from './result.js';

export function fillBoxHandler(
  manager: ProjectManager,
  args: { from: Vec3; to: Vec3; block: BlockOrPalette }
): ToolTextResult {
  fillBox(manager.getActive(), args.from, args.to, args.block);
  return textResult('Filled box.');
}

export function outlineBoxHandler(
  manager: ProjectManager,
  args: { from: Vec3; to: Vec3; block: BlockOrPalette }
): ToolTextResult {
  outlineBox(manager.getActive(), args.from, args.to, args.block);
  return textResult('Outlined box.');
}

export function wallHandler(
  manager: ProjectManager,
  args: { from: Vec3; to: Vec3; height: number; block: BlockOrPalette }
): ToolTextResult {
  wall(manager.getActive(), args.from, args.to, args.height, args.block);
  return textResult('Built wall.');
}

export function lineHandler(
  manager: ProjectManager,
  args: { from: Vec3; to: Vec3; block: BlockOrPalette }
): ToolTextResult {
  line(manager.getActive(), args.from, args.to, args.block);
  return textResult('Drew line.');
}

export function sphereHandler(
  manager: ProjectManager,
  args: { center: Vec3; radius: number; block: BlockOrPalette; hollow?: boolean }
): ToolTextResult {
  sphere(manager.getActive(), args.center, args.radius, args.block, args.hollow ?? false);
  return textResult('Built sphere.');
}

export function cylinderHandler(
  manager: ProjectManager,
  args: { center: Vec3; radius: number; height: number; block: BlockOrPalette; hollow?: boolean }
): ToolTextResult {
  cylinder(manager.getActive(), args.center, args.radius, args.height, args.block, args.hollow ?? false);
  return textResult('Built cylinder.');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run test/tools/block-tools.test.ts test/tools/shape-tools.test.ts`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/tools/block-tools.ts src/tools/shape-tools.ts test/tools/block-tools.test.ts test/tools/shape-tools.test.ts
git commit -m "feat: add block and shape MCP tool handlers"
```

---

## Task 10: Info & Export MCP Tool Handlers

**Files:**
- Create: `src/tools/info-tools.ts`
- Test: `test/tools/info-tools.test.ts`

**Interfaces:**
- Consumes: `ProjectManager` (Task 3), `writeSchematic` (Task 5), `textResult`/`ToolTextResult` (Task 8).
- Produces:
  - `getBuildInfoHandler(manager): ToolTextResult` — reports size, bounding box, and per-id block counts, or "is empty" for an empty project.
  - `exportSchematicHandler(manager): ToolTextResult` — writes `./output/<projectName>.schem`, creating the directory if needed, and reports the path written.

- [ ] **Step 1: Write the failing tests**

```typescript
// test/tools/info-tools.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { ProjectManager } from '../../src/core/project-manager.js';
import { getBuildInfoHandler, exportSchematicHandler } from '../../src/tools/info-tools.js';

describe('info tool handlers', () => {
  afterEach(() => {
    if (existsSync('./output/info-test.schem')) {
      rmSync('./output/info-test.schem');
    }
  });

  it('reports an empty project', () => {
    const manager = new ProjectManager();
    manager.createProject('empty');
    expect(getBuildInfoHandler(manager).content[0].text).toContain('is empty');
  });

  it('summarizes size and block counts', () => {
    const manager = new ProjectManager();
    manager.createProject('demo');
    manager.getActive().setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    manager.getActive().setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:dirt' });
    const text = getBuildInfoHandler(manager).content[0].text;
    expect(text).toContain('2x1x1');
    expect(text).toContain('minecraft:stone: 1');
  });

  it('writes a .schem file to the output directory', () => {
    const manager = new ProjectManager();
    manager.createProject('info-test');
    manager.getActive().setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
    const result = exportSchematicHandler(manager);
    expect(existsSync('./output/info-test.schem')).toBe(true);
    expect(result.content[0].text).toContain('output/info-test.schem');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run test/tools/info-tools.test.ts`
Expected: FAIL — `src/tools/info-tools.ts` does not exist yet.

- [ ] **Step 3: Implement the handlers**

```typescript
// src/tools/info-tools.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectManager } from '../core/project-manager.js';
import { writeSchematic } from '../schematic/writer.js';
import { textResult, type ToolTextResult } from './result.js';

const OUTPUT_DIR = './output';

export function getBuildInfoHandler(manager: ProjectManager): ToolTextResult {
  const project = manager.getActive();
  const bbox = project.getBoundingBox();

  if (!bbox) {
    return textResult(`Project "${project.name}" is empty.`);
  }

  const width = bbox.max.x - bbox.min.x + 1;
  const height = bbox.max.y - bbox.min.y + 1;
  const length = bbox.max.z - bbox.min.z + 1;
  const countsText = Object.entries(project.getBlockCounts())
    .map(([id, count]) => `${id}: ${count}`)
    .join(', ');

  return textResult(
    `Project "${project.name}": ${width}x${height}x${length} blocks. ` +
      `Bounding box min=(${bbox.min.x},${bbox.min.y},${bbox.min.z}) ` +
      `max=(${bbox.max.x},${bbox.max.y},${bbox.max.z}). Block counts: ${countsText}.`
  );
}

export function exportSchematicHandler(manager: ProjectManager): ToolTextResult {
  const project = manager.getActive();
  const buffer = writeSchematic(project);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = join(OUTPUT_DIR, `${project.name}.schem`);
  writeFileSync(outputPath, buffer);
  return textResult(`Exported to ${outputPath}`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run test/tools/info-tools.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/info-tools.ts test/tools/info-tools.test.ts
git commit -m "feat: add getBuildInfo and exportSchematic MCP tool handlers"
```

---

## Task 11: MCP Server Wiring

**Files:**
- Create: `src/server.ts`
- Modify: `src/index.ts`
- Test: `test/server.test.ts`

**Interfaces:**
- Consumes: every handler from Tasks 8-10, `ProjectManager` (Task 3).
- Produces: `createServer(): McpServer` (fully configured, not yet connected to a transport) from `src/server.ts`; `src/index.ts` connects it to `StdioServerTransport` and is the package's real entrypoint.

- [ ] **Step 1: Write the failing test**

```typescript
// test/server.test.ts
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';

describe('MCP server wiring', () => {
  it('registers tools and runs a basic build flow end-to-end', async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    await client.callTool({ name: 'createProject', arguments: { name: 'test-house' } });
    await client.callTool({
      name: 'setBlock',
      arguments: { pos: { x: 0, y: 0, z: 0 }, block: { id: 'minecraft:stone' } }
    });
    const infoResult = await client.callTool({ name: 'getBuildInfo', arguments: {} });

    const text = (infoResult.content as { type: string; text: string }[])[0].text;
    expect(text).toContain('test-house');
    expect(text).toContain('minecraft:stone: 1');

    await client.close();
    await server.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run test/server.test.ts`
Expected: FAIL — `src/server.ts` does not exist yet.

- [ ] **Step 3: Implement the server wiring**

```typescript
// src/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ProjectManager } from './core/project-manager.js';
import {
  createProjectHandler,
  listProjectsHandler,
  switchProjectHandler,
  deleteProjectHandler
} from './tools/project-tools.js';
import { setBlockHandler, setBlocksHandler } from './tools/block-tools.js';
import {
  fillBoxHandler,
  outlineBoxHandler,
  wallHandler,
  lineHandler,
  sphereHandler,
  cylinderHandler
} from './tools/shape-tools.js';
import { getBuildInfoHandler, exportSchematicHandler } from './tools/info-tools.js';

const vec3Shape = { x: z.number().int(), y: z.number().int(), z: z.number().int() };
const blockStateSchema = z.object({
  id: z.string(),
  properties: z.record(z.string()).optional()
});
const blockOrPaletteSchema = z.union([
  blockStateSchema,
  z.array(z.object({ block: blockStateSchema, weight: z.number().positive() }))
]);

export function createServer(): McpServer {
  const manager = new ProjectManager();
  const server = new McpServer({ name: 'mc-schema-mcp', version: '0.1.0' });

  server.registerTool(
    'createProject',
    { description: 'Create a new build project and make it active.', inputSchema: { name: z.string() } },
    async ({ name }) => createProjectHandler(manager, { name })
  );

  server.registerTool(
    'listProjects',
    { description: 'List all build project names.', inputSchema: {} },
    async () => listProjectsHandler(manager)
  );

  server.registerTool(
    'switchProject',
    { description: 'Switch the active build project.', inputSchema: { name: z.string() } },
    async ({ name }) => switchProjectHandler(manager, { name })
  );

  server.registerTool(
    'deleteProject',
    { description: 'Delete a build project.', inputSchema: { name: z.string() } },
    async ({ name }) => deleteProjectHandler(manager, { name })
  );

  server.registerTool(
    'setBlock',
    {
      description: 'Set a single block in the active project.',
      inputSchema: { pos: z.object(vec3Shape), block: blockStateSchema }
    },
    async (args) => setBlockHandler(manager, args)
  );

  server.registerTool(
    'setBlocks',
    {
      description: 'Set multiple blocks in the active project in one call.',
      inputSchema: { blocks: z.array(z.object({ pos: z.object(vec3Shape), block: blockStateSchema })) }
    },
    async (args) => setBlocksHandler(manager, args)
  );

  server.registerTool(
    'fillBox',
    {
      description: 'Fill a solid rectangular box.',
      inputSchema: { from: z.object(vec3Shape), to: z.object(vec3Shape), block: blockOrPaletteSchema }
    },
    async (args) => fillBoxHandler(manager, args)
  );

  server.registerTool(
    'outlineBox',
    {
      description: 'Build a hollow rectangular box (shell only).',
      inputSchema: { from: z.object(vec3Shape), to: z.object(vec3Shape), block: blockOrPaletteSchema }
    },
    async (args) => outlineBoxHandler(manager, args)
  );

  server.registerTool(
    'wall',
    {
      description: 'Build a vertical wall along the line between two points.',
      inputSchema: {
        from: z.object(vec3Shape),
        to: z.object(vec3Shape),
        height: z.number().int().positive(),
        block: blockOrPaletteSchema
      }
    },
    async (args) => wallHandler(manager, args)
  );

  server.registerTool(
    'line',
    {
      description: 'Draw a straight line of blocks between two points.',
      inputSchema: { from: z.object(vec3Shape), to: z.object(vec3Shape), block: blockOrPaletteSchema }
    },
    async (args) => lineHandler(manager, args)
  );

  server.registerTool(
    'sphere',
    {
      description: 'Build a sphere.',
      inputSchema: {
        center: z.object(vec3Shape),
        radius: z.number().nonnegative(),
        block: blockOrPaletteSchema,
        hollow: z.boolean().optional()
      }
    },
    async (args) => sphereHandler(manager, args)
  );

  server.registerTool(
    'cylinder',
    {
      description: 'Build a cylinder.',
      inputSchema: {
        center: z.object(vec3Shape),
        radius: z.number().nonnegative(),
        height: z.number().int().positive(),
        block: blockOrPaletteSchema,
        hollow: z.boolean().optional()
      }
    },
    async (args) => cylinderHandler(manager, args)
  );

  server.registerTool(
    'getBuildInfo',
    { description: 'Get a summary of the active project (size, bounding box, block counts).', inputSchema: {} },
    async () => getBuildInfoHandler(manager)
  );

  server.registerTool(
    'exportSchematic',
    { description: 'Export the active project to a .schem file in ./output.', inputSchema: {} },
    async () => exportSchematicHandler(manager)
  );

  return server;
}
```

```typescript
// src/index.ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run test/server.test.ts`
Expected: PASS (1 test). If `Client`/`InMemoryTransport` import paths differ from what's installed, check `node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.d.ts` and `.../inMemory.d.ts` for the exact exported members and adjust the import paths accordingly — the class names (`Client`, `InMemoryTransport.createLinkedPair`) are stable across 1.x.

- [ ] **Step 5: Full-suite check**

Run: `pnpm build && pnpm test`
Expected: TypeScript build succeeds; every test file from Tasks 2-11 passes.

- [ ] **Step 6: Manual smoke test**

Run: `pnpm start`
Expected: the process starts and waits on stdio without crashing (Ctrl+C to stop) — confirms `StdioServerTransport` wiring works outside of the in-memory test harness.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts src/index.ts test/server.test.ts
git commit -m "feat: wire MCP tools into a stdio server entrypoint"
```

---

## After Implementation

Once all 11 tasks are complete and committed, point Claude Code's MCP client configuration at `node <repo>/dist/index.js` (stdio) to start using the server. Loading the exported `.schem` files still requires the manual copy-to-server-folder + FAWE `//schematic load` step described in the spec — that step stays outside this project's scope.
