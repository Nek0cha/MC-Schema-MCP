import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { CHUNK_SIZE, chunkKey, parseChunkKey, type BuildProject } from '../core/build-project.js';
import type { ProjectManager } from '../core/project-manager.js';
import type { BlockState } from '../core/types.js';
import { isConnectableId, resolveConnectionAt } from '../schematic/connections.js';
import { AssetStore } from './assets/asset-store.js';
import { encodeChunks, type ChunkRecord } from './chunk-codec.js';
import { DisplayPalette } from './display-palette.js';
import type { ModelSource } from './models/types.js';
import { buildViewerHtml } from './viewer-html.js';
import { buildViewer3dHtml } from './viewer3d-html.js';

export interface PreviewServerOptions {
  /** Shared asset store. Defaults to one built from MC_SCHEMA_ASSET_VERSION / MC_SCHEMA_CACHE_DIR. */
  assets?: AssetStore;
  /** Directory served at /client/ (the compiled browser scripts). Defaults to ./client next to this file. */
  clientDir?: string;
}

/** Model source used while the assets are not usable: every block resolves to "unresolved". */
const NO_ASSETS: ModelSource = { readJson: () => undefined };

const NEIGHBOR_OFFSETS: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
];

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

/** Resolves `rel` below `base`; undefined for anything that escapes it (.., encoded separators, NUL). */
function safeJoin(base: string, rel: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) return undefined;
  const root = resolve(base);
  const file = resolve(root, decoded);
  return file.startsWith(root + sep) ? file : undefined;
}

function threeRoot(): string {
  // 'three' resolves to <root>/build/three.cjs; its package.json is not exported.
  return dirname(dirname(createRequire(import.meta.url).resolve('three')));
}

/**
 * The compiled browser scripts. Next to this file when running from dist/; when running the
 * TypeScript sources directly (vitest e2e) only dist/ has the .js files.
 */
function defaultClientDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, 'client'), join(here, '..', '..', 'dist', 'preview', 'client')];
  return candidates.find((dir) => existsSync(join(dir, 'viewer.js'))) ?? candidates[0];
}

function defaultAssets(): AssetStore {
  return new AssetStore({
    cacheDir: process.env.MC_SCHEMA_CACHE_DIR ?? './cache',
    version: process.env.MC_SCHEMA_ASSET_VERSION ?? '1.21.11'
  });
}

interface ProjectView {
  project: BuildProject;
  palette: DisplayPalette;
}

export class PreviewServer {
  private readonly manager: ProjectManager;
  private server: Server | null = null;
  private port: number | null = null;
  private startPromise: Promise<number> | null = null;
  private readonly assetStore: AssetStore;
  private readonly clientDir: string;
  private readonly views = new Map<string, ProjectView>();

  /**
   * `listenPort` defaults to 0 (OS-assigned, the normal production
   * behavior). Tests may pass a fixed port to deterministically force a
   * listen failure (e.g. by pre-occupying that port with another server),
   * to exercise ensureStarted()'s failure-recovery path.
   */
  constructor(
    manager: ProjectManager,
    private readonly listenPort = 0,
    options: PreviewServerOptions = {}
  ) {
    this.manager = manager;
    this.assetStore = options.assets ?? defaultAssets();
    this.clientDir = options.clientDir ?? defaultClientDir();
  }

  get assets(): AssetStore {
    return this.assetStore;
  }

  /**
   * Block ids of the project's displayed blocks that have no model, once the assets are ready
   * (before that every id is "unresolved" by construction, which says nothing about the ids).
   */
  unresolvedIds(project: BuildProject): string[] {
    if (this.assetStore.state !== 'ready') return [];
    const { palette } = this.viewOf(project);
    const ids = new Set<string>();
    for (const e of palette.entriesSince(0)) {
      if (e.model?.status === 'unresolved') ids.add(e.key.split('[')[0]);
    }
    return [...ids].sort();
  }

  /** Starts the asset download in the background; failures show up in /api/status instead of being thrown. */
  startAssets(): void {
    this.assetStore.ensure().catch(() => {});
  }

