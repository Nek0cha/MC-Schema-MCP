/**
 * Binary chunk payload shared by the preview server and the browser viewer.
 * Layout (little endian): [count u32] then per chunk
 * [cx i32][cy i32][cz i32][state u8: 0 = present, 1 = removed][4096 x u16 cells, present only].
 * No Node APIs are used here; the server gzips the bytes (Content-Encoding) and the browser
 * un-gzips them transparently.
 */
export interface ChunkRecord {
  cx: number;
  cy: number;
  cz: number;
  removed: boolean;
  cells?: Uint16Array;
}

const CELLS = 4096;

export function encodeChunks(entries: ChunkRecord[]): Uint8Array {
  let size = 4;
  for (const e of entries) size += 13 + (e.removed ? 0 : CELLS * 2);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, entries.length, true);
  let off = 4;
  for (const e of entries) {
    view.setInt32(off, e.cx, true);
    view.setInt32(off + 4, e.cy, true);
    view.setInt32(off + 8, e.cz, true);
    view.setUint8(off + 12, e.removed ? 1 : 0);
    off += 13;
    if (!e.removed) {
      if (!e.cells || e.cells.length !== CELLS) throw new Error('A present chunk needs 4096 cells.');
      for (let i = 0; i < CELLS; i++) view.setUint16(off + i * 2, e.cells[i], true);
      off += CELLS * 2;
    }
  }
  return out;
}

export function decodeChunks(bytes: Uint8Array): ChunkRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 4) throw new Error('Chunk payload is truncated.');
  const count = view.getUint32(0, true);
  const out: ChunkRecord[] = [];
  let off = 4;
  for (let n = 0; n < count; n++) {
    if (off + 13 > bytes.byteLength) throw new Error('Chunk payload is truncated.');
    const cx = view.getInt32(off, true);
    const cy = view.getInt32(off + 4, true);
    const cz = view.getInt32(off + 8, true);
    const removed = view.getUint8(off + 12) === 1;
    off += 13;
    if (removed) {
      out.push({ cx, cy, cz, removed });
      continue;
    }
    if (off + CELLS * 2 > bytes.byteLength) throw new Error('Chunk payload is truncated.');
    const cells = new Uint16Array(CELLS);
    for (let i = 0; i < CELLS; i++) cells[i] = view.getUint16(off + i * 2, true);
    off += CELLS * 2;
    out.push({ cx, cy, cz, removed, cells });
  }
  return out;
}
