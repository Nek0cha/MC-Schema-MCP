/**
 * Web Worker that turns chunk cells into vertex buffers. It only imports
 * relative modules (module workers can't rely on the page's import map).
 */
import { meshChunk, type MeshBuffers, type Rect, type RGB } from './mesher.js';
import type { BakedModel, Tint } from '../models/types.js';
import type { MeshedMessage, ToWorker } from './worker-protocol.js';

interface WorkerScope {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}
const scope = self as unknown as WorkerScope;

const TINTS: Record<Tint, RGB> = {
  none: [1, 1, 1],
  grass: [0x91 / 255, 0xbd / 255, 0x59 / 255],
  foliage: [0x77 / 255, 0xab / 255, 0x2f / 255],
  water: [0x3f / 255, 0x76 / 255, 0xe4 / 255]
};

const models: (BakedModel | null)[] = [null];
const cullGroups: (string | null)[] = [null];
const colors: RGB[] = [[1, 1, 1]];
let rects: Record<string, Rect> = {};
let white: Rect = [0, 0, 0, 0];

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function recenter(buffers: MeshBuffers, center: [number, number, number]): void {
  const p = buffers.positions;
  for (let i = 0; i < p.length; i += 3) {
    p[i] -= center[0];
    p[i + 1] -= center[1];
    p[i + 2] -= center[2];
  }
}

scope.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'reset') {
    models.length = 1;
    cullGroups.length = 1;
    colors.length = 1;
  } else if (msg.type === 'palette') {
    for (const e of msg.entries) {
      models[e.id] = e.model;
      cullGroups[e.id] = e.cullGroup;
      colors[e.id] = hexToRgb(e.color);
    }
  } else if (msg.type === 'atlas') {
    rects = msg.rects;
    white = msg.white;
  } else if (msg.type === 'mesh') {
    const out = meshChunk({
      cx: msg.cx,
      cy: msg.cy,
      cz: msg.cz,
      cells: msg.cells,
      neighbors: msg.neighbors,
      models,
      cullGroups,
      clipY: msg.clipY,
      uvRect: (texture) => rects[texture],
      tintColor: (tint) => TINTS[tint],
      fallback: { rect: white, color: (id) => colors[id] ?? [1, 1, 1] }
    });
    const center: [number, number, number] = [msg.cx * 16 + 8, msg.cy * 16 + 8, msg.cz * 16 + 8];
    const transfer: Transferable[] = [];
    for (const type of ['opaque', 'cutout', 'translucent'] as const) {
      const b = out[type];
      recenter(b, center);
      transfer.push(b.positions.buffer, b.uvs.buffer, b.colors.buffer, b.indices.buffer);
    }
    const reply: MeshedMessage = {
      type: 'meshed',
      key: msg.key,
      seq: msg.seq,
      center,
      opaque: out.opaque,
      cutout: out.cutout,
      translucent: out.translucent
    };
    scope.postMessage(reply, transfer);
  }
};
