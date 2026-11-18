import { isRecord, ITEM_ID, MAX_PROMPT, SIZE_TIERS } from './types.js'
import type { CanvasLayer, Composition, LayerKind, OCRText } from './types.js'
import { ocrPlainText, parseOCR } from './ocr.js'
import { isNode, updateConnectors } from './diagram.js'

export const LAYER_ID = /^[a-zA-Z0-9_-]{1,80}$/
export const MAX_LAYERS = 500
export interface DecomposeInput { image: string; prompt: string; maxImages: number; size: string; watermark: boolean }
export function parseDecompose(raw: unknown, watermark: boolean): DecomposeInput {
  if (!isRecord(raw) || typeof raw.image !== 'string' || !/^item:[a-f0-9]{12}$/.test(raw.image)) throw new Error('请选择当前画布上的一张图片。')
  const maxImages = raw.maxImages ?? raw.max_images ?? 30
  if (!Number.isInteger(maxImages) || (maxImages as number) < 2 || (maxImages as number) > 100) throw new Error('最多输出图片数须为 2–100（含底图）。')
  const size = raw.size ?? 'auto'
  if (typeof size !== 'string' || !['auto', ...SIZE_TIERS].includes(size)) throw new Error('分层尺寸须为 auto、1K、1.5K 或 2K。')
  const prompt = raw.prompt === undefined ? '将图片中的主要元素拆分为独立图层，保持原有位置、颜色和细节，补全移除元素后的底图。' : raw.prompt
  if (typeof prompt !== 'string' || prompt.length > MAX_PROMPT) throw new Error('分层说明过长或格式无效。')
  return { image: raw.image, prompt: prompt.trim(), maxImages: maxImages as number, size, watermark }
}
const num = (value: unknown, min: number, max: number, name: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name}无效。`)
  return value
}
const str = (value: unknown, max: number, name: string): string => {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name}无效。`)
  return value
}
const color = (v: unknown): string => {
  if (typeof v !== 'string' || !/^(#[a-fA-F0-9]{6}|transparent)$/.test(v)) throw new Error('颜色无效。')
  return v
}
/** Whitelist every persisted property; never accept paths, remote URLs or arbitrary Konva attributes. */
export function parseCompositionEdit(raw: unknown, assets: ReadonlySet<string>): Pick<Composition, 'title' | 'width' | 'height' | 'background' | 'layers'> {
  if (!isRecord(raw) || !Array.isArray(raw.layers) || raw.layers.length > MAX_LAYERS) throw new Error(`画板最多 ${MAX_LAYERS} 个图层。`)
  const ids = new Set<string>()
  const layers: CanvasLayer[] = raw.layers.map(value => {
    if (!isRecord(value) || typeof value.id !== 'string' || !LAYER_ID.test(value.id) || ids.has(value.id)) throw new Error('图层 ID 无效或重复。')
    ids.add(value.id)
    if (!['image', 'text', 'rect', 'ellipse', 'diamond', 'arrow'].includes(String(value.kind))) throw new Error('图层类型无效。')
    const kind = value.kind as LayerKind
    for (const k of ['hidden', 'locked']) if (typeof value[k] !== 'boolean') throw new Error('图层状态无效。')
    const layer: CanvasLayer = {
      id: value.id, kind, name: str(value.name, 200, '图层名'),
      x: num(value.x, -1e7, 1e7, '横坐标'), y: num(value.y, -1e7, 1e7, '纵坐标'),
      width: num(value.width, 1, 32000, '宽度'), height: num(value.height, 1, 32000, '高度'),
      rotation: num(value.rotation, -360, 360, '角度'), opacity: num(value.opacity, 0, 1, '透明度'),
      hidden: value.hidden as boolean, locked: value.locked as boolean,
    }
    if (kind === 'image') {
      if (typeof value.assetId !== 'string' || !ITEM_ID.test(value.assetId) || !assets.has(value.assetId)) throw new Error('图层只能引用当前对话的图片。')
      layer.assetId = value.assetId
    } else {
      layer.fill = color(value.fill)
      if (kind === 'text') {
        layer.text = str(value.text, 10000, '文字'); layer.fontSize = num(value.fontSize, 1, 2000, '字号')
        layer.fontFamily = str(value.fontFamily, 100, '字体')
        if (typeof value.bold !== 'boolean' || typeof value.italic !== 'boolean' || !['left', 'center', 'right'].includes(String(value.align))) throw new Error('文字样式无效。')
        layer.bold = value.bold; layer.italic = value.italic; layer.align = value.align as NonNullable<CanvasLayer['align']>
        if (value.ocr !== undefined) { layer.ocr = parseOCR(value.ocr, assets); layer.text = ocrPlainText(layer.ocr) }
      } else {
        layer.stroke = color(value.stroke); layer.strokeWidth = num(value.strokeWidth, 0, 1000, '描边')
        if (isNode(layer)) {
          if (value.cornerRadius !== undefined) layer.cornerRadius = num(value.cornerRadius, 0, 16000, '圆角')
          if (value.text !== undefined) {
            layer.text = str(value.text, 10000, '节点文字'); layer.textColor = color(value.textColor)
            layer.fontSize = num(value.fontSize, 1, 2000, '字号'); layer.fontFamily = str(value.fontFamily, 100, '字体')
            if (typeof value.bold !== 'boolean' || typeof value.italic !== 'boolean' || !['left', 'center', 'right'].includes(String(value.align))) throw new Error('节点文字样式无效。')
            layer.bold = value.bold; layer.italic = value.italic; layer.align = value.align as NonNullable<CanvasLayer['align']>
          }
        }
        if (kind === 'arrow') {
          if (!Array.isArray(value.points) || value.points.length < 4 || value.points.length > 64 || value.points.length % 2) throw new Error('箭头路径无效。')
          layer.points = value.points.map(p => num(p, 0, 1, '路径坐标'))
          if (value.routing !== undefined) {
            if (!['straight', 'horizontal', 'vertical'].includes(String(value.routing))) throw new Error('连线方式无效。')
            layer.routing = value.routing as NonNullable<CanvasLayer['routing']>
          }
          for (const key of ['startBinding', 'endBinding'] as const) if (value[key] !== undefined) {
            const b = value[key]
            if (!isRecord(b) || typeof b.layerId !== 'string' || !LAYER_ID.test(b.layerId) || !['top', 'right', 'bottom', 'left'].includes(String(b.side))) throw new Error('连线节点无效。')
            layer[key] = { layerId: b.layerId, side: b.side as 'top' | 'right' | 'bottom' | 'left' }
          }
        }
      }
    }
    return layer
  })
  return { title: str(raw.title, 200, '画板标题'), width: num(raw.width, 1, 16000, '画板宽度'), height: num(raw.height, 1, 16000, '画板高度'), background: color(raw.background), layers: updateConnectors(layers) }
}
export interface LayerBox { x: number; y: number; width: number; height: number }
/** Axis-aligned bounds after rotation, shared by selection, alignment and export. */
export function layerBounds(layer: LayerBox & { rotation?: number; ocr?: OCRText }): LayerBox {
  const a = (layer.rotation ?? 0) * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a)
  let left = 0, top = 0, right = layer.width, bottom = layer.height
  if (layer.ocr) for (const line of layer.ocr.lines) {
    const sx = layer.width / layer.ocr.width, sy = layer.height / layer.ocr.height, pad = line.runs.some(r => r.shadow) ? line.fontSize * 0.25 : 0
    left = Math.min(left, (line.x - pad) * sx); top = Math.min(top, (line.y - pad) * sy)
    right = Math.max(right, (line.x + line.width + pad) * sx); bottom = Math.max(bottom, (line.y + line.height + pad) * sy)
  }
  const p = [[left, top], [right, top], [right, bottom], [left, bottom]].map(([x, y]) => ({ x: layer.x + x! * cos - y! * sin, y: layer.y + x! * sin + y! * cos }))
  const x = Math.min(...p.map(v => v.x)), y = Math.min(...p.map(v => v.y))
  return { x, y, width: Math.max(...p.map(v => v.x)) - x, height: Math.max(...p.map(v => v.y)) - y }
}
export function layersBounds(layers: CanvasLayer[]): LayerBox | undefined {
  const boxes = layers.filter(l => !l.hidden).map(layerBounds)
  if (!boxes.length) return undefined
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y))
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y }
}
export function alignLayers(layers: CanvasLayer[], selected: ReadonlySet<string>, alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'grid'): CanvasLayer[] {
  const chosen = layers.filter(l => selected.has(l.id) && !l.locked && !l.hidden), box = layersBounds(chosen)
  if (!box || chosen.length < 2) return layers
  const columns = Math.ceil(Math.sqrt(chosen.length)), gap = 32
  const maxW = Math.max(...chosen.map(l => layerBounds(l).width)), maxH = Math.max(...chosen.map(l => layerBounds(l).height))
  const targets = new Map(chosen.map((l, i) => {
    const b = layerBounds(l); let dx = 0, dy = 0
    if (alignment === 'left') dx = box.x - b.x
    if (alignment === 'center') dx = box.x + box.width / 2 - b.x - b.width / 2
    if (alignment === 'right') dx = box.x + box.width - b.x - b.width
    if (alignment === 'top') dy = box.y - b.y
    if (alignment === 'middle') dy = box.y + box.height / 2 - b.y - b.height / 2
    if (alignment === 'bottom') dy = box.y + box.height - b.y - b.height
    if (alignment === 'grid') { dx = box.x + i % columns * (maxW + gap) - b.x; dy = box.y + Math.floor(i / columns) * (maxH + gap) - b.y }
    return [l.id, { ...l, x: l.x + dx, y: l.y + dy }] as const
  }))
  return layers.map(l => targets.get(l.id) ?? l)
}
