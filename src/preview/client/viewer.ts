/**
 * Browser entry of the 3D preview. Polls the preview server for changed chunks,
 * meshes them in Web Workers and draws them with three.js.
 *
 * Palette handling: the server numbers display blocks per project. When the
 * assets become ready it re-bakes those entries and bumps `paletteVersion`;
 * the viewer then drops its palette, refetches it in full, rebuilds the
 * texture set and re-meshes every chunk. Chunk cells keep their ids.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { decodeChunks } from '../chunk-codec.js';
import { Atlas, MISSING_TEXTURE } from './atlas.js';
import { presetPose, VIEW_PRESETS, type ViewPreset } from './camera-presets.js';
import type { MeshBuffers } from './mesher.js';
import type { MeshedMessage, PaletteEntryMessage, ToWorker } from './worker-protocol.js';

declare global {
  interface Window {
    __previewReady?: boolean;
    __previewError?: string;
    __previewStats?: { chunks: number; meshes: number; palette: number; textures: boolean; assets: string };
  }
}

type Face = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';
type Vec = { x: number; y: number; z: number };
interface Bounds {
  min: Vec;
  max: Vec;
}
interface Status {
  project: string;
  revision: number;
  bounds: Bounds | null;
  paletteVersion: number;
  assets: { state: string; version: string; error?: string };
}
type MeshType = 'opaque' | 'cutout' | 'translucent';
const MESH_TYPES: MeshType[] = ['opaque', 'cutout', 'translucent'];
const NEIGHBOR_FACES: [Face, number, number, number][] = [
  ['east', 1, 0, 0],
  ['west', -1, 0, 0],
  ['up', 0, 1, 0],
  ['down', 0, -1, 0],
  ['south', 0, 0, 1],
  ['north', 0, 0, -1]
];

const params = new URLSearchParams(location.search);
const projectParam = params.get('project');
const showUi = params.get('ui') !== '0';
const focusParam = params.get('focus');
const marginParam = params.get('margin');
const initialView = (VIEW_PRESETS as readonly string[]).includes(params.get('view') ?? '')
  ? (params.get('view') as ViewPreset)
  : 'iso_se';
const clipParam = params.get('clipY');

if (!showUi) document.body.classList.add('no-ui');

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function fail(message: string): void {
  window.__previewError = message;
  const box = el('message');
  box.style.display = 'block';
  box.textContent = message;
}

function apiUrl(path: string, extra: Record<string, string | number> = {}): string {
  const q = new URLSearchParams();
  if (projectParam) q.set('project', projectParam);
  for (const [k, v] of Object.entries(extra)) q.set(k, String(v));
  return `${path}?${q.toString()}`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed: ${url} (${res.status})`);
  return body as T;
}

// ---------------------------------------------------------------- scene

THREE.ColorManagement.enabled = false;

let renderer: THREE.WebGLRenderer | undefined;
try {
  renderer = new THREE.WebGLRenderer({ canvas: el<HTMLCanvasElement>('canvas'), antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // vertex colors and textures are used as-is, like the game
} catch (err) {
  fail(`WebGL is not available: ${err instanceof Error ? err.message : String(err)}`);
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb4d9);
const chunkGroup = new THREE.Group();
/** Reserved for later overlays (markers etc.); nothing draws into it yet. */
const overlayGroup = new THREE.Group();
scene.add(chunkGroup, overlayGroup);

const atlas = new Atlas();
const atlasTexture = new THREE.CanvasTexture(atlas.canvas);
atlasTexture.colorSpace = THREE.NoColorSpace;
atlasTexture.magFilter = THREE.NearestFilter;
atlasTexture.minFilter = THREE.NearestFilter;
atlasTexture.generateMipmaps = false;
atlasTexture.flipY = false;

const materials: Record<MeshType, THREE.Material> = {
  // alphaTest: overlay quads (grass block sides) have transparent texels but live in the opaque pass.
  opaque: new THREE.MeshBasicMaterial({ map: atlasTexture, vertexColors: true, alphaTest: 0.5 }),
  cutout: new THREE.MeshBasicMaterial({ map: atlasTexture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }),
  translucent: new THREE.MeshBasicMaterial({
    map: atlasTexture,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  })
};

let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
let controls: OrbitControls | undefined;
let ortho = params.get('ortho') === '1';
let currentView: ViewPreset = initialView;
let needsRender = true;

// ---------------------------------------------------------------- state

