/** Minimal PNG header with the given IHDR dimensions. */
export function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(33), v = new DataView(b.buffer)
  v.setUint32(0, 0x89504e47); v.setUint32(4, 0x0d0a1a0a); v.setUint32(8, 13); v.setUint32(12, 0x49484452); v.setUint32(16, width); v.setUint32(20, height)
  return b
}
