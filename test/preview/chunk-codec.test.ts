import { describe, expect, it } from 'vitest';
import { decodeChunks, encodeChunks } from '../../src/preview/chunk-codec.js';

describe('chunk codec', () => {
  it('round-trips present and removed chunks, including negative coordinates', () => {
    const cells = new Uint16Array(4096);
    cells[0] = 1;
    cells[4095] = 65535;
    const bytes = encodeChunks([
      { cx: -3, cy: 2, cz: 7, removed: false, cells },
      { cx: 1, cy: -1, cz: 0, removed: true }
    ]);
    const out = decodeChunks(bytes);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ cx: -3, cy: 2, cz: 7, removed: false });
    expect(out[0].cells?.[0]).toBe(1);
    expect(out[0].cells?.[4095]).toBe(65535);
    expect(out[1]).toMatchObject({ cx: 1, cy: -1, cz: 0, removed: true });
    expect(out[1].cells).toBeUndefined();
  });

  it('decodes from an unaligned view', () => {
    const cells = new Uint16Array(4096).fill(5);
    const bytes = encodeChunks([{ cx: 0, cy: 0, cz: 0, removed: false, cells }]);
    const shifted = new Uint8Array(bytes.length + 3);
    shifted.set(bytes, 3);
    expect(decodeChunks(shifted.subarray(3))[0].cells?.[100]).toBe(5);
  });

  it('rejects a truncated buffer', () => {
    const bytes = encodeChunks([{ cx: 0, cy: 0, cz: 0, removed: false, cells: new Uint16Array(4096) }]);
    expect(() => decodeChunks(bytes.subarray(0, 20))).toThrow();
  });
});
