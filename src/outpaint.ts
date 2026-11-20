import { PNG } from 'pngjs'
import { resizePixels } from './pixels.js'
import type { Pixels } from './pixels.js'
import { modelEditDimensions } from './shared/image-edit.js'
import type { ExpandMargins } from './shared/image-edit.js'
import type { ImageRequest } from './ai4scholar.js'

export type ExpansionSide = keyof ExpandMargins
export interface ExpansionContext { side: ExpansionSide; amount: number; source: Pixels }
interface Transform { sx: number; sy: number; dx: number; dy: number }
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const horizontal = (side: ExpansionSide) => side === 'left' || side === 'right'

/** Only one paid output. Multi-sided requests retain the existing full-canvas path. */
export function expansionContext(source: Pixels, margins: ExpandMargins): ExpansionContext | undefined {
  const sides = (Object.keys(margins) as ExpansionSide[]).filter(side => margins[side] > 0)
  if (sides.length !== 1) return undefined
  const side = sides[0]!, amount = margins[side], h = horizontal(side)
  const axis = h ? source.width : source.height, cross = h ? source.height : source.width
  // Enough overlap to match geometry, without showing the whole infographic to the model.
  // Panoramas need a deeper context to stay within the model's 1:16 input limit.
  const depth = Math.min(axis, Math.max(Math.ceil(cross / 16), 64, Math.min(Math.ceil(axis / 2), Math.ceil(amount * 2.5))))
  const width = h ? depth : source.width, height = h ? source.height : depth
  const x = side === 'right' ? source.width - depth : 0, y = side === 'bottom' ? source.height - depth : 0
  const data = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row++) data.set(source.data.subarray(((row + y) * source.width + x) * 4, ((row + y) * source.width + x + width) * 4), row * width * 4)
  return { side, amount, source: { width, height, data } }
}

export function expansionRequest(context: ExpansionContext, watermark: boolean, notes: string): ImageRequest {
  const { source, amount, side } = context, h = horizontal(side)
  const target = modelEditDimensions(source.width + (h ? amount : 0), source.height + (h ? 0 : amount))
  const referenceSize = modelEditDimensions(source.width, source.height), reference = resizePixels(source, referenceSize.width, referenceSize.height)
  const data = new Uint8Array(reference.data)
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]! / 255
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c]! * alpha + 255 * (1 - alpha))
    data[i + 3] = 255
  }
  const direction = { left: '左', right: '右', top: '上', bottom: '下' }[side]
  const opposite = { left: '右', right: '左', top: '下', bottom: '上' }[side]
  const ratio = (100 * amount / (h ? source.width : source.height)).toFixed(1)
  const png = PNG.sync.write({ ...reference, data: Buffer.from(data) } as PNG, { colorType: 2 })
  return {
    images: [`data:image/png;base64,${png.toString('base64')}`], size: `${target.width}x${target.height}`, watermark, background: 'opaque',
    prompt: `仅向${direction}扩展这张图片，新增区域${h ? '宽度' : '高度'}为原图${h ? '宽度' : '高度'}的 ${ratio}%。保留原图在${opposite}侧，顺着${direction}边界自然延续场景、线条、纹理和光照，形成一张连贯的完整画面。原图内容保持原比例和布局，不要扩展其他方向。新增区域不添加文字、边框、镜像或重复主体；遇到纯色面板只延续无字底色。不要画中画、拼贴或嵌套图片。${notes}`,
  }
}

function sample(image: Pixels, x: number, y: number, channel: number): number {
  x = clamp(x, 0, image.width - 1); y = clamp(y, 0, image.height - 1)
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, image.width - 1), y1 = Math.min(y0 + 1, image.height - 1), fx = x - x0, fy = y - y0
  return image.data[(y0 * image.width + x0) * 4 + channel]! * (1 - fx) * (1 - fy) + image.data[(y0 * image.width + x1) * 4 + channel]! * fx * (1 - fy)
    + image.data[(y1 * image.width + x0) * 4 + channel]! * (1 - fx) * fy + image.data[(y1 * image.width + x1) * 4 + channel]! * fx * fy
}

