import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encodes 8-bit RGBA pixels (row-major, top row first) as a PNG. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) throw new Error('encodePng: pixel buffer size does not match the image size.');
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height); // filter type 0 for every row
  for (let y = 0; y < height; y++) {
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Decodes non-interlaced PNGs of bit depth 1-8 (gray, gray+alpha, RGB, RGBA, palette) to RGBA.
 * Enough for Minecraft textures and for reading our own output back.
 */
export function decodePng(png: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const buf = Buffer.from(png.buffer, png.byteOffset, png.length);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG file.');
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 8;
  let colorType = 0;
  let palette: Buffer | undefined;
  let trns: Buffer | undefined;
  const idat: Buffer[] = [];
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      if (![1, 2, 4, 8].includes(depth) || data[12] !== 0) throw new Error('Unsupported PNG (only non-interlaced, 1-8 bits per sample).');
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels) throw new Error(`Unsupported PNG color type ${colorType}.`);
  const raw = inflateSync(Buffer.concat(idat));
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3); // filter distance in bytes
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const lines = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? lines[dst + i - bpp] : 0;
      const b = y > 0 ? lines[dst - stride + i] : 0;
      const c = y > 0 && i >= bpp ? lines[dst - stride + i - bpp] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      lines[dst + i] = (raw[src + i] + predictor) & 0xff;
    }
  }
  const maxSample = (1 << depth) - 1;
  const sample = (y: number, index: number): number => {
    // index counts samples along the row (pixel * channels + channel)
    if (depth === 8) return lines[y * stride + index];
    const bit = index * depth;
    return (lines[y * stride + (bit >> 3)] >> (8 - depth - (bit & 7))) & maxSample;
  };
  const scale = (v: number) => (depth === 8 ? v : Math.round((v * 255) / maxSample));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s0 = x * channels;
      if (colorType === 6) {
        for (let c = 0; c < 4; c++) rgba[o + c] = scale(sample(y, s0 + c));
      } else if (colorType === 2) {
        for (let c = 0; c < 3; c++) rgba[o + c] = scale(sample(y, s0 + c));
        rgba[o + 3] = 255;
      } else if (colorType === 0) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = scale(sample(y, s0));
        rgba[o + 3] = 255;
      } else if (colorType === 4) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = scale(sample(y, s0));
        rgba[o + 3] = scale(sample(y, s0 + 1));
      } else {
        const idx = sample(y, s0);
        rgba[o] = palette?.[idx * 3] ?? 0;
        rgba[o + 1] = palette?.[idx * 3 + 1] ?? 0;
        rgba[o + 2] = palette?.[idx * 3 + 2] ?? 0;
        rgba[o + 3] = trns?.[idx] ?? 255;
      }
    }
  }
  return { width, height, rgba };
}
