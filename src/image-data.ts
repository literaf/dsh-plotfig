import type { LayerMetadata } from './shared/types.js'

export const MAX_BYTES = 30 * 1024 * 1024
export interface GeneratedImage {
  bytes: Uint8Array
  width: number
  height: number
  mime: 'image/png' | 'image/jpeg'
  layer?: LayerMetadata
}

/** Width and height from a PNG or baseline/progressive JPEG header. */
export function imageInfo(bytes: Uint8Array): { width: number; height: number; mime: GeneratedImage['mime'] } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length > 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(12) === 0x49484452)
    return { width: view.getUint32(16), height: view.getUint32(20), mime: 'image/png' }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return undefined
      const marker = bytes[i + 1]!, length = view.getUint16(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { width: view.getUint16(i + 7), height: view.getUint16(i + 5), mime: 'image/jpeg' }
      i += 2 + length
    }
  }
  return undefined
}
