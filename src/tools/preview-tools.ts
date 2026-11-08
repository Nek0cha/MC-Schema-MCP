import { dirname } from 'node:path';
import type { ProjectManager } from '../core/project-manager.js';
import type { Vec3 } from '../core/types.js';
import { AssetStore } from '../preview/assets/asset-store.js';
import type { ViewPreset } from '../preview/client/camera-presets.js';
import { ViewRenderer, type BrowserLauncher } from '../preview/render-view.js';
import { PreviewServer } from '../preview/server.js';
import { textResult, type ToolImageResult, type ToolTextResult } from './result.js';

export interface PreviewServerState {
  server: PreviewServer | null;
  /** Asset store handed to the server when it is created; omit to use the env-configured default. */
  assets?: AssetStore;
  /** Shared headless browser for renderView; it only starts on the first render. */
  renderer: ViewRenderer;
  /** Asset stores created for raid-map compatibility checks, one per Minecraft version. */
  versionAssets?: Map<string, AssetStore>;
}

export function createPreviewServerState(assets?: AssetStore, launcher?: BrowserLauncher): PreviewServerState {
  return { server: null, assets, renderer: new ViewRenderer({ launcher }) };
}

/**
 * The asset store for one Minecraft version: the preview's store when it has that version,
 * otherwise one created next to it (same cache directory) and kept for later calls.
 */
export function assetsForVersion(state: PreviewServerState, version: string): AssetStore {
  const known = [state.server?.assets, state.assets].find((a) => a?.version === version);
  if (known) return known;
  const map = (state.versionAssets ??= new Map());
  let store = map.get(version);
  if (!store) {
    const sibling = state.server?.assets ?? state.assets;
    const cacheDir = sibling ? dirname(dirname(sibling.root)) : (process.env.MC_SCHEMA_CACHE_DIR ?? './cache');
    store = new AssetStore({ cacheDir, version });
    map.set(version, store);
  }
  return store;
}

async function ensureServer(
  manager: ProjectManager,
  state: PreviewServerState
): Promise<{ server: PreviewServer; port: number }> {
  if (!state.server) {
    state.server = new PreviewServer(manager, 0, { assets: state.assets });
  }
  const port = await state.server.ensureStarted();
  return { server: state.server, port };
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

  const { server, port } = await ensureServer(manager, state);
  // Download the vanilla block assets in the background; the viewer shows fallback colors until they are ready.
  server.startAssets();
  return textResult(`Preview available at http://127.0.0.1:${port}/`);
}

export interface RenderViewArgs {
  view?: ViewPreset;
  focus?: { from: Vec3; to: Vec3 };
  clipY?: number;
  width?: number;
  height?: number;
  ortho?: boolean;
  /** Draw the raid map markers (default true). */
  markers?: boolean;
  project?: string;
}

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1200;
/** How long renderView waits for the texture download before drawing with fallback colors. */
const ASSET_WAIT_MS = 120_000;

function clampSize(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(64, Math.min(max, Math.round(value)));
}

/** 'ready', 'failed' or 'timeout' once the assets are as available as they will get for this call. */
async function waitForAssets(server: PreviewServer, ms: number): Promise<'ready' | 'failed' | 'timeout'> {
  const assets = server.assets;
  if (assets.state === 'ready') return 'ready';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([assets.ensure().then(() => 'ready' as const, () => 'failed' as const), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const fmt = (p: Vec3) => `(${p.x}, ${p.y}, ${p.z})`;

export async function renderViewHandler(
  manager: ProjectManager,
  state: PreviewServerState,
  args: RenderViewArgs,
  assetWaitMs = ASSET_WAIT_MS
): Promise<ToolImageResult> {
  const project = args.project ? manager.getProject(args.project) : manager.getActive();
  if (!project) throw new Error(`Project "${args.project}" does not exist.`);
  const bounds = project.getBoundingBox();
  if (!bounds) throw new Error(`Project "${project.name}" has no blocks to render.`);

  const { server, port } = await ensureServer(manager, state);
  const assetOutcome = await waitForAssets(server, assetWaitMs);

  const view = args.view ?? 'iso_se';
  const query = new URLSearchParams({ project: project.name, view, ui: '0' });
  let focusText = 'whole project';
  let shownBounds = bounds;
  if (args.focus) {
    const { from, to } = args.focus;
    const min = { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), z: Math.min(from.z, to.z) };
    const max = { x: Math.max(from.x, to.x), y: Math.max(from.y, to.y), z: Math.max(from.z, to.z) };
    query.set('focus', `${min.x},${min.y},${min.z},${max.x},${max.y},${max.z}`);
    shownBounds = { min, max };
    focusText = 'focus box';
  }
  if (args.clipY !== undefined) query.set('clipY', String(args.clipY));
  if (args.ortho) query.set('ortho', '1');
  if (args.markers === false) query.set('markers', '0');

  const size = {
    width: clampSize(args.width, DEFAULT_WIDTH, MAX_WIDTH),
    height: clampSize(args.height, DEFAULT_HEIGHT, MAX_HEIGHT)
  };
  const { png } = await state.renderer.render(`http://127.0.0.1:${port}/?${query.toString()}`, size);

  const assets = server.assets;
  const lines = [
    `View ${view}${args.ortho && view === 'top' ? ' (orthographic)' : ''} of project "${project.name}", ${focusText} ${fmt(shownBounds.min)} to ${fmt(shownBounds.max)}.`,
    args.clipY !== undefined ? `Blocks above Y=${args.clipY} are hidden (clipY ${args.clipY}).` : 'No height cut.',
    `Image ${size.width}x${size.height}.`
  ];
  if (assetOutcome === 'ready') {
    lines.push(`Assets: Minecraft ${assets.version} textures.`);
    const unresolved = server.unresolvedIds(project);
    if (unresolved.length > 0) {
      lines.push(`Block ids that did not resolve (drawn as a magenta/black checker): ${unresolved.join(', ')}.`);
    }
  } else if (assetOutcome === 'failed') {
    lines.push(`Assets: textures are unavailable (${assets.error ?? 'download failed'}); blocks are drawn in fallback colors.`);
  } else {
    lines.push('Assets: the texture download is still running; blocks are drawn in fallback colors. Try again in a minute.');
  }
  return {
    content: [
      { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
      { type: 'text', text: lines.join('\n') }
    ]
  };
}