let status: Status | null = null;
let revision = 0;
let paletteVersion = -1;
let paletteSize = 0;
const entries: (PaletteEntryMessage | undefined)[] = [];
const chunks = new Map<string, Uint16Array>();
const dirty = new Set<string>();
let clipY: number | undefined = clipParam !== null && clipParam !== '' ? Number(clipParam) : undefined;
if (clipY !== undefined && !Number.isFinite(clipY)) clipY = undefined;
let texturesOn = false;

const chunkKey = (cx: number, cy: number, cz: number) => `${cx},${cy},${cz}`;
const parseKey = (key: string) => {
  const [cx, cy, cz] = key.split(',').map(Number);
  return { cx, cy, cz };
};

// ---------------------------------------------------------------- workers

interface Pooled {
  worker: Worker;
  busy: boolean;
}
const poolSize = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4));
const pool: Pooled[] = [];
const pending = new Set<string>();
const latestSeq = new Map<string, number>();
const inFlight = new Map<number, { key: string; built: string }>();
let seqCounter = 0;
const idleWaiters: (() => void)[] = [];

interface ChunkMeshes {
  built: string;
  meshes: Partial<Record<MeshType, THREE.Mesh>>;
}
const meshes = new Map<string, ChunkMeshes>();

function broadcast(msg: ToWorker): void {
  for (const p of pool) p.worker.postMessage(msg);
}

function startWorkers(): void {
  for (let i = 0; i < poolSize; i++) {
    const worker = new Worker('/client/mesh-worker.js', { type: 'module' });
    const pooled: Pooled = { worker, busy: false };
    worker.onmessage = (event: MessageEvent<MeshedMessage>) => {
      pooled.busy = false;
      applyMesh(event.data);
      dispatch();
    };
    worker.onerror = (event) => fail(`Mesh worker failed: ${event.message}`);
    pool.push(pooled);
  }
}

/** Part of the clip height that decides what a chunk's mesh looks like: 'full', 'none' or the clip itself. */
function clipClass(cy: number): string {
  if (clipY === undefined || clipY >= cy * 16 + 16) return 'full';
  if (clipY < cy * 16) return 'none';
  return String(clipY);
}

function removeMeshes(key: string): void {
  const entry = meshes.get(key);
  if (!entry) return;
  for (const mesh of Object.values(entry.meshes)) {
    chunkGroup.remove(mesh);
    mesh.geometry.dispose();
  }
  meshes.delete(key);
  needsRender = true;
}

function queueMesh(key: string): void {
  pending.add(key);
}

function dispatch(): void {
  for (const p of pool) {
    if (p.busy) continue;
    let key: string | undefined;
    for (const k of pending) {
      key = k;
      break;
    }
    while (key !== undefined) {
      pending.delete(key);
      const cells = chunks.get(key);
      const { cx, cy, cz } = parseKey(key);
      if (!cells) {
        removeMeshes(key);
      } else if (clipClass(cy) === 'none') {
        removeMeshes(key);
        latestSeq.delete(key);
        meshes.set(key, { built: 'none', meshes: {} });
      } else {
        const neighbors: Partial<Record<Face, Uint16Array>> = {};
        for (const [face, dx, dy, dz] of NEIGHBOR_FACES) {
          const n = chunks.get(chunkKey(cx + dx, cy + dy, cz + dz));
          if (n) neighbors[face] = n;
        }
        const seq = ++seqCounter;
        latestSeq.set(key, seq);
        inFlight.set(seq, { key, built: clipClass(cy) });
        p.busy = true;
        p.worker.postMessage({ type: 'mesh', key, seq, cx, cy, cz, cells, neighbors, clipY } satisfies ToWorker);
        break;
      }
      key = undefined;
      for (const k of pending) {
        key = k;
        break;
      }
    }
  }
  if (pending.size === 0 && pool.every((p) => !p.busy)) {
    for (const resolve of idleWaiters.splice(0)) resolve();
  }
}

function meshesIdle(): Promise<void> {
  dispatch();
  if (pending.size === 0 && pool.every((p) => !p.busy)) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

function toGeometry(b: MeshBuffers): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(b.positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(b.uvs, 2));
  g.setAttribute('color', new THREE.BufferAttribute(b.colors, 3));
  g.setIndex(new THREE.BufferAttribute(b.indices, 1));
  g.computeBoundingSphere();
  return g;
}

