# Build Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `previewBuild` MCP tool that starts a local, loopback-only HTTP server serving a 2D layer-by-layer viewer of the active (or named) build, with hover-to-inspect and click-to-copy-coordinates.

**Architecture:** A `PreviewServer` class (Node's built-in `http` module, no new dependencies) lazily starts on first `previewBuild` call and stays alive for the life of the MCP process. It serves a single static HTML/CSS/JS page at `/` and a JSON endpoint at `/api/build` that flattens a project's voxels. The page itself does all rendering (canvas) and interaction (layer switching, zoom/pan, hover tooltip, click-to-copy) client-side in vanilla JS — no build step, no framework.

**Tech Stack:** TypeScript, Node built-in `http`/`node:url`, vitest (tests use the global `fetch` for HTTP assertions). No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-01-build-preview-design.md`

## Global Constraints

- The HTTP server binds to `127.0.0.1` only — never `0.0.0.0` — so it's unreachable from outside the machine.
- No new npm dependencies; use only Node's built-in `http`/`url` modules.
- No real Minecraft textures; block colors are either a hand-picked hex value or a deterministic hash-based HSL color.
- The viewer is Y-axis-slice-only for this plan (no X/Z slicing, no 3D, no live auto-refresh) — see the spec's "やらないこと" section.
- Follow existing code patterns: tool handlers live in `src/tools/*.ts` and return `ToolTextResult` via `textResult()` (see `src/tools/result.ts`); `server.ts` registers tools with zod schema factories (see the comment at the top of `src/server.ts`).

---

### Task 1: `ProjectManager.getProject` — non-destructive lookup by name

**Files:**
- Modify: `src/core/project-manager.ts`
- Test: `test/core/project-manager.test.ts`

**Interfaces:**
- Produces: `ProjectManager.getProject(name: string): BuildProject | undefined` — looks up a project by name without changing `activeProjectName`.

- [ ] **Step 1: Write the failing tests**

Add to `test/core/project-manager.test.ts`, inside the existing `describe('ProjectManager', ...)` block:

```ts
  it('gets a project by name without changing the active project', () => {
    const manager = new ProjectManager();
    manager.createProject('house');
    manager.createProject('tower'); // 'tower' is now active

    const house = manager.getProject('house');

    expect(house?.name).toBe('house');
    expect(manager.getActive().name).toBe('tower');
  });

  it('returns undefined when getting a project that does not exist', () => {
    const manager = new ProjectManager();
    expect(manager.getProject('missing')).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/core/project-manager.test.ts`
Expected: FAIL — `manager.getProject is not a function`

- [ ] **Step 3: Implement**

In `src/core/project-manager.ts`, add this method to the `ProjectManager` class (next to `getActive`):

```ts
  getProject(name: string): BuildProject | undefined {
    return this.projects.get(name);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run test/core/project-manager.test.ts`
Expected: PASS, all tests green

- [ ] **Step 5: Commit**

```bash
git add src/core/project-manager.ts test/core/project-manager.test.ts
git commit -m "feat: add ProjectManager.getProject for non-destructive lookup by name"
```

---

### Task 2: Block color logic

**Files:**
- Create: `src/preview/block-colors.ts`
- Test: `test/preview/block-colors.test.ts`

**Interfaces:**
- Produces: `colorFor(blockId: string): string` — returns a CSS color string. Manually-mapped IDs return their hand-picked hex color; `minecraft:air` returns a dedicated color; everything else returns a deterministic `hsl(...)` string derived from the ID.

- [ ] **Step 1: Write the failing tests**

Create `test/preview/block-colors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { colorFor } from '../../src/preview/block-colors.js';

describe('colorFor', () => {
  it('returns the manually-mapped color for a well-known block', () => {
    expect(colorFor('minecraft:stone')).toBe('#8a8a8a');
  });

  it('returns a dedicated color for air', () => {
    expect(colorFor('minecraft:air')).toBe('#2a2a2a');
  });

  it('returns a deterministic hash-based color for an unmapped block', () => {
    const first = colorFor('minecraft:some_unlisted_block');
    const second = colorFor('minecraft:some_unlisted_block');

    expect(first).toBe(second);
    expect(first).toMatch(/^hsl\(\d+, 55%, 55%\)$/);
  });

  it('returns different colors for different unmapped blocks', () => {
    const a = colorFor('minecraft:block_alpha');
    const b = colorFor('minecraft:block_beta');

    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/preview/block-colors.test.ts`
Expected: FAIL — `Cannot find module '../../src/preview/block-colors.js'`

- [ ] **Step 3: Implement**

Create `src/preview/block-colors.ts`:

```ts
/**
 * Hand-picked colors for blocks that are common enough to deserve a
 * natural-looking color instead of a hashed one. Not exhaustive by
 * design — everything else falls back to colorFor's hash-based color.
 */
const MANUAL_COLORS: Record<string, string> = {
  'minecraft:air': '#2a2a2a',
  'minecraft:stone': '#8a8a8a',
  'minecraft:cobblestone': '#7a7a7a',
  'minecraft:dirt': '#7a5230',
  'minecraft:grass_block': '#5b8a3c',
  'minecraft:oak_planks': '#b98b52',
  'minecraft:oak_log': '#6b5233',
  'minecraft:sand': '#ded2a0',
  'minecraft:gravel': '#8d8478',
  'minecraft:water': '#3d6fd1',
  'minecraft:glass': '#bfe3f0',
  'minecraft:white_wool': '#e8e8e8',
  'minecraft:bricks': '#9a5040',
  'minecraft:iron_bars': '#a8a8a8',
  'minecraft:oak_fence': '#b98b52',
  'minecraft:cobblestone_wall': '#7a7a7a'
};

/**
 * A simple, fast string hash (djb2-ish). Only used to pick a color, so it
 * doesn't need to be cryptographically sound — just deterministic and
 * reasonably well-distributed across the hue circle.
 */
function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function colorFor(blockId: string): string {
  const manual = MANUAL_COLORS[blockId];
  if (manual) {
    return manual;
  }
  const hue = hashString(blockId) % 360;
  return `hsl(${hue}, 55%, 55%)`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run test/preview/block-colors.test.ts`
Expected: PASS, all 4 tests green

- [ ] **Step 5: Commit**

```bash
git add src/preview/block-colors.ts test/preview/block-colors.test.ts
git commit -m "feat: add block-to-color mapping for the build preview"
```

---

### Task 3: `PreviewServer` — HTTP server skeleton serving a placeholder page at `/`

**Files:**
- Create: `src/preview/viewer-html.ts`
- Create: `src/preview/server.ts`
- Test: `test/preview/server.test.ts`

**Interfaces:**
- Consumes: `ProjectManager` (from `src/core/project-manager.js`, Task 1's `getProject`)
- Produces:
  - `buildViewerHtml(): string` from `src/preview/viewer-html.ts` (this task's version is a minimal placeholder page; Task 5 replaces its body with the full viewer, keeping the same signature)
  - `class PreviewServer` from `src/preview/server.ts` with:
    - `constructor(manager: ProjectManager)`
    - `ensureStarted(): Promise<number>` — starts the server on first call (OS-assigned port on `127.0.0.1`), returns the same port on subsequent calls without restarting
    - `close(): Promise<void>` — stops the server; safe to call even if never started

- [ ] **Step 1: Write the failing tests**

Create `test/preview/server.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectManager } from '../../src/core/project-manager.js';
import { PreviewServer } from '../../src/preview/server.js';

describe('PreviewServer', () => {
  let server: PreviewServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('starts and serves an HTML page at /', async () => {
    const manager = new ProjectManager();
    server = new PreviewServer(manager);
    const port = await server.ensureStarted();

    const response = await fetch(`http://127.0.0.1:${port}/`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('<title>');
  });

  it('reuses the same port on a second ensureStarted call', async () => {
    const manager = new ProjectManager();
    server = new PreviewServer(manager);

    const firstPort = await server.ensureStarted();
    const secondPort = await server.ensureStarted();

    expect(secondPort).toBe(firstPort);
  });

  it('returns 404 for an unknown path', async () => {
    const manager = new ProjectManager();
    server = new PreviewServer(manager);
    const port = await server.ensureStarted();

    const response = await fetch(`http://127.0.0.1:${port}/nope`);

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/preview/server.test.ts`
Expected: FAIL — `Cannot find module '../../src/preview/server.js'`

- [ ] **Step 3: Implement**

Create `src/preview/viewer-html.ts`:

```ts
/**
 * Renders the build preview page. This is a placeholder body for now —
 * Task 5 of the build-preview plan replaces the markup and script with
 * the full canvas-based layer viewer, keeping this same signature.
 */
export function buildViewerHtml(): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>MC Schema Preview</title>
</head>
<body>
  <p>Loading preview...</p>
</body>
</html>`;
}
```

Create `src/preview/server.ts`:

```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { ProjectManager } from '../core/project-manager.js';
import { buildViewerHtml } from './viewer-html.js';

export class PreviewServer {
  private readonly manager: ProjectManager;
  private server: Server | null = null;
  private port: number | null = null;

  constructor(manager: ProjectManager) {
    this.manager = manager;
  }

  ensureStarted(): Promise<number> {
    if (this.port !== null) {
      return Promise.resolve(this.port);
    }
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handleRequest(req, res));
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('Failed to determine the preview server port.'));
          return;
        }
        // Don't let this server keep the MCP process alive on its own —
        // it's a passive viewer, not something that should block a clean
        // shutdown once stdio closes.
        server.unref();
        this.server = server;
        this.port = address.port;
        resolve(this.port);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildViewerHtml());
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run test/preview/server.test.ts`
Expected: PASS, all 3 tests green

- [ ] **Step 5: Commit**

```bash
git add src/preview/viewer-html.ts src/preview/server.ts test/preview/server.test.ts
git commit -m "feat: add PreviewServer skeleton serving a placeholder page"
```

---

### Task 4: `/api/build` endpoint

**Files:**
- Modify: `src/preview/server.ts`
- Test: `test/preview/server.test.ts`

**Interfaces:**
- Consumes: `ProjectManager.getActive()`, `ProjectManager.getProject(name)` (Task 1), `BuildProject.voxels`, `BuildProject.getBoundingBox()`, `parseVoxelKey` (from `src/core/build-project.js`, already exported — see `[[connections.ts's use of it]]`)
- Produces: `GET /api/build` and `GET /api/build?project=<name>` on the existing `PreviewServer`, returning JSON shaped `{ project: string, bounds: BoundingBox | null, blocks: { x: number, y: number, z: number, id: string }[] }` on success, or `{ error: string }` with a 404 status when the project can't be found.

- [ ] **Step 1: Write the failing tests**

Add to `test/preview/server.test.ts`, inside the existing `describe('PreviewServer', ...)` block (add the `BuildProject` type import too — see below):

```ts
  it('returns the active project as JSON from /api/build', async () => {
    const manager = new ProjectManager();
    manager.createProject('demo');
    manager.getActive().setBlock({ x: 0, y: 64, z: 0 }, { id: 'minecraft:stone' });
    server = new PreviewServer(manager);
    const port = await server.ensureStarted();

    const response = await fetch(`http://127.0.0.1:${port}/api/build`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.project).toBe('demo');
    expect(data.bounds).toEqual({ min: { x: 0, y: 64, z: 0 }, max: { x: 0, y: 64, z: 0 } });
    expect(data.blocks).toEqual([{ x: 0, y: 64, z: 0, id: 'minecraft:stone' }]);
  });

  it('returns a named project via the project query param, ignoring the active one', async () => {
    const manager = new ProjectManager();
    manager.createProject('house');
    manager.createProject('tower'); // 'tower' is active
    manager.getProject('house')?.setBlock({ x: 1, y: 2, z: 3 }, { id: 'minecraft:dirt' });
    server = new PreviewServer(manager);
    const port = await server.ensureStarted();

    const response = await fetch(`http://127.0.0.1:${port}/api/build?project=house`);
    const data = await response.json();

    expect(data.project).toBe('house');
    expect(data.blocks).toEqual([{ x: 1, y: 2, z: 3, id: 'minecraft:dirt' }]);
  });

  it('returns 404 for a project name that does not exist', async () => {
    const manager = new ProjectManager();
    server = new PreviewServer(manager);
    const port = await server.ensureStarted();

    const response = await fetch(`http://127.0.0.1:${port}/api/build?project=missing`);

    expect(response.status).toBe(404);
  });

  it('returns 404 when no project param is given and there is no active project', async () => {
    const manager = new ProjectManager();
    server = new PreviewServer(manager);
    const port = await server.ensureStarted();

    const response = await fetch(`http://127.0.0.1:${port}/api/build`);

    expect(response.status).toBe(404);
  });

  it('returns empty bounds and blocks for a project with no blocks', async () => {
    const manager = new ProjectManager();
    manager.createProject('empty');
    server = new PreviewServer(manager);
    const port = await server.ensureStarted();

    const response = await fetch(`http://127.0.0.1:${port}/api/build`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.bounds).toBeNull();
    expect(data.blocks).toEqual([]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/preview/server.test.ts`
Expected: FAIL — the new tests get a 404 (no `/api/build` route exists yet)

- [ ] **Step 3: Implement**

In `src/preview/server.ts`, update the imports:

```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { parseVoxelKey, type BuildProject } from '../core/build-project.js';
import type { ProjectManager } from '../core/project-manager.js';
import { buildViewerHtml } from './viewer-html.js';
```

Replace the `handleRequest` method with:

```ts
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildViewerHtml());
      return;
    }

    if (url.pathname === '/api/build') {
      this.handleApiBuild(url, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
```

Add a new private method to the class:

```ts
  private handleApiBuild(url: URL, res: ServerResponse): void {
    const projectName = url.searchParams.get('project');
    const project = projectName ? this.manager.getProject(projectName) : this.getActiveOrUndefined();

    if (!project) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: projectName ? `Project "${projectName}" does not exist.` : 'No active project.'
        })
      );
      return;
    }

    const blocks = [...project.voxels].map(([key, block]) => {
      const pos = parseVoxelKey(key);
      return { x: pos.x, y: pos.y, z: pos.z, id: block.id };
    });

    const body = JSON.stringify({
      project: project.name,
      bounds: project.getBoundingBox(),
      blocks
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
  }

  private getActiveOrUndefined(): BuildProject | undefined {
    try {
      return this.manager.getActive();
    } catch {
      return undefined;
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run test/preview/server.test.ts`
Expected: PASS, all 8 tests green

- [ ] **Step 5: Commit**

```bash
git add src/preview/server.ts test/preview/server.test.ts
git commit -m "feat: add /api/build endpoint to the preview server"
```

---

### Task 5: Full viewer page (canvas rendering, layer switching, hover, click-to-copy, zoom/pan)

**Files:**
- Modify: `src/preview/viewer-html.ts`

**Interfaces:**
- Consumes: `GET /api/build` response shape from Task 4 (`{ project, bounds, blocks }`)
- Produces: same `buildViewerHtml(): string` signature as Task 3 — only the body changes. No test changes; per the spec, canvas rendering and DOM interaction are manually verified, not unit tested.

This task has no automated test — the spec explicitly scopes canvas/DOM behavior out of automated testing. Instead of red/green, verify manually in Step 2.

- [ ] **Step 1: Replace `buildViewerHtml` with the full viewer**

Replace the entire contents of `src/preview/viewer-html.ts` with:

```ts
/**
 * Renders the build preview page: a single self-contained HTML document
 * (inline CSS/JS, no external requests) that fetches /api/build, renders
 * the current Y layer to a canvas, and lets the user switch layers,
 * zoom/pan, hover a cell for its coordinates + block id, and click a
 * cell to copy "x, y, z" to the clipboard.
 *
 * The color logic here intentionally duplicates src/preview/block-colors.ts
 * (see the design spec) so this page stays a single static file with no
 * server-side templating step.
 */
export function buildViewerHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>MC Schema Preview</title>
<style>
  html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; background: #1e1e1e; color: #eee; }
  #toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #2a2a2a; box-sizing: border-box; }
  #toolbar button { background: #3a3a3a; color: #eee; border: 1px solid #555; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 14px; }
  #toolbar button:hover { background: #4a4a4a; }
  #toolbar input { width: 70px; background: #1e1e1e; color: #eee; border: 1px solid #555; border-radius: 4px; padding: 4px; }
  #status { margin-left: auto; font-size: 12px; color: #aaa; }
  #canvasWrap { position: relative; width: 100vw; height: calc(100vh - 49px); overflow: hidden; cursor: grab; }
  #canvasWrap.dragging { cursor: grabbing; }
  canvas { display: block; }
  #tooltip { position: fixed; pointer-events: none; background: rgba(0,0,0,0.85); color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 12px; display: none; white-space: nowrap; z-index: 10; }
</style>
</head>
<body>
  <div id="toolbar">
    <strong id="projectName">-</strong>
    <button id="layerDown" title="Layer down">&#9664;</button>
    <span>Y:</span>
    <input id="layerInput" type="number" />
    <button id="layerUp" title="Layer up">&#9654;</button>
    <span id="status"></span>
  </div>
  <div id="canvasWrap">
    <canvas id="canvas"></canvas>
    <div id="tooltip"></div>
  </div>
<script>
(function () {
  var MANUAL_COLORS = {
    'minecraft:air': '#2a2a2a',
    'minecraft:stone': '#8a8a8a',
    'minecraft:cobblestone': '#7a7a7a',
    'minecraft:dirt': '#7a5230',
    'minecraft:grass_block': '#5b8a3c',
    'minecraft:oak_planks': '#b98b52',
    'minecraft:oak_log': '#6b5233',
    'minecraft:sand': '#ded2a0',
    'minecraft:gravel': '#8d8478',
    'minecraft:water': '#3d6fd1',
    'minecraft:glass': '#bfe3f0',
    'minecraft:white_wool': '#e8e8e8',
    'minecraft:bricks': '#9a5040',
    'minecraft:iron_bars': '#a8a8a8',
    'minecraft:oak_fence': '#b98b52',
    'minecraft:cobblestone_wall': '#7a7a7a'
  };

  function hashString(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  function colorFor(id) {
    if (MANUAL_COLORS[id]) return MANUAL_COLORS[id];
    var hue = hashString(id) % 360;
    return 'hsl(' + hue + ', 55%, 55%)';
  }

  var params = new URLSearchParams(location.search);
  var projectParam = params.get('project');
  var apiUrl = '/api/build' + (projectParam ? ('?project=' + encodeURIComponent(projectParam)) : '');

  var canvasWrap = document.getElementById('canvasWrap');
  var canvas = document.getElementById('canvas');
  var ctx = canvas.getContext('2d');
  var tooltip = document.getElementById('tooltip');
  var layerInput = document.getElementById('layerInput');
  var statusEl = document.getElementById('status');
  var projectNameEl = document.getElementById('projectName');

  var state = {
    bounds: null,
    layers: {},
    currentY: 0,
    cellSize: 20,
    offsetX: 20,
    offsetZ: 20
  };

  function cellKey(x, z) { return x + ',' + z; }

  function resize() {
    canvas.width = canvasWrap.clientWidth;
    canvas.height = canvasWrap.clientHeight;
  }
  window.addEventListener('resize', function () { resize(); render(); });
  resize();

  fetch(apiUrl).then(function (res) {
    if (!res.ok) {
      return res.json().then(function (err) { throw new Error(err.error || 'Failed to load build.'); });
    }
    return res.json();
  }).then(function (data) {
    if (!data.bounds) {
      statusEl.textContent = 'No blocks in this project.';
      return;
    }
    projectNameEl.textContent = data.project;
    state.bounds = data.bounds;
    state.currentY = data.bounds.min.y;
    data.blocks.forEach(function (b) {
      if (!state.layers[b.y]) state.layers[b.y] = new Map();
      state.layers[b.y].set(cellKey(b.x, b.z), b.id);
    });
    layerInput.min = String(data.bounds.min.y);
    layerInput.max = String(data.bounds.max.y);
    layerInput.value = String(state.currentY);
    render();
  }).catch(function (err) {
    statusEl.textContent = err.message;
  });

  function render() {
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!state.bounds) return;

    var layer = state.layers[state.currentY];
    var minX = state.bounds.min.x, minZ = state.bounds.min.z;
    var maxX = state.bounds.max.x, maxZ = state.bounds.max.z;

    for (var x = minX; x <= maxX; x++) {
      for (var z = minZ; z <= maxZ; z++) {
        var id = layer ? layer.get(cellKey(x, z)) : undefined;
        var px = state.offsetX + (x - minX) * state.cellSize;
        var pz = state.offsetZ + (z - minZ) * state.cellSize;
        ctx.fillStyle = id ? colorFor(id) : '#2a2a2a';
        ctx.fillRect(px, pz, state.cellSize - 1, state.cellSize - 1);
      }
    }
  }

  function setLayer(y) {
    if (!state.bounds) return;
    y = Math.max(state.bounds.min.y, Math.min(state.bounds.max.y, y));
    state.currentY = y;
    layerInput.value = String(y);
    render();
  }

  document.getElementById('layerDown').addEventListener('click', function () { setLayer(state.currentY - 1); });
  document.getElementById('layerUp').addEventListener('click', function () { setLayer(state.currentY + 1); });
  layerInput.addEventListener('change', function () { setLayer(parseInt(layerInput.value, 10) || 0); });

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var factor = e.deltaY < 0 ? 1.1 : 0.9;
    state.cellSize = Math.max(2, Math.min(200, state.cellSize * factor));
    render();
  }, { passive: false });

  var dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('mousedown', function (e) {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvasWrap.classList.add('dragging');
  });
  window.addEventListener('mouseup', function () {
    dragging = false;
    canvasWrap.classList.remove('dragging');
  });
  window.addEventListener('mousemove', function (e) {
    if (dragging) {
      state.offsetX += e.clientX - lastX;
      state.offsetZ += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      render();
      return;
    }
    handleHover(e);
  });

  function cellFromEvent(e) {
    if (!state.bounds) return null;
    var rect = canvas.getBoundingClientRect();
    var px = e.clientX - rect.left - state.offsetX;
    var pz = e.clientY - rect.top - state.offsetZ;
    var x = Math.floor(px / state.cellSize) + state.bounds.min.x;
    var z = Math.floor(pz / state.cellSize) + state.bounds.min.z;
    if (x < state.bounds.min.x || x > state.bounds.max.x || z < state.bounds.min.z || z > state.bounds.max.z) return null;
    return { x: x, z: z };
  }

  function handleHover(e) {
    var cell = cellFromEvent(e);
    if (!cell) {
      tooltip.style.display = 'none';
      return;
    }
    var layer = state.layers[state.currentY];
    var id = layer ? layer.get(cellKey(cell.x, cell.z)) : undefined;
    tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX + 12) + 'px';
    tooltip.style.top = (e.clientY + 12) + 'px';
    tooltip.textContent = '(' + cell.x + ', ' + state.currentY + ', ' + cell.z + ') ' + (id || 'minecraft:air');
  }

  canvas.addEventListener('mouseleave', function () { tooltip.style.display = 'none'; });

  canvas.addEventListener('click', function (e) {
    var cell = cellFromEvent(e);
    if (!cell) return;
    var text = cell.x + ', ' + state.currentY + ', ' + cell.z;
    navigator.clipboard.writeText(text).then(function () {
      statusEl.textContent = 'Copied: ' + text;
      setTimeout(function () { statusEl.textContent = ''; }, 1500);
    });
  });
})();
</script>
</body>
</html>`;
}
```

- [ ] **Step 2: Verify manually**

Run: `pnpm build && pnpm start &` then, in another terminal or via a short script, use `createServer`/`ProjectManager` directly, or simpler: temporarily add a few `console.log`-driven manual steps aren't needed — instead verify through the full stack once Task 6 wires up the `previewBuild` tool. **Defer full manual verification to Task 6, Step 6** (this task's change has no externally-callable entry point yet — `buildViewerHtml()` isn't reachable from an MCP tool until Task 6). For now, just confirm the file compiles:

Run: `pnpm build`
Expected: exits 0, no TypeScript errors

- [ ] **Step 3: Run the full test suite to confirm nothing broke**

Run: `pnpm test`
Expected: PASS — Task 3/4's `PreviewServer` tests still pass (they only assert `<title>` is present and JSON shapes, both still true)

- [ ] **Step 4: Commit**

```bash
git add src/preview/viewer-html.ts
git commit -m "feat: implement the full build preview viewer page"
```

---

### Task 6: `previewBuild` tool, server registration, README

**Files:**
- Create: `src/tools/preview-tools.ts`
- Test: `test/tools/preview-tools.test.ts`
- Modify: `src/server.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `PreviewServer` (Task 3), `ProjectManager`, `textResult`/`ToolTextResult` (from `src/tools/result.js`)
- Produces:
  - `createPreviewServerState(): PreviewServerState` and `previewBuildHandler(manager: ProjectManager, state: PreviewServerState): Promise<ToolTextResult>` from `src/tools/preview-tools.ts`
  - MCP tool `previewBuild` registered in `src/server.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/tools/preview-tools.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectManager } from '../../src/core/project-manager.js';
import {
  createPreviewServerState,
  previewBuildHandler,
  type PreviewServerState
} from '../../src/tools/preview-tools.js';

describe('previewBuildHandler', () => {
  let state: PreviewServerState | null = null;

  afterEach(async () => {
    if (state?.server) {
      await state.server.close();
    }
    state = null;
  });

  it('throws when there is no active project, matching other tools', async () => {
    const manager = new ProjectManager();
    state = createPreviewServerState();

    await expect(previewBuildHandler(manager, state)).rejects.toThrow();
  });

  it('starts a server and returns its URL', async () => {
    const manager = new ProjectManager();
    manager.createProject('house');
    state = createPreviewServerState();

    const result = await previewBuildHandler(manager, state);

    expect(result.content[0].text).toMatch(/^Preview available at http:\/\/127\.0\.0\.1:\d+\/$/);
  });

  it('reuses the same server (and port) on a second call', async () => {
    const manager = new ProjectManager();
    manager.createProject('house');
    state = createPreviewServerState();

    const first = await previewBuildHandler(manager, state);
    const second = await previewBuildHandler(manager, state);

    expect(first.content[0].text).toBe(second.content[0].text);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/tools/preview-tools.test.ts`
Expected: FAIL — `Cannot find module '../../src/tools/preview-tools.js'`

- [ ] **Step 3: Implement**

Create `src/tools/preview-tools.ts`:

```ts
import type { ProjectManager } from '../core/project-manager.js';
import { PreviewServer } from '../preview/server.js';
import { textResult, type ToolTextResult } from './result.js';

export interface PreviewServerState {
  server: PreviewServer | null;
}

export function createPreviewServerState(): PreviewServerState {
  return { server: null };
}

export async function previewBuildHandler(
  manager: ProjectManager,
  state: PreviewServerState
): Promise<ToolTextResult> {
  // Throws if there's no active project, same as getBuildInfoHandler and
  // exportSchematicHandler — previewBuild always targets the active
  // project (the /api/build route separately supports ?project= for the
  // browser side, but the tool itself doesn't take a project argument).
  manager.getActive();

  if (!state.server) {
    state.server = new PreviewServer(manager);
  }
  const port = await state.server.ensureStarted();
  return textResult(`Preview available at http://127.0.0.1:${port}/`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run test/tools/preview-tools.test.ts`
Expected: PASS, all 3 tests green

- [ ] **Step 5: Register the tool in `src/server.ts` and document it in `README.md`**

In `src/server.ts`, add to the imports:

```ts
import { previewBuildHandler, createPreviewServerState } from './tools/preview-tools.js';
```

Inside `createServer()`, after `const manager = new ProjectManager();`, add:

```ts
  const previewState = createPreviewServerState();
```

Then, after the `exportSchematic` tool registration (before the final `return server;`), add:

```ts
  server.registerTool(
    'previewBuild',
    {
      description:
        'Start (or reuse) a local preview server for the active project and return its URL. ' +
        'Open the URL in a browser to see a layer-by-layer 2D view: switch Y layers, hover a ' +
        'cell for its coordinates and block id, click a cell to copy "x, y, z" to the clipboard.',
      inputSchema: {}
    },
    async () => previewBuildHandler(manager, previewState)
  );
```

In `README.md`, add a row to the "情報・出力" tools table (after the `exportSchematic` row):

```markdown
| `previewBuild` | - | アクティブプロジェクトを2Dレイヤービューアで確認できるローカルサーバーを起動し、URLを返す |
```

- [ ] **Step 6: Full-stack manual verification**

Run: `pnpm build && pnpm test`
Expected: build exits 0, all tests pass

Then manually smoke-test the tool end to end. The project is ESM (`"type": "module"` in `package.json`), so write a throwaway `.mjs` script rather than using `node -e`:

```bash
cat > /tmp/smoke-preview.mjs <<'EOF'
import { ProjectManager } from './dist/core/project-manager.js';
import { createPreviewServerState, previewBuildHandler } from './dist/tools/preview-tools.js';

const manager = new ProjectManager();
manager.createProject('smoke-test');
manager.getActive().setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
manager.getActive().setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:oak_fence' });

const state = createPreviewServerState();
const result = await previewBuildHandler(manager, state);
console.log(result.content[0].text);
// Keep the process alive for 60s so you can open the URL in a browser.
setTimeout(() => process.exit(0), 60000);
EOF
node /tmp/smoke-preview.mjs
```

Open the printed URL in a browser. Confirm: the page loads, shows a colored cell for `(0,0,0)` and `(1,0,0)`, hovering shows coordinates + block id in a tooltip, clicking a cell shows "Copied: ..." in the toolbar, and the mouse wheel zooms.

- [ ] **Step 7: Commit**

```bash
git add src/tools/preview-tools.ts test/tools/preview-tools.test.ts src/server.ts README.md
git commit -m "feat: add previewBuild MCP tool"
```