/** Fit only small translation/scale changes. An unrelated or ambiguous output is not warped. */
export function alignExpansion(source: Pixels, generated: Pixels, left: number, top: number): { image: Pixels; aligned: boolean } {
  const ratio = Math.min(1, 320 / Math.max(generated.width, generated.height))
  const g = resizePixels(generated, Math.max(1, Math.round(generated.width * ratio)), Math.max(1, Math.round(generated.height * ratio)))
  const rx = g.width / generated.width, ry = g.height / generated.height
  const s = resizePixels(source, Math.max(1, Math.round(source.width * rx)), Math.max(1, Math.round(source.height * ry)))
  const cx = (left + source.width / 2) * rx - 0.5, cy = (top + source.height / 2) * ry - 0.5
  const points: number[][] = []
  for (let y = 1; y < s.height - 1; y += Math.max(2, Math.floor(s.height / 32))) for (let x = 1; x < s.width - 1; x += Math.max(2, Math.floor(s.width / 28))) {
    const i = (y * s.width + x) * 4
    if (s.data[i + 3]! < 240) continue
    points.push([(x + 0.5) * source.width * rx / s.width - source.width * rx / 2, (y + 0.5) * source.height * ry / s.height - source.height * ry / 2, s.data[i]!, s.data[i + 1]!, s.data[i + 2]!])
  }
  if (points.length < 64) return { image: generated, aligned: false }
  const score = (a: Transform) => {
    let sum = 0
    for (const [x, y, r, green, b] of points) {
      const gx = cx + x! * a.sx + a.dx, gy = cy + y! * a.sy + a.dy
      if (gx < 0 || gx > g.width - 1 || gy < 0 || gy > g.height - 1) return 255
      const i = (Math.round(gy) * g.width + Math.round(gx)) * 4
      sum += Math.min(100, (Math.abs(r! - g.data[i]!) + Math.abs(green! - g.data[i + 1]!) + Math.abs(b! - g.data[i + 2]!)) / 3)
    }
    return sum / points.length
  }
  let best: Transform = { sx: 1, sy: 1, dx: 0, dy: 0 }, error = score(best)
  const identity = error
  if (identity < 4) return { image: generated, aligned: false }
  const consider = (a: Transform) => { const e = score(a); if (e < error) { error = e; best = a } }
  for (let scale = 0.8; scale <= 1.201; scale += 0.04) for (let dx = -0.12 * s.width; dx <= 0.12 * s.width; dx += 3) for (let dy = -0.08 * s.height; dy <= 0.08 * s.height; dy += 3) consider({ sx: scale, sy: scale, dx, dy })
  for (const [ds, dt] of [[0.02, 1], [0.006, 0.5], [0.002, 0.25]] as const) for (let pass = 0; pass < 2; pass++) {
    const seed = { ...best }
    for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) consider({ sx: seed.sx + x * ds, sy: seed.sy + y * ds, dx: seed.dx + dx * dt, dy: seed.dy + dy * dt })
  }
  if (error > 20 || error > identity * 0.8) return { image: generated, aligned: false }
  const a = { ...best, dx: best.dx / rx, dy: best.dy / ry }
  const maps: Float64Array[] = []
  for (const [start, length, total, scale, shift] of [[left, source.width, generated.width, a.sx, a.dx], [top, source.height, generated.height, a.sy, a.dy]]) {
    const end = start! + length! - 1, center = start! + (length! - 1) / 2, first = center + (start! - center) * scale! + shift!, last = center + (end - center) * scale! + shift!
    if (first < -0.5 || last > total! - 0.5 || last <= first) return { image: generated, aligned: false }
    maps.push(Float64Array.from({ length: total! }, (_, p) => p < start! ? p * first / start! : p > end ? last + (p - end) * (total! - 1 - last) / (total! - 1 - end) : center + (p - center) * scale! + shift!))
  }
  const data = new Uint8Array(generated.data.length)
  for (let y = 0; y < generated.height; y++) for (let x = 0; x < generated.width; x++) for (let c = 0; c < 4; c++) data[(y * generated.width + x) * 4 + c] = Math.round(sample(generated, maps[0]![x]!, maps[1]![y]!, c))
  return { image: { ...generated, data }, aligned: true }
}

function edgeError(context: ExpansionContext, generated: Pixels): number {
  const { source, side, amount } = context, h = horizontal(side), depth = Math.min(32, h ? source.width : source.height)
  const cross = h ? source.height : source.width, left = side === 'left' ? amount : 0, top = side === 'top' ? amount : 0
  let sum = 0, count = 0
  for (let p = 0; p < cross; p += Math.max(1, Math.floor(cross / 128))) for (let d = 0; d < depth; d += 4) {
    const x = h ? side === 'left' ? d : source.width - 1 - d : p, y = h ? p : side === 'top' ? d : source.height - 1 - d
    const i = (y * source.width + x) * 4, j = ((y + top) * generated.width + x + left) * 4
    if (source.data[i + 3]! < 240 || generated.data[j + 3]! < 240) continue
    for (let c = 0; c < 3; c++) sum += Math.abs(source.data[i + c]! - generated.data[j + c]!)
    count += 3
  }
  return count ? sum / count : Infinity
}