function applyMesh(msg: MeshedMessage): void {
  const job = inFlight.get(msg.seq);
  inFlight.delete(msg.seq);
  if (!job || latestSeq.get(msg.key) !== msg.seq || !chunks.has(msg.key)) return;
  removeMeshes(msg.key);
  const entry: ChunkMeshes = { built: job.built, meshes: {} };
  for (const type of MESH_TYPES) {
    const buffers = msg[type];
    if (buffers.indices.length === 0) continue;
    const mesh = new THREE.Mesh(toGeometry(buffers), materials[type]);
    mesh.position.set(...msg.center);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    chunkGroup.add(mesh);
    entry.meshes[type] = mesh;
  }
  meshes.set(msg.key, entry);
  needsRender = true;
}

// ---------------------------------------------------------------- data sync

function resetPalette(): void {
  entries.length = 0;
  paletteSize = 0;
  broadcast({ type: 'reset' });
}

function textureUrl(name: string): string {
  return `/assets/${status?.assets.version}/textures/${name}.png`;
}

async function syncPaletteAndTextures(): Promise<void> {
  if (!status) return;
  const resp = await getJson<{ version: number; entries: PaletteEntryMessage[] }>(
    apiUrl('/api/palette', { since: paletteSize, version: paletteVersion })
  );
  if (resp.version !== paletteVersion) {
    resetPalette();
    paletteVersion = resp.version;
    for (const key of chunks.keys()) queueMesh(key);
  }
  const fresh = resp.entries;
  for (const e of fresh) entries[e.id] = e;
  if (fresh.length > 0) paletteSize = Math.max(paletteSize, fresh[fresh.length - 1].id);

  const wasOn = texturesOn;
  texturesOn = status.assets.state === 'ready';
  if (texturesOn) {
    atlas.addMissing();
    const names = new Set<string>();
    for (const e of fresh) for (const q of e.model?.quads ?? []) names.add(q.texture);
    await atlas.add(names, textureUrl);
  }
  if (fresh.length > 0) broadcast({ type: 'palette', entries: fresh });
  broadcast({ type: 'atlas', rects: texturesOn ? atlas.rects(true) : {}, white: atlas.white });
  atlasTexture.needsUpdate = true;
  if (wasOn !== texturesOn) for (const key of chunks.keys()) queueMesh(key);
  updateUnresolved();
}

