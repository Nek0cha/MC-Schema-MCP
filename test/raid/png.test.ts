import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, encodePng } from '../../src/raid/png.js';

describe('png', () => {
  it('writes a valid signature, IHDR and chunk CRCs', () => {
    const rgba = new Uint8Array(3 * 2 * 4).fill(255);
    const png = encodePng(3, 2, rgba);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    let pos = 8;
    const types: string[] = [];
    while (pos < png.length) {
      const len = png.readUInt32BE(pos);
      const type = png.toString('ascii', pos + 4, pos + 8);
      const data = png.subarray(pos + 8, pos + 8 + len);
      expect(png.readUInt32BE(pos + 8 + len)).toBe(crc32(Buffer.concat([Buffer.from(type), data])) >>> 0);
      if (type === 'IHDR') {
        expect(data.readUInt32BE(0)).toBe(3);
        expect(data.readUInt32BE(4)).toBe(2);
        expect(data[8]).toBe(8);
        expect(data[9]).toBe(6);
      }
      types.push(type);
      pos += 12 + len;
    }
    expect(types[0]).toBe('IHDR');
    expect(types[types.length - 1]).toBe('IEND');
    expect(types).toContain('IDAT');
  });

  it('round-trips pixels through decodePng', () => {
    const rgba = Uint8Array.from([1, 2, 3, 255, 10, 20, 30, 128, 200, 100, 50, 0, 7, 8, 9, 255]);
    const out = decodePng(encodePng(2, 2, rgba));
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect([...out.rgba]).toEqual([...rgba]);
  });

  it('decodes low bit depth palette images (as used by many Minecraft textures)', () => {
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type), data]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(body) >>> 0);
      return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(3, 0); // width 3, height 2
    ihdr.writeUInt32BE(2, 4);
    ihdr[8] = 4; // 4 bits per pixel
    ihdr[9] = 3; // palette
    const plte = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    // rows: filter 0, then 3 pixels packed in 2 bytes: [0,1,2] and [2,1,0]
    const raw = Buffer.from([0, 0x01, 0x20, 0, 0x21, 0x00]);
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('PLTE', plte),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0))
    ]);
    const out = decodePng(png);
    expect([...out.rgba]).toEqual([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
      0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255
    ]);
  });
});
