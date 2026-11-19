import { isRecord, ITEM_ID, MAX_PROMPT } from './types.js'

export const IMAGE_EDIT_LABELS = { 'remove-background': '去背景', erase: '消除', expand: '扩图', enhance: '变清晰' } as const
export type ImageEditOperation = keyof typeof IMAGE_EDIT_LABELS
export interface ExpandMargins { left: number; top: number; right: number; bottom: number }
export interface EditRegion { x: number; y: number; width: number; height: number }
export interface ImageEditInput {
  operation: ImageEditOperation
  image: string
  requestId: string
  prompt: string
  watermark: boolean
  mask?: string
  regions?: EditRegion[]
  /** Inward-only erase edge transition, in original pixels. Zero disables it. */
  feather?: number
  expand?: ExpandMargins
}
export interface ImageEditReceipt {
  operation: ImageEditOperation
  sourceId: string
  requestId: string
  fingerprint: string
  /** False only when local processing failed and the paid, unprocessed result was rescued. */
  applied: boolean
  /** Local processing succeeded, but the returned model image needs visual review. */
  needsReview?: boolean
  expand?: ExpandMargins
}
export const MAX_EDIT_PIXELS = 32_000_000
export const MAX_MASK_BYTES = 30 * 1024 * 1024
export const PNG_DATA = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/
const integer = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && Number(value) >= min && Number(value) <= max
export function parseImageEdit(raw: unknown, watermark: boolean): ImageEditInput {
  if (!isRecord(raw) || !Object.hasOwn(IMAGE_EDIT_LABELS, String(raw.operation))) throw new Error('请选择去背景、消除、扩图或变清晰。')
  const operation = raw.operation as ImageEditOperation
  if (typeof raw.image !== 'string' || !raw.image.startsWith('item:') || !ITEM_ID.test(raw.image.slice(5))) throw new Error('只能编辑当前画布的 item:<id> 图片。')
  if (typeof raw.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(raw.requestId)) throw new Error('缺少有效的编辑请求标识。')
  const prompt = raw.prompt === undefined ? '' : raw.prompt
  if (typeof prompt !== 'string' || prompt.length > MAX_PROMPT) throw new Error(`补充要求最多 ${MAX_PROMPT} 个字符。`)
  if (raw.watermark !== undefined && typeof raw.watermark !== 'boolean') throw new Error('watermark 必须是布尔值。')
  const input: ImageEditInput = { operation, image: raw.image, requestId: raw.requestId, prompt: prompt.trim(), watermark: raw.watermark ?? watermark }
  if (operation === 'erase') {
    if (raw.feather !== undefined) {
      if (!integer(raw.feather, 0, 64)) throw new Error('消除边缘过渡须为 0–64 像素。')
      input.feather = raw.feather
    }
    if (raw.mask !== undefined && raw.regions !== undefined) throw new Error('涂抹蒙版与矩形选区只能选一种。')
    if (raw.mask !== undefined) {
      if (typeof raw.mask !== 'string' || raw.mask.length > Math.ceil(MAX_MASK_BYTES * 4 / 3) + 32 || !PNG_DATA.test(raw.mask)) throw new Error('消除蒙版须为不超过 30 MB 的 PNG。')
      input.mask = raw.mask
    } else {
      if (!Array.isArray(raw.regions) || !raw.regions.length || raw.regions.length > 64) throw new Error('请先涂抹或框选要消除的区域。')
      input.regions = raw.regions.map(r => {
        if (!isRecord(r) || !integer(r.x, 0, 16000) || !integer(r.y, 0, 16000) || !integer(r.width, 1, 16000) || !integer(r.height, 1, 16000)) throw new Error('消除区域须使用有效的原图像素坐标。')
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      })
    }
  } else if (raw.mask !== undefined || raw.regions !== undefined || raw.feather !== undefined) throw new Error('只有消除操作接受蒙版、选区或边缘过渡。')
  if (operation === 'expand') {
    if (!isRecord(raw.expand)) throw new Error('请设置扩图边距。')
    const m = raw.expand
    if (!(['left', 'top', 'right', 'bottom'] as const).every(k => integer(m[k], 0, 16000))) throw new Error('扩图边距须为 0–16000 的整数。')
    input.expand = { left: m.left as number, top: m.top as number, right: m.right as number, bottom: m.bottom as number }
    if (!Object.values(input.expand).some(v => v > 0)) throw new Error('至少扩展一条边。')
  } else if (raw.expand !== undefined) throw new Error('只有扩图操作接受边距。')
  return input
}
export function editDimensions(width: number, height: number, margins?: ExpandMargins) {
  const w = width + (margins?.left ?? 0) + (margins?.right ?? 0), h = height + (margins?.top ?? 0) + (margins?.bottom ?? 0)
  if (!integer(w, 15, 16000) || !integer(h, 15, 16000) || w * h > MAX_EDIT_PIXELS) throw new Error('编辑图片须在 3200 万像素以内，每边不超过 16000 像素。')
  if (w / h < 1 / 16 || w / h > 16) throw new Error('编辑结果宽高比须在 1:16 到 16:1 之间。')
  return { width: w, height: h }
}
export const EXPAND_SIDES = ['left', 'right', 'top', 'bottom'] as const
/** Multi-sided expansion runs one billed single-side pass per side, horizontal sides first. */
export function expansionSteps(margins: ExpandMargins): ExpandMargins[] {
  return EXPAND_SIDES.filter(side => margins[side] > 0).map(side => ({ left: 0, top: 0, right: 0, bottom: 0, [side]: margins[side] }))
}
export const MAX_ENHANCE_PIXELS = 4_624_220
/** Seedream 5.5 outputs at most ~4.62 MP, so enhancement must gain at least 1.25× per side. */
export function enhanceDimensions(width: number, height: number) {
  const scale = Math.min(4, Math.sqrt(MAX_ENHANCE_PIXELS / (width * height)))
  if (scale < 1.25) throw new Error('图片已接近模型最大输出分辨率（约 460 万像素），无法再变清晰。')
  let w = Math.round(width * scale), h = Math.round(height * scale)
  while (w * h > MAX_ENHANCE_PIXELS) { if (w / width >= h / height) w--; else h-- }
  if (w / h < 1 / 16 || w / h > 16) throw new Error('变清晰的图片宽高比须在 1:16 到 16:1 之间。')
  return { width: w, height: h }
}
/** Working resolution for the model; original-resolution pixels are restored after editing. */
export function arkEditDimensions(width: number, height: number) {
  const pixels = width * height, scale = Math.sqrt(Math.max(921600, Math.min(4_624_220, pixels)) / pixels)
  let w = Math.max(16, Math.round(width * scale)), h = Math.max(16, Math.round(height * scale))
  while (w * h > 4_624_220) { if (w >= h) w--; else h-- }
  while (w * h < 921600) { if (w <= h) w++; else h++ }
  // Rounding at the extreme aspect ratio must not cross the API boundary.
  if (w > 16 * h) h = Math.ceil(w / 16)
  if (h > 16 * w) w = Math.ceil(h / 16)
  while (w * h > 4_624_220) { w--; h-- }
  return { width: w, height: h }
}
/** Keep the original image at the same world coordinates when a transformed layer expands. */
export function expandedLayerBox(layer: { x: number; y: number; width: number; height: number; rotation: number }, source: { width: number; height: number }, margins: ExpandMargins) {
  const sx = layer.width / source.width, sy = layer.height / source.height, a = layer.rotation * Math.PI / 180
  const dx = margins.left * sx, dy = margins.top * sy
  return { x: layer.x - dx * Math.cos(a) + dy * Math.sin(a), y: layer.y - dx * Math.sin(a) - dy * Math.cos(a),
    width: layer.width + (margins.left + margins.right) * sx, height: layer.height + (margins.top + margins.bottom) * sy }
}
