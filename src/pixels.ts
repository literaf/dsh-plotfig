import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'
import { imageInfo } from './image-data.js'
import { MAX_EDIT_PIXELS } from './shared/image-edit.js'

export interface Pixels { width: number; height: number; data: Uint8Array }
export function decodePixels(bytes: Uint8Array): Pixels {
  const info = imageInfo(bytes)
  if (!info || info.width < 1 || info.height < 1 || info.width * info.height > MAX_EDIT_PIXELS || info.width > 16000 || info.height > 16000) throw new Error('图片尺寸无效或超过 3200 万像素。')
  if (info.mime === 'image/png') {
    const png = PNG.sync.read(Buffer.from(bytes), { checkCRC: true })
    return { width: png.width, height: png.height, data: png.data }
  }
  const result = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 32, maxMemoryUsageInMB: 512 })
  return { width: result.width, height: result.height, data: result.data }
}
export function encodePixels(image: Pixels): Uint8Array {
  return PNG.sync.write({ ...image, data: Buffer.from(image.data) } as PNG, { colorType: 6 })
}
/** Bilinear interpolation in premultiplied alpha avoids dark fringes around cutouts. */
export function resizePixels(image: Pixels, width: number, height: number): Pixels {
  if (image.width === width && image.height === height) return image
  const data = new Uint8Array(width * height * 4), sx = image.width / width, sy = image.height / height
  for (let y = 0; y < height; y++) {
    const py = Math.max(0, Math.min(image.height - 1, (y + 0.5) * sy - 0.5)), y0 = Math.floor(py), y1 = Math.min(image.height - 1, y0 + 1), fy = py - y0
    for (let x = 0; x < width; x++) {
      const px = Math.max(0, Math.min(image.width - 1, (x + 0.5) * sx - 0.5)), x0 = Math.floor(px), x1 = Math.min(image.width - 1, x0 + 1), fx = px - x0
      const p0 = (y0 * image.width + x0) * 4, p1 = (y0 * image.width + x1) * 4, p2 = (y1 * image.width + x0) * 4, p3 = (y1 * image.width + x1) * 4
      const a0 = image.data[p0 + 3]! * (1 - fx) * (1 - fy), a1 = image.data[p1 + 3]! * fx * (1 - fy), a2 = image.data[p2 + 3]! * (1 - fx) * fy, a3 = image.data[p3 + 3]! * fx * fy
      const alpha = a0 + a1 + a2 + a3, out = (y * width + x) * 4
      for (let c = 0; c < 3; c++) data[out + c] = alpha ? Math.round((image.data[p0 + c]! * a0 + image.data[p1 + c]! * a1 + image.data[p2 + c]! * a2 + image.data[p3 + c]! * a3) / alpha) : 0
      data[out + 3] = Math.round(alpha)
    }
  }
  return { width, height, data }
}
