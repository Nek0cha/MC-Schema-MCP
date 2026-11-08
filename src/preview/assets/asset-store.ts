import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { unzipSync } from 'fflate';

export type AssetState = 'missing' | 'downloading' | 'ready' | 'failed';

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const JAR_PREFIX = 'assets/minecraft/';
const COMPLETE_MARKER = '.complete';

/** Whether a jar entry is one of the folders the preview needs (JSON for blockstates/models, PNG for textures). */
function wantedEntry(name: string): boolean {
  if (!name.startsWith(JAR_PREFIX)) return false;
  const rel = name.slice(JAR_PREFIX.length);
  if (rel.startsWith('blockstates/') || rel.startsWith('models/block/')) return rel.endsWith('.json');
  if (rel.startsWith('textures/block/') || rel.startsWith('textures/colormap/')) return rel.endsWith('.png');
  return false;
}

export interface AssetStoreOptions {
  cacheDir: string;
  version: string;
  fetchImpl?: typeof fetch;
}

/**
 * Downloads client.jar for one Minecraft version and caches the block
 * blockstates, block models and block/colormap textures under
 * `<cacheDir>/assets/<version>/`. Nothing from the jar is ever bundled.
 */
export class AssetStore {
  private readonly cacheDir: string;
  private readonly versionId: string;
  private readonly fetchImpl: typeof fetch;
  private currentState: AssetState;
  private lastError: string | undefined;
  private inflight: Promise<void> | undefined;

  constructor(opts: AssetStoreOptions) {
    this.cacheDir = opts.cacheDir;
    this.versionId = opts.version;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.currentState = existsSync(join(this.root, COMPLETE_MARKER)) ? 'ready' : 'missing';
  }

  get state(): AssetState {
    return this.currentState;
  }

  get error(): string | undefined {
    return this.lastError;
  }

  get version(): string {
    return this.versionId;
  }

  get root(): string {
    return join(this.cacheDir, 'assets', this.versionId);
  }

  /** Idempotent: resolves immediately when ready, shares one download while in flight, retries after a failure. */
  ensure(): Promise<void> {
    if (this.currentState === 'ready') return Promise.resolve();
    if (this.inflight) return this.inflight;
    this.currentState = 'downloading';
    this.lastError = undefined;
    const run = this.download().then(
      () => {
        this.currentState = 'ready';
        this.inflight = undefined;
      },
      (err: unknown) => {
        this.currentState = 'failed';
        this.lastError = err instanceof Error ? err.message : String(err);
        this.inflight = undefined;
        throw err;
      }
    );
    this.inflight = run;
    return run;
  }

  /** Reads a cached JSON file such as `blockstates/oak_stairs.json`; undefined when absent or unreadable. */
  readJson(relPath: string): unknown | undefined {
    const file = this.safePath(relPath);
    if (!file) return undefined;
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return undefined;
    }
  }

  /** Block ids (without the namespace) that have a cached blockstate file; empty when nothing is cached. */
  listBlockstates(): string[] {
    const dir = this.safePath('blockstates');
    if (!dir) return [];
    try {
      return readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length));
    } catch {
      return [];
    }
  }

  /** Absolute path of a cached texture such as `block/oak_planks`, or undefined when not cached. */
  texturePath(name: string): string | undefined {
    const file = this.safePath(join('textures', `${name}.png`));
    return file && existsSync(file) ? file : undefined;
  }

  private safePath(relPath: string): string | undefined {
    const root = resolve(this.root);
    const file = resolve(root, relPath);
    return file.startsWith(root) ? file : undefined;
  }

  private async fetchOk(url: string): Promise<Response> {
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`Request to ${url} failed with HTTP ${res.status}.`);
    return res;
  }

  private async download(): Promise<void> {
    const manifest = (await (await this.fetchOk(MANIFEST_URL)).json()) as {
      versions?: { id: string; url: string }[];
    };
    const entry = manifest.versions?.find((v) => v.id === this.versionId);
    if (!entry) throw new Error(`Minecraft version "${this.versionId}" was not found in the version manifest.`);

    const meta = (await (await this.fetchOk(entry.url)).json()) as {
      downloads?: { client?: { url: string; sha1: string } };
    };
    const client = meta.downloads?.client;
    if (!client) throw new Error(`Version "${this.versionId}" has no client download.`);

    const jar = new Uint8Array(await (await this.fetchOk(client.url)).arrayBuffer());
    const actual = createHash('sha1').update(jar).digest('hex');
    if (actual !== client.sha1.toLowerCase()) {
      throw new Error(`client.jar sha1 mismatch for ${this.versionId}: expected ${client.sha1}, got ${actual}.`);
    }

    const files = unzipSync(jar, { filter: (file) => wantedEntry(file.name) });
    const tmp = `${this.root}.tmp-${process.pid}`;
    rmSync(tmp, { recursive: true, force: true });
    try {
      for (const [name, data] of Object.entries(files)) {
        const dest = join(tmp, name.slice(JAR_PREFIX.length));
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, data);
      }
      mkdirSync(tmp, { recursive: true });
      writeFileSync(join(tmp, COMPLETE_MARKER), '');
      rmSync(this.root, { recursive: true, force: true });
      mkdirSync(dirname(this.root), { recursive: true });
      renameSync(tmp, this.root);
    } catch (err) {
      rmSync(tmp, { recursive: true, force: true });
      throw err;
    }
  }
}