/** Correct a narrow exterior band only after the overlap matches. Never soften the source. */
function joinEdge(context: ExpansionContext, generated: Pixels): Pixels {
  const { source, side, amount } = context, h = horizontal(side), cross = h ? source.height : source.width
  const band = Math.min(amount, 48), data = new Uint8Array(generated.data), residual = new Float32Array(cross * 3)
  for (let p = 0; p < cross; p++) {
    const x = h ? side === 'left' ? 0 : source.width - 1 : p, y = h ? p : side === 'top' ? 0 : source.height - 1
    const gx = x + (side === 'left' ? amount - 1 : side === 'right' ? 1 : 0), gy = y + (side === 'top' ? amount - 1 : side === 'bottom' ? 1 : 0)
    const i = (y * source.width + x) * 4, j = (gy * generated.width + gx) * 4
    if (source.data[i + 3]! < 240) continue
    for (let c = 0; c < 3; c++) residual[p * 3 + c] = source.data[i + c]! - generated.data[j + c]!
  }
  for (let d = 1; d <= band; d++) {
    const radius = Math.floor((d - 1) / 2), fade = (1 - (d - 1) / band) ** 2, sums = [0, 0, 0]
    for (let p = -radius; p <= radius; p++) for (let c = 0; c < 3; c++) sums[c]! += residual[clamp(p, 0, cross - 1) * 3 + c]!
    for (let p = 0; p < cross; p++) {
      const x = h ? side === 'left' ? amount - d : source.width - 1 + d : p, y = h ? p : side === 'top' ? amount - d : source.height - 1 + d
      const i = (y * generated.width + x) * 4
      for (let c = 0; c < 3; c++) {
        data[i + c] = clamp(Math.round(generated.data[i + c]! + sums[c]! / (2 * radius + 1) * fade), 0, 255)
        sums[c]! += residual[clamp(p + radius + 1, 0, cross - 1) * 3 + c]! - residual[clamp(p - radius, 0, cross - 1) * 3 + c]!
      }
    }
  }
  return { ...generated, data }
}

/**
 * The model sometimes paints a frame: a straight edge parallel to the seam, a few pixels into the
 * new area, while reproducing the overlap faithfully. Return the largest share of positions
 * along the seam that step in the same direction at one depth; scenery rarely does this.
 */
export function frameLine(context: ExpansionContext, image: Pixels): number {
  const { source, side, amount } = context, h = horizontal(side), cross = h ? source.height : source.width
  const lum = (x: number, y: number) => { const i = (y * image.width + x) * 4; return 0.299 * image.data[i]! + 0.587 * image.data[i + 1]! + 0.114 * image.data[i + 2]! }
  const at = (p: number, d: number): [number, number] => h ? [side === 'left' ? amount - d : source.width - 1 + d, p] : [p, side === 'top' ? amount - d : source.height - 1 + d]
  let worst = 0
  for (let d = 1; d + 2 <= Math.min(amount, 64); d++) {
    let up = 0, down = 0, total = 0
    for (let p = 0; p < cross; p += 2) {
      const diff = lum(...at(p, d + 2)) - lum(...at(p, d))
      if (diff > 8) up++; else if (diff < -8) down++
      total++
    }
    worst = Math.max(worst, Math.max(up, down) / total)
  }
  return worst
}

export function finishExpansionContext(context: ExpansionContext, raw: Pixels): { image: Pixels; warnings: string[]; edgeError: number; aligned: boolean } {
  const { source, side, amount } = context, h = horizontal(side), width = source.width + (h ? amount : 0), height = source.height + (h ? 0 : amount)
  const generated = resizePixels(raw, width, height), before = edgeError(context, generated)
  const fitted = alignExpansion(source, generated, side === 'left' ? amount : 0, side === 'top' ? amount : 0)
  const after = edgeError(context, fitted.image), chosen = after < before ? fitted.image : generated, mismatch = Math.min(before, after)
  const warnings: string[] = []
  if (mismatch > 20) warnings.push('扩图需检查：新增区域与原图边缘仍有结构偏差。原图像素已完整保留，结果另存，不自动替换图层。')
  if (Math.abs(Math.log((raw.width / raw.height) / (width / height))) > 0.03) warnings.push('扩图需检查：模型返回的宽高比偏离请求，新增区域可能变形。')
  if (frameLine(context, chosen) > 0.6) warnings.push('扩图需检查：新增区域靠近原图边缘处有一条与边缘平行的直线，可能是模型画出的边框或色块分界。原图像素已完整保留，结果另存，不自动替换图层。')
  let transparent = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const added = side === 'left' ? x < amount : side === 'right' ? x >= source.width : side === 'top' ? y < amount : y >= source.height
    if (added && chosen.data[(y * width + x) * 4 + 3]! < 250) transparent++
  }
  if (transparent) warnings.push('扩图需检查：模型未完整填充新增区域，仍存在透明像素。')
  return { image: mismatch <= 20 ? joinEdge(context, chosen) : chosen, warnings, edgeError: mismatch, aligned: chosen === fitted.image && fitted.aligned }
}