  ensureStarted(): Promise<number> {
    if (this.port !== null) {
      return Promise.resolve(this.port);
    }
    if (!this.startPromise) {
      this.startPromise = new Promise<number>((resolve, reject) => {
        const server = createServer((req, res) => this.handleRequest(req, res));
        server.on('error', reject);
        server.listen(this.listenPort, '127.0.0.1', () => {
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
      }).catch((err: unknown) => {
        // Don't let a transient failure (EADDRINUSE, EMFILE, ...) wedge this
        // instance forever — clear the cached promise so the next
        // ensureStarted() call gets a fresh attempt instead of replaying the
        // same rejection for the life of the process.
        this.startPromise = null;
        throw err;
      });
    }
    return this.startPromise;
  }

  close(): Promise<void> {
    return (this.startPromise ?? Promise.resolve()).catch(() => {
      // A failed start has nothing listening to close; swallow it so
      // close() is always safe to call regardless of start outcome.
    }).then(() => {
      return new Promise((resolve) => {
        if (!this.server) {
          this.server = null;
          this.port = null;
          this.startPromise = null;
          resolve();
          return;
        }
        this.server.close(() => {
          this.server = null;
          this.port = null;
          this.startPromise = null;
          resolve();
        });
      });
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;

    if (path === '/' || path === '/2d') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(path === '/' ? buildViewer3dHtml() : buildViewerHtml());
      return;
    }

    if (path === '/api/build') {
      this.handleApiBuild(url, res);
      return;
    }
    if (path === '/api/status') {
      this.handleApiStatus(url, res);
      return;
    }
    if (path === '/api/palette') {
      this.handleApiPalette(url, res);
      return;
    }
    if (path === '/api/chunks') {
      this.handleApiChunks(url, res);
      return;
    }

    const vendorBuild = '/vendor/three/build/';
    const vendorAddons = '/vendor/three/examples/jsm/';
    if (path.startsWith(vendorBuild)) {
      void this.serveFile(res, safeJoin(join(threeRoot(), 'build'), path.slice(vendorBuild.length)));
      return;
    }
    if (path.startsWith(vendorAddons)) {
      void this.serveFile(res, safeJoin(join(threeRoot(), 'examples', 'jsm'), path.slice(vendorAddons.length)));
      return;
    }
    if (path === '/chunk-codec.js') {
      // The compiled viewer imports ../chunk-codec.js, which lives next to the client folder.
      void this.serveFile(res, join(this.clientDir, '..', 'chunk-codec.js'));
      return;
    }
    if (path.startsWith('/client/')) {
      void this.serveFile(res, safeJoin(this.clientDir, path.slice('/client/'.length)));
      return;
    }
    const texturePrefix = `/assets/${this.assetStore.version}/textures/`;
    if (path.startsWith(texturePrefix) && path.endsWith('.png')) {
      let name = '..';
      try {
        name = decodeURIComponent(path.slice(texturePrefix.length, -4));
      } catch {
        // keep the rejecting name
      }
      const file = name.split('/').includes('..') ? undefined : this.assetStore.texturePath(name);
      void this.serveFile(res, file, 'public, max-age=3600');
      return;
    }

    this.notFound(res);
  }

  private async serveFile(res: ServerResponse, file: string | undefined, cache = 'no-cache'): Promise<void> {
    if (!file) {
      this.notFound(res);
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': cache });
      res.end(body);
    } catch {
      this.notFound(res);
    }
  }

  private notFound(res: ServerResponse): void {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }

  private projectFor(url: URL, res: ServerResponse): BuildProject | undefined {
    const projectName = url.searchParams.get('project');
    const project = projectName ? this.manager.getProject(projectName) : this.getActiveOrUndefined();
    if (!project) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: projectName ? `Project "${projectName}" does not exist.` : 'No active project.'
        })
      );
    }
    return project;
  }

  /**
   * The display palette of a project. It is recreated when the project object is replaced
   * (delete + create under one name) and re-baked in place, with its version bumped, the first
   * time the assets are seen ready; clients notice the new `paletteVersion` and refetch everything.
   */
  private viewOf(project: BuildProject): ProjectView {
    const ready = this.assetStore.state === 'ready';
    let view = this.views.get(project.name);
    if (!view || view.project !== project) {
      view = { project, palette: new DisplayPalette(ready ? this.assetStore : NO_ASSETS, ready) };
      this.views.set(project.name, view);
    } else if (ready && !view.palette.isReady) {
      view.palette.rebake(this.assetStore, true);
    }
    return view;
  }

  private json(res: ServerResponse, body: unknown): void {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  private handleApiStatus(url: URL, res: ServerResponse): void {
    const project = this.projectFor(url, res);
    if (!project) return;
    const { palette } = this.viewOf(project);
    this.json(res, {
      project: project.name,
      revision: project.revision,
      bounds: project.getBoundingBox(),
      paletteVersion: palette.version,
      assets: { state: this.assetStore.state, version: this.assetStore.version, error: this.assetStore.error }
    });
  }

  private handleApiPalette(url: URL, res: ServerResponse): void {
    const project = this.projectFor(url, res);
    if (!project) return;
    const { palette } = this.viewOf(project);
    const since = Number(url.searchParams.get('since') ?? 0) || 0;
    const clientVersion = url.searchParams.get('version');
    const incremental = clientVersion !== null && Number(clientVersion) === palette.version;
    this.json(res, { version: palette.version, entries: palette.entriesSince(incremental ? since : 0) });
  }

  private handleApiChunks(url: URL, res: ServerResponse): void {
    const project = this.projectFor(url, res);
    if (!project) return;
    const { palette } = this.viewOf(project);
    const since = Number(url.searchParams.get('since') ?? 0) || 0;
    const revision = project.revision;

    // Changed chunks plus their existing neighbours: connections and face culling depend on neighbours.
    const wanted = new Map<string, boolean>(); // key -> removed
    for (const c of project.getChunkRevisionsSince(since)) {
      if (c.removed && since === 0) continue;
      wanted.set(c.key, c.removed);
    }
    for (const key of [...wanted.keys()]) {
      const { cx, cy, cz } = parseChunkKey(key);
      for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
        const nk = chunkKey(cx + dx, cy + dy, cz + dz);
        if (!wanted.has(nk) && project.getChunk(nk)) wanted.set(nk, false);
      }
    }

    const focus = parseFocus(url.searchParams.get('focus'), Number(url.searchParams.get('margin') ?? 32));
    const records: ChunkRecord[] = [];
    for (const [key, removed] of wanted) {
      const { cx, cy, cz } = parseChunkKey(key);
      if (focus && !chunkOverlaps(cx, cy, cz, focus)) continue;
      records.push(
        removed ? { cx, cy, cz, removed: true } : { cx, cy, cz, removed: false, cells: buildCells(project, key, palette) }
      );
    }

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'gzip',
      'Cache-Control': 'no-store',
      'X-Revision': String(revision)
    });
    res.end(gzipSync(encodeChunks(records), { level: 3 }));
  }

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

    const blocks: { x: number; y: number; z: number; id: string }[] = [];
    project.forEachBlock((pos, block) => {
      blocks.push({ x: pos.x, y: pos.y, z: pos.z, id: block.id });
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
}

interface Focus {
  min: [number, number, number];
  max: [number, number, number];
}

/** "x1,y1,z1,x2,y2,z2" widened by `margin` blocks; undefined when absent or malformed. */
function parseFocus(raw: string | null, margin: number): Focus | undefined {
  if (!raw) return undefined;
  const n = raw.split(',').map(Number);
  if (n.length !== 6 || n.some((v) => !Number.isFinite(v))) return undefined;
  const m = Number.isFinite(margin) ? Math.max(0, margin) : 32;
  return {
    min: [Math.min(n[0], n[3]) - m, Math.min(n[1], n[4]) - m, Math.min(n[2], n[5]) - m],
    max: [Math.max(n[0], n[3]) + m, Math.max(n[1], n[4]) + m, Math.max(n[2], n[5]) + m]
  };
}

function chunkOverlaps(cx: number, cy: number, cz: number, f: Focus): boolean {
  const c = [cx, cy, cz];
  for (let i = 0; i < 3; i++) {
    const lo = c[i] * CHUNK_SIZE;
    if (lo + CHUNK_SIZE - 1 < f.min[i] || lo > f.max[i]) return false;
  }
  return true;
}

/** Display-palette ids for one chunk, with fence/pane/wall connections resolved against the neighbours. */
function buildCells(project: BuildProject, key: string, palette: DisplayPalette): Uint16Array {
  const chunk = project.getChunk(key) as Uint16Array;
  const { cx, cy, cz } = parseChunkKey(key);
  const projectPalette = project.getPalette();
  // Per project palette index: display id for plain blocks, -1 = not looked at yet, -2 = needs connection resolving.
  const plain = new Int32Array(projectPalette.length).fill(-1);
  const out = new Uint16Array(chunk.length);
  for (let i = 0; i < chunk.length; i++) {
    const v = chunk[i];
    if (v === 0) continue;
    let d = plain[v];
    if (d === -1) {
      const block = projectPalette[v] as BlockState;
      d = isConnectableId(block.id) ? -2 : palette.idFor(block);
      plain[v] = d;
    }
    if (d >= 0) {
      out[i] = d;
      continue;
    }
    const pos = { x: cx * CHUNK_SIZE + (i & 15), y: cy * CHUNK_SIZE + (i >> 8), z: cz * CHUNK_SIZE + ((i >> 4) & 15) };
    out[i] = palette.idFor(resolveConnectionAt(project, pos) ?? (projectPalette[v] as BlockState));
  }
  return out;
}
