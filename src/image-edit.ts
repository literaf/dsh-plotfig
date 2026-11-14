import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'
import { imageInfo } from './ark.js'
import type { ArkImage, ArkRequest } from './ark.js'
import { arkEditDimensions, editDimensions, MAX_EDIT_PIXELS } from './shared/image-edit.js'
import type { ImageEditInput } from './shared/image-edit.js'

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
const dataUrl = (image: Pixels) => `data:image/png;base64,${Buffer.from(encodePixels(image)).toString('base64')}`
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
export function eraseMask(input: ImageEditInput, source: Pixels): Uint8Array {
  const data = new Uint8Array(source.width * source.height)
  if (input.mask) {
    const mask = decodePixels(Buffer.from(input.mask.slice(input.mask.indexOf(',') + 1), 'base64'))
    if (mask.width !== source.width || mask.height !== source.height) throw new Error('消除蒙版尺寸必须与原图一致。')
    for (let p = 0; p < data.length; p++) data[p] = Math.round((mask.data[p * 4]! + mask.data[p * 4 + 1]! + mask.data[p * 4 + 2]!) / 3 * mask.data[p * 4 + 3]! / 255)
  } else for (const r of input.regions ?? []) {
    if (r.x + r.width > source.width || r.y + r.height > source.height) throw new Error('消除选区不能超出原图。')
    for (let y = r.y; y < r.y + r.height; y++) data.fill(255, y * source.width + r.x, y * source.width + r.x + r.width)
  }
  if (!data.some(v => v > 0)) throw new Error('请先涂抹或框选要消除的区域。')
  return data
}
export interface PreparedEdit { source: Pixels; input: ImageEditInput; request: ArkRequest; width: number; height: number; mask?: Uint8Array }
export function prepareImageEdit(input: ImageEditInput, bytes: Uint8Array): PreparedEdit {
  const source = decodePixels(bytes), target = editDimensions(source.width, source.height, input.expand), work = arkEditDimensions(target.width, target.height)
  const originalWork = arkEditDimensions(source.width, source.height), reference = resizePixels(source, originalWork.width, originalWork.height)
  const images = [dataUrl(reference)], notes = input.prompt ? `\n用户补充要求：${input.prompt}` : ''
  let prompt: string, mask: Uint8Array | undefined
  if (input.operation === 'remove-background') prompt = '去除参考图的背景，只保留主要前景主体。保留主体的原始位置、比例、颜色、文字和完整边缘，包括毛发、细小结构及半透明部分。输出与参考图相同构图的真正透明背景 RGBA PNG，空白区域必须透明，不要画棋盘格，不要增加背景、阴影或新物体。' + notes
  else if (input.operation === 'erase') {
    mask = eraseMask(input, source)
    const marked = { ...source, data: new Uint8Array(source.data) }
    for (let p = 0; p < mask.length; p++) { const a = mask[p]! / 255 * 0.65, i = p * 4; marked.data[i] = Math.round(source.data[i]! * (1 - a) + 255 * a); marked.data[i + 1] = Math.round(source.data[i + 1]! * (1 - a)); marked.data[i + 2] = Math.round(source.data[i + 2]! * (1 - a)); marked.data[i + 3] = Math.max(source.data[i + 3]!, Math.round(255 * a)) }
    images.push(dataUrl(resizePixels(marked, work.width, work.height)))
    prompt = '图1是未修改的原图，图2是在同一图片上用红色半透明涂抹标记的待消除区域。请仅移除这些标记区域内的目标物体，依据周围环境自然补全背景、纹理和光照。最终输出完整图片，不保留红色标记；其他位置、主体、文字、构图和尺寸比例保持图1不变。不要把图2的红色标记当作原有内容。' + notes
  } else {
    const m = input.expand!, guide: Pixels = { ...work, data: new Uint8Array(work.width * work.height * 4) }
    for (let i = 0; i < guide.data.length; i += 4) { guide.data[i] = 210; guide.data[i + 1] = 210; guide.data[i + 2] = 210; guide.data[i + 3] = 255 }
    const left = Math.round(m.left * work.width / target.width), top = Math.round(m.top * work.height / target.height)
    const right = Math.round((m.left + source.width) * work.width / target.width), bottom = Math.round((m.top + source.height) * work.height / target.height)
    const placed = resizePixels(source, Math.max(1, right - left), Math.max(1, bottom - top))
    for (let y = 0; y < placed.height; y++) guide.data.set(placed.data.subarray(y * placed.width * 4, (y + 1) * placed.width * 4), ((top + y) * work.width + left) * 4)
    images.push(dataUrl(guide))
    prompt = `图1是原始内容；图2展示扩展后的画幅与原图位置。请按图2的 ${work.width}×${work.height} 画幅，向原图四周的新增灰色区域自然延续场景，补全纹理、结构、透视及光照。原图在图2中的范围为左${left}、上${top}、右${right}、下${bottom}像素，该范围的内容和位置保持不变，不要放大、移动或重绘主体。灰色仅为新增范围的占位提示，最终不得保留灰色边框，不要镜像复制或拉伸边缘。` + notes
  }
  return { source, input, ...target, ...(mask ? { mask } : {}), request: { prompt, images, size: `${work.width}x${work.height}`, watermark: input.watermark, ...(input.operation === 'remove-background' ? { background: 'transparent' as const } : {}) } }
}
export function finishImageEdit(prepared: PreparedEdit, result: ArkImage): { image: ArkImage; warnings: string[] } {
  const { source, input, width, height } = prepared, generated = resizePixels(decodePixels(result.bytes), width, height)
  const data = new Uint8Array(generated.data), warnings: string[] = []
  if (input.operation === 'erase') {
    const mask = prepared.mask!
    for (let p = 0; p < mask.length; p++) {
      const a = mask[p]! / 255, i = p * 4
      if (!a) data.set(source.data.subarray(i, i + 4), i)
      else if (a < 1) {
        const oldA = source.data[i + 3]! * (1 - a), newA = data[i + 3]! * a, alpha = oldA + newA
        for (let c = 0; c < 3; c++) data[i + c] = alpha ? Math.round((source.data[i + c]! * oldA + data[i + c]! * newA) / alpha) : 0
        data[i + 3] = Math.round(alpha)
      }
    }
  } else if (input.operation === 'expand') {
    const m = input.expand!
    for (let y = 0; y < source.height; y++) data.set(source.data.subarray(y * source.width * 4, (y + 1) * source.width * 4), ((m.top + y) * width + m.left) * 4)
  } else if (!data.some((v, i) => i % 4 === 3 && v < 255)) warnings.push('模型未返回透明区域，已保存结果；请检查去背景效果。')
  const bytes = encodePixels({ width, height, data })
  if (bytes.length > 30 * 1024 * 1024) throw new Error('处理后的 PNG 超过 30 MB。')
  return { image: { bytes, width, height, mime: 'image/png' }, warnings }
}
