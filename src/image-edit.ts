import { decodePixels, encodePixels, resizePixels } from './pixels.js'
import type { Pixels } from './pixels.js'
export { decodePixels, encodePixels, resizePixels } from './pixels.js'
export type { Pixels } from './pixels.js'
import type { ArkImage, ArkRequest } from './ark.js'
import { arkEditDimensions, editDimensions, enhanceDimensions } from './shared/image-edit.js'
import type { ImageEditInput } from './shared/image-edit.js'
import { expansionContext, expansionRequest, finishExpansionContext } from './outpaint.js'
import type { ExpansionContext } from './outpaint.js'

const dataUrl = (image: Pixels) => `data:image/png;base64,${Buffer.from(encodePixels(image)).toString('base64')}`
const hasAlpha = (image: Pixels) => image.data.some((v, i) => i % 4 === 3 && v < 250)
/**
 * Compare at the original resolution: an upscale must reduce to the source. Content drift
 * (redrawn text, moved parts) is flagged, never silently accepted. Transparency follows the source.
 */
export function finishEnhance(source: Pixels, generated: Pixels): { image: ArkImage; warnings: string[] } {
  const reduced = resizePixels(generated, source.width, source.height), warnings: string[] = []
  let difference = 0, samples = 0, worst = 0
  // Cells near glyph size: a rewritten word changes a few small cells, which larger cells average away.
  const cell = Math.max(6, Math.round(Math.min(source.width, source.height) / 80)), cells = new Map<number, number[]>()
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const i = (y * source.width + x) * 4
    if (source.data[i + 3]! < 240) continue
    let d = 0
    for (let c = 0; c < 3; c++) d += Math.abs(source.data[i + c]! - reduced.data[i + c]!)
    difference += d / 3; samples++
    const key = Math.floor(y / cell) * 10_000 + Math.floor(x / cell), sum = cells.get(key) ?? [0, 0]
    sum[0]! += d / 3; sum[1]!++; cells.set(key, sum)
  }
  for (const [sum, count] of cells.values()) if (count! >= cell * cell / 2) worst = Math.max(worst, sum! / count!)
  // Real tests show the model can rewrite small words while the overall difference stays low,
  // so every result is held for review; strong local drift gets the more specific warning.
  warnings.push(samples && (difference / samples > 14 || worst > 30)
    ? '变清晰需检查：结果与原图存在局部差异，可能改写了文字、细节或位置。结果已另存，原图保留，不自动替换图层。'
    : '变清晰结果需核对：AI 可能改写小字或细节，请对照原图检查后再使用。结果已另存，原图保留，不自动替换图层。')
  const data = new Uint8Array(generated.data)
  if (hasAlpha(source)) {
    // Keep the source silhouette exactly; only sharpen colour inside it.
    const alpha = resizePixels({ ...source, data: Uint8Array.from(source.data, (v, i) => i % 4 === 3 ? v : 255) }, generated.width, generated.height)
    for (let i = 3; i < data.length; i += 4) data[i] = alpha.data[i]!
  } else for (let i = 3; i < data.length; i += 4) data[i] = 255
  const image = { width: generated.width, height: generated.height, data }, bytes = encodePixels(image)
  if (bytes.length > 30 * 1024 * 1024) throw new Error('处理后的 PNG 超过 30 MB。')
  return { image: { bytes, width: image.width, height: image.height, mime: 'image/png' }, warnings }
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
/** Feather inward only: no unselected pixel may be changed, including holes and canvas edges. */
export function featherEraseMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 1) return mask
  const distance = new Float32Array(mask.length)
  for (let p = 0; p < mask.length; p++) distance[p] = mask[p] ? radius : 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x
    if (x) distance[p] = Math.min(distance[p]!, distance[p - 1]! + 1)
    if (y) distance[p] = Math.min(distance[p]!, distance[p - width]! + 1)
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const p = y * width + x
    if (x + 1 < width) distance[p] = Math.min(distance[p]!, distance[p + 1]! + 1)
    if (y + 1 < height) distance[p] = Math.min(distance[p]!, distance[p + width]! + 1)
  }
  return Uint8Array.from(mask, (alpha, p) => { const t = distance[p]! / radius; return Math.round(alpha * t * t * (3 - 2 * t)) })
}
/** Undo white-matte contamination only when a nearby opaque foreground explains it. */
export function refineCutoutEdges(image: Pixels): Pixels {
  const { width, height, data } = image, cleaned = new Uint8Array(data)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, alpha = data[i + 3]! / 255
    if (alpha === 0) { cleaned.fill(0, i, i + 3); continue }
    if (alpha < 0.05 || alpha > 0.95) continue
    let nearest = -1, best = 9
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const distance = dx * dx + dy * dy, nx = x + dx, ny = y + dy
      if (distance >= best || nx < 0 || nx >= width || ny < 0 || ny >= height) continue
      const j = (ny * width + nx) * 4
      if (data[j + 3]! >= 250) { nearest = j; best = distance }
    }
    if (nearest < 0) continue
    let error = 0, lightening = 0
    for (let c = 0; c < 3; c++) {
      error += Math.abs(data[i + c]! - (data[nearest + c]! * alpha + 255 * (1 - alpha)))
      lightening += data[i + c]! - data[nearest + c]!
    }
    if (error > 45 || lightening < 45) continue
    for (let c = 0; c < 3; c++) cleaned[i + c] = Math.round(Math.max(0, Math.min(255, (data[i + c]! - 255 * (1 - alpha)) / alpha)))
  }
  return { width, height, data: cleaned }
}
export interface PreparedEdit { source: Pixels; input: ImageEditInput; request: ArkRequest; width: number; height: number; mask?: Uint8Array; expansion?: ExpansionContext }
export function prepareImageEdit(input: ImageEditInput, bytes: Uint8Array): PreparedEdit {
  const source = decodePixels(bytes), notes = input.prompt ? `\n用户补充要求：${input.prompt}` : ''
  if (input.operation === 'enhance') {
    const target = enhanceDimensions(source.width, source.height)
    return { source, input, ...target, request: { images: [dataUrl(source)], size: `${target.width}x${target.height}`, watermark: input.watermark, background: hasAlpha(source) ? 'transparent' : 'opaque',
      prompt: '把这张图片高清化：提高分辨率与清晰度，锐化边缘、线条和文字笔画，去除模糊、噪点和压缩伪影。画面内容必须与原图完全一致：构图、位置、比例、颜色、形状、数量、文字内容与字形都保持不变，不添加、删除或重绘任何元素，不改变画风，不新增背景。' + notes } }
  }
  const target = editDimensions(source.width, source.height, input.expand)
  if (input.operation === 'expand') {
    const expansion = expansionContext(source, input.expand!)
    if (expansion) return { source, input, ...target, expansion, request: expansionRequest(expansion, input.watermark, notes) }
  }
  const work = arkEditDimensions(target.width, target.height), originalWork = arkEditDimensions(source.width, source.height)
  const reference = resizePixels(source, originalWork.width, originalWork.height), images = [dataUrl(reference)]
  let prompt: string, mask: Uint8Array | undefined
  if (input.operation === 'remove-background') prompt = '精确抠出参考图中的主要实体主体，去除背景。默认移除主体之外独立的标题、说明文字、引线、图表、装饰面板和地面投影；用户指定保留的对象优先。保留主体本身的原始位置、比例、颜色、印刷文字和完整边缘，包括毛发、细小结构及半透明部分。输出与参考图相同构图的真正透明背景 RGBA PNG。前景轮廓之间的空隙也须透明，去净白边、底色残留和游离杂点；不要画棋盘格，不要增加背景、阴影或新物体。' + notes
  else if (input.operation === 'erase') {
    mask = eraseMask(input, source)
    const marked = { ...source, data: new Uint8Array(source.data) }
    for (let p = 0; p < mask.length; p++) { const a = mask[p]! / 255 * 0.65, i = p * 4; marked.data[i] = Math.round(source.data[i]! * (1 - a) + 255 * a); marked.data[i + 1] = Math.round(source.data[i + 1]! * (1 - a)); marked.data[i + 2] = Math.round(source.data[i + 2]! * (1 - a)); marked.data[i + 3] = Math.max(source.data[i + 3]!, Math.round(255 * a)) }
    images.push(dataUrl(resizePixels(marked, work.width, work.height)))
    prompt = '图1是未修改的原图，图2是在同一图片上用红色半透明涂抹标记的待消除区域。请仅移除这些标记区域内的目标物体，依据周围环境自然补全背景、纹理和光照。最终输出完整图片，不保留红色标记；其他位置、主体、文字、构图和尺寸比例保持图1不变。不要把图2的红色标记当作原有内容。' + notes
  } else {
    const m = input.expand!, guide: Pixels = { ...work, data: new Uint8Array(work.width * work.height * 4) }
    const left = Math.round(m.left * work.width / target.width), top = Math.round(m.top * work.height / target.height)
    const right = Math.round((m.left + source.width) * work.width / target.width), bottom = Math.round((m.top + source.height) * work.height / target.height)
    const placed = resizePixels(source, Math.max(1, right - left), Math.max(1, bottom - top))
    for (let y = 0; y < placed.height; y++) guide.data.set(placed.data.subarray(y * placed.width * 4, (y + 1) * placed.width * 4), ((top + y) * work.width + left) * 4)
    // A second, unpadded image competes with the guide and changes scene scale.
    images.splice(0, images.length, dataUrl(guide))
    prompt = '将这张 PNG 四周的透明区域自然补全，输出一张完全不透明的完整图片。只画透明区域，已有画面的位置、大小、比例和内容都保持原样，从每条原图边缘连续地延伸场景、纹理与光线，接缝自然吻合。不要缩放或移动原图，不要生成画中画、嵌套图片或重复的主体。新增区域不添加文字、标签、图表、标尺或说明框；已有纸张和纯色面板的边缘只延续无字底色。' + notes
  }
  return { source, input, ...target, ...(mask ? { mask } : {}), request: { prompt, images, size: `${work.width}x${work.height}`, watermark: input.watermark, ...(input.operation === 'remove-background' ? { background: 'transparent' as const } : input.operation === 'expand' ? { background: 'opaque' as const } : {}) } }
}
export function finishImageEdit(prepared: PreparedEdit, result: ArkImage): { image: ArkImage; warnings: string[] } {
  if (prepared.expansion) {
    const { source, input, width, height, expansion } = prepared, margins = input.expand!
    const processed = finishExpansionContext(expansion, decodePixels(result.bytes)), tile = processed.image
    const data = new Uint8Array(width * height * 4), side = expansion.side, amount = expansion.amount
    if (side === 'left' || side === 'right') {
      const fromX = side === 'left' ? 0 : expansion.source.width, toX = side === 'left' ? 0 : source.width
      for (let y = 0; y < height; y++) data.set(tile.data.subarray((y * tile.width + fromX) * 4, (y * tile.width + fromX + amount) * 4), (y * width + toX) * 4)
    } else {
      const fromY = side === 'top' ? 0 : expansion.source.height, toY = side === 'top' ? 0 : source.height
      for (let y = 0; y < amount; y++) data.set(tile.data.subarray((y + fromY) * width * 4, (y + fromY + 1) * width * 4), (y + toY) * width * 4)
    }
    for (let y = 0; y < source.height; y++) data.set(source.data.subarray(y * source.width * 4, (y + 1) * source.width * 4), ((y + margins.top) * width + margins.left) * 4)
    const bytes = encodePixels({ width, height, data })
    if (bytes.length > 30 * 1024 * 1024) throw new Error('处理后的 PNG 超过 30 MB。')
    return { image: { bytes, width, height, mime: 'image/png' }, warnings: processed.warnings }
  }
  const { source, input, width, height } = prepared, generated = resizePixels(decodePixels(result.bytes), width, height)
  if (input.operation === 'enhance') return finishEnhance(source, generated)
  const data = new Uint8Array(input.operation === 'remove-background' ? refineCutoutEdges(generated).data : generated.data), warnings: string[] = []
  if (input.operation === 'erase') {
    const mask = featherEraseMask(prepared.mask!, width, height, input.feather ?? Math.min(24, Math.round(Math.min(width, height) * 0.008)))
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
    // Check the model's anchor area BEFORE restoring it. Large changes here predict
    // visible seams. This is a conservative review signal, not a quality certificate.
    let difference = 0, samples = 0
    const stepX = Math.max(1, Math.floor(source.width / 64)), stepY = Math.max(1, Math.floor(source.height / 64))
    for (let y = 0; y < source.height; y += stepY) for (let x = 0; x < source.width; x += stepX) {
      const i = (y * source.width + x) * 4, j = ((m.top + y) * width + m.left + x) * 4
      if (source.data[i + 3]! < 240) continue
      for (let c = 0; c < 3; c++) difference += Math.abs(source.data[i + c]! - generated.data[j + c]!)
      samples += 3
    }
    if (samples >= 96 && difference / samples > 32) warnings.push('扩图需检查：模型明显改变了参考区域，新增边缘可能错位或出现接缝。原图像素已完整恢复，结果已另存，未自动重试。')
    for (let y = 0; y < source.height; y++) data.set(source.data.subarray(y * source.width * 4, (y + 1) * source.width * 4), ((m.top + y) * width + m.left) * 4)
  } else if (!data.some((v, i) => i % 4 === 3 && v < 255)) warnings.push('模型未返回透明区域，已保存结果；请检查去背景效果。')
  const bytes = encodePixels({ width, height, data })
  if (bytes.length > 30 * 1024 * 1024) throw new Error('处理后的 PNG 超过 30 MB。')
  return { image: { bytes, width, height, mime: 'image/png' }, warnings }
}
