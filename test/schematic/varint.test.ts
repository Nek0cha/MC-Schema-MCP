import { describe, expect, it } from 'vitest';
import { encodeVarInt } from '../../src/schematic/varint.js';

describe('encodeVarInt', () => {
  it('encodes single-byte values unchanged', () => {
    expect(encodeVarInt(0)).toEqual([0]);
    expect(encodeVarInt(1)).toEqual([1]);
    expect(encodeVarInt(127)).toEqual([127]);
  });

  it('encodes multi-byte values with continuation bits', () => {
    expect(encodeVarInt(128)).toEqual([0x80, 0x01]);
    expect(encodeVarInt(300)).toEqual([0xac, 0x02]);
    expect(encodeVarInt(16384)).toEqual([0x80, 0x80, 0x01]);
  });

  it('rejects negative values', () => {
    expect(() => encodeVarInt(-1)).toThrow();
  });
});
