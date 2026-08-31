/**
 * Encodes a non-negative integer as a VarInt: the same 7-bits-per-byte,
 * MSB-continuation-bit scheme used by Minecraft's protocol and by the
 * Sponge Schematic format's block/biome Data arrays.
 */
export function encodeVarInt(value: number): number[] {
  if (value < 0) {
    throw new Error(`encodeVarInt does not support negative values: ${value}`);
  }
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (remaining !== 0);
  return bytes;
}