async function fetchChunks(): Promise<number> {
  const extra: Record<string, string | number> = { since: revision };
  if (focusParam) extra.focus = focusParam;
  if (marginParam) extra.margin = marginParam;
  const res = await fetch(apiUrl('/api/chunks', extra), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Chunk request failed (${res.status})`);
  const newRevision = Number(res.headers.get('x-revision'));
  const records = decodeChunks(new Uint8Array(await res.arrayBuffer()));
  for (const r of records) {
    const key = chunkKey(r.cx, r.cy, r.cz);
    if (r.removed) {
      chunks.delete(key);
      latestSeq.delete(key);
      removeMeshes(key);
    } else if (r.cells) {
      chunks.set(key, r.cells);
    }
    queueMesh(key);
  }
  revision = newRevision;
  return records.length;
}

let syncing = false;
async function sync(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const next = await getJson<Status>(apiUrl('/api/status'));
    const first = status === null;
    status = next;
    updateToolbar();
    const assetsChanged = next.assets.state === 'ready' !== texturesOn;
    if (first || next.revision !== revision || next.paletteVersion !== paletteVersion || assetsChanged) {
      await fetchChunks();
      await syncPaletteAndTextures();
      if (first) setupClip();
      for (const key of chunks.keys()) {
        const cy = parseKey(key).cy;
        const entry = meshes.get(key);
        if (entry && entry.built !== clipClass(cy) && !pending.has(key)) queueMesh(key);
      }
      dispatch();
    }
  } finally {
    syncing = false;
  }
}

// ---------------------------------------------------------------- camera

function focusBounds(): Bounds | null {
  if (focusParam) {
    const n = focusParam.split(',').map(Number);
    if (n.length === 6 && n.every(Number.isFinite)) {
      return {
        min: { x: Math.min(n[0], n[3]), y: Math.min(n[1], n[4]), z: Math.min(n[2], n[5]) },
        max: { x: Math.max(n[0], n[3]), y: Math.max(n[1], n[4]), z: Math.max(n[2], n[5]) }
      };
    }
  }
  return status?.bounds ?? null;
}

function viewportSize(): { w: number; h: number } {
  return { w: window.innerWidth, h: window.innerHeight };
}

function applyView(preset: ViewPreset): void {
  currentView = preset;
  const bounds = focusBounds() ?? { min: { x: 0, y: 0, z: 0 }, max: { x: 15, y: 15, z: 15 } };
  const { w, h } = viewportSize();
  const aspect = w / h;
  const pose = presetPose(preset, bounds, 50, aspect);
  const useOrtho = ortho && preset === 'top';
  const dist = Math.hypot(
    pose.position[0] - pose.target[0],
    pose.position[1] - pose.target[1],
    pose.position[2] - pose.target[2]
  );
  if (useOrtho) {
    const halfX = ((bounds.max.x + 1 - bounds.min.x) / 2) * 1.05;
    const halfZ = ((bounds.max.z + 1 - bounds.min.z) / 2) * 1.05;
    const halfH = Math.max(halfZ, halfX / aspect);
    camera = new THREE.OrthographicCamera(-halfH * aspect, halfH * aspect, halfH, -halfH, 0.1, dist * 40);
  } else {
    camera = new THREE.PerspectiveCamera(50, aspect, Math.max(0.1, dist / 1000), dist * 40);
  }
  camera.up.set(...pose.up);
  camera.position.set(...pose.position);
  controls?.dispose();
  controls = new OrbitControls(camera, el<HTMLCanvasElement>('canvas'));
  controls.target.set(...pose.target);
  controls.enableDamping = false;
  controls.addEventListener('change', () => {
    needsRender = true;
  });
  controls.update();
  needsRender = true;
  for (const b of document.querySelectorAll<HTMLButtonElement>('#presets button')) {
    b.classList.toggle('active', b.dataset.view === preset);
  }
  el('ortho').classList.toggle('active', ortho);
}

function resize(): void {
  const { w, h } = viewportSize();
  renderer?.setSize(w, h, false);
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = w / h;
  } else {
    const halfH = camera.top;
    camera.left = -halfH * (w / h);
    camera.right = halfH * (w / h);
  }
  camera.updateProjectionMatrix();
  needsRender = true;
}

function renderFrame(): boolean {
  if (!renderer || !needsRender) return false;
  needsRender = false;
  renderer.render(scene, camera);
  return true;
}

// ---------------------------------------------------------------- UI

function updateToolbar(): void {
  if (!status) return;
  el('projectName').textContent = status.project;
  el('revision').textContent = String(status.revision);
  const assets = el('assets');
  const a = status.assets;
  assets.textContent =
    a.state === 'ready'
      ? `textures ${a.version}`
      : a.state === 'downloading'
        ? `downloading textures ${a.version}... (colors only)`
        : a.state === 'failed'
          ? `textures unavailable (${a.error ?? 'download failed'}); colors only`
          : 'textures not loaded; colors only';
  assets.classList.toggle('bad', a.state !== 'ready');
}

function updateUnresolved(): void {
  const box = el('unresolved');
  const names = new Set<string>();
  if (texturesOn) {
    for (const e of entries) {
      if (e?.model?.status === 'unresolved') names.add(e.key.split('[')[0]);
    }
  }
  box.style.display = names.size > 0 ? 'block' : 'none';
  box.textContent = names.size > 0 ? `Unresolved block ids (drawn magenta): ${[...names].join(', ')}` : '';
}

function setupClip(): void {
  const slider = el<HTMLInputElement>('clip');
  const bounds = status?.bounds;
  if (!bounds) return;
  slider.min = String(bounds.min.y);
  slider.max = String(bounds.max.y);
  const apply = (value: number | undefined) => {
    clipY = value;
    slider.value = String(value ?? bounds.max.y);
    el('clipLabel').textContent = value === undefined ? 'off' : String(value);
    for (const key of chunks.keys()) {
      const entry = meshes.get(key);
      if (!entry || entry.built !== clipClass(parseKey(key).cy)) queueMesh(key);
    }
    dispatch();
  };
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    apply(v >= bounds.max.y ? undefined : v);
  });
  apply(clipY !== undefined && clipY >= bounds.max.y ? undefined : clipY);
}

function buildPresetButtons(): void {
  const box = el('presets');
  for (const preset of VIEW_PRESETS) {
    const b = document.createElement('button');
    b.textContent = preset;
    b.dataset.view = preset;
    b.addEventListener('click', () => applyView(preset));
    box.appendChild(b);
  }
  el('ortho').addEventListener('click', () => {
    ortho = !ortho;
    applyView(ortho ? 'top' : currentView);
  });
}

// ---------------------------------------------------------------- picking (voxel DDA)

function cellAt(x: number, y: number, z: number): number {
  if (clipY !== undefined && y > clipY) return 0;
  const cells = chunks.get(chunkKey(x >> 4, y >> 4, z >> 4));
  return cells ? cells[(((y & 15) << 4) + (z & 15)) * 16 + (x & 15)] : 0;
}

function pick(clientX: number, clientY: number): { x: number; y: number; z: number; id: number } | null {
  const { w, h } = viewportSize();
  const ndc = new THREE.Vector2((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin;
  const d = ray.ray.direction;
  let x = Math.floor(o.x);
  let y = Math.floor(o.y);
  let z = Math.floor(o.z);
  const step = [Math.sign(d.x), Math.sign(d.y), Math.sign(d.z)];
  const delta = [Math.abs(1 / d.x), Math.abs(1 / d.y), Math.abs(1 / d.z)];
  const next = (p: number, c: number, s: number, dir: number) => (dir === 0 ? Infinity : s > 0 ? (c + 1 - p) / dir : (c - p) / dir);
  const t = [next(o.x, x, step[0], d.x), next(o.y, y, step[1], d.y), next(o.z, z, step[2], d.z)];
  const bounds = status?.bounds;
  if (!bounds) return null;
  const limit = Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z) * 4 + 2000;
  for (let i = 0; i < limit * 3; i++) {
    const id = cellAt(x, y, z);
    if (id !== 0) return { x, y, z, id };
    const axis = t[0] < t[1] ? (t[0] < t[2] ? 0 : 2) : t[1] < t[2] ? 1 : 2;
    if (t[axis] > limit) return null;
    if (axis === 0) x += step[0];
    else if (axis === 1) y += step[1];
    else z += step[2];
    t[axis] += delta[axis];
  }
  return null;
}

function setupPicking(): void {
  const tooltip = el('tooltip');
  const canvas = el<HTMLCanvasElement>('canvas');
  canvas.addEventListener('mousemove', (e) => {
    if (e.buttons !== 0) {
      tooltip.style.display = 'none';
      return;
    }
    const hit = pick(e.clientX, e.clientY);
    if (!hit) {
      tooltip.style.display = 'none';
      return;
    }
    const entry = entries[hit.id];
    tooltip.style.display = 'block';
    tooltip.style.left = `${e.clientX + 12}px`;
    tooltip.style.top = `${e.clientY + 12}px`;
    tooltip.textContent = `(${hit.x}, ${hit.y}, ${hit.z}) ${entry?.key ?? '?'}`;
  });
  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });
  let downAt: [number, number] | null = null;
  canvas.addEventListener('mousedown', (e) => {
    downAt = [e.clientX, e.clientY];
  });
  canvas.addEventListener('click', (e) => {
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return; // a drag, not a click
    const hit = pick(e.clientX, e.clientY);
    if (!hit) return;
    const text = `${hit.x}, ${hit.y}, ${hit.z}`;
    const box = el('message');
    navigator.clipboard
      .writeText(text)
      .then(() => {
        box.style.display = 'block';
        box.textContent = `Copied: ${text}`;
        setTimeout(() => {
          box.style.display = 'none';
        }, 1500);
      })
      .catch(() => {});
  });
}

// ---------------------------------------------------------------- main

function stats(): void {
  let count = 0;
  for (const m of meshes.values()) count += Object.keys(m.meshes).length;
  window.__previewStats = {
    chunks: chunks.size,
    meshes: count,
    palette: paletteSize,
    textures: texturesOn,
    assets: status?.assets.state ?? 'unknown'
  };
}

async function main(): Promise<void> {
  if (!renderer) return;
  buildPresetButtons();
  setupPicking();
  startWorkers();
  window.addEventListener('resize', resize);
  const loop = () => {
    if (renderFrame()) stats();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  try {
    await sync();
    applyView(initialView);
    resize();
    await meshesIdle();
    needsRender = true;
    // One frame after the meshes are in: wait for a rAF tick that rendered.
    await new Promise<void>((resolve) => {
      const check = () => {
        if (!needsRender) resolve();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    stats();
    window.__previewReady = true;
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return;
  }

  setInterval(() => {
    sync().catch((err) => {
      const box = el('message');
      box.style.display = 'block';
      box.textContent = err instanceof Error ? err.message : String(err);
    });
  }, 2000);
}

void main();
