import type { ImageEditReceipt } from './image-edit.js'
import { parseGenerationStyle } from './research.js'
import type { GenerationStyle } from './research.js'

export const ROUTE = '/api/seedream'
export const PANEL = 'seedream'
export const TAB_KIND = 'seedream'
export const TAB_ID = 'dsh-seedream'
export const KEY_REF = 'ARK_API_KEY'
export const MODEL = 'doubao-seedream-5-5-261028'
export const SIZE_TIERS = ['1K', '1.5K', '2K'] as const
export type SizeTier = typeof SIZE_TIERS[number]
export const MAX_REFS = 10
export const MAX_PROMPT = 4000
/** Session identifiers are host-issued; only filesystem-safe shapes are accepted. */
export const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
export const ITEM_ID = /^[a-f0-9]{12}$/
/** Canvases created from the Seedream panel belong to no conversation; their ids carry this prefix. */
export const BOARD_PREFIX = 'board-'
export const isBoard = (id: string): boolean => id.startsWith(BOARD_PREFIX)
export interface GenerateInput {
  prompt: string
  /** `item:<id>` references on the same canvas, https URLs, or data URLs. */
  images: string[]
  size: string
  watermark: boolean
  title?: string
  /** Omitted inherits the canvas choice; auto leaves the prompt unchanged. */
  style?: GenerationStyle
  /** Native RGBA PNG output with a transparent background (Seedream 5.5). */
  transparent?: boolean
}
export interface CanvasItem {
  id: string
  title: string
  prompt: string
  width: number
  height: number
  x: number
  y: number
  /** Item ids on this canvas that were sent as reference images. */
  refs: string[]
  /** Number of external (non-canvas) reference images that were sent. */
  externalRefs: number
  size: string
  createdAt: string
  /** Decomposition assets are kept for editing and undo, not laid out as separate originals. */
  role?: 'layer'
  layerMetadata?: LayerMetadata
  edit?: ImageEditReceipt
  warnings?: string[]
  generationStyle?: GenerationStyle
  /** Generated with a requested transparent background. */
  transparent?: boolean
  imported?: boolean
}
export interface LayerMetadata {
  zIndex: number
  bounds?: [number, number, number, number]
  name?: string
  description?: string
  /** Raw OCR stays with the immutable image; editor text is a separate, approximate reconstruction. */
  textRecognition?: unknown
}
export interface Canvas {
  sessionId: string
  revision: number
  title?: string
  createdAt: string
  updatedAt: string
  items: CanvasItem[]
  compositions?: Composition[]
  /** Persisted per canvas; changing this does not generate or alter any image. */
  generationStyle?: GenerationStyle
}
export type LayerKind = 'image' | 'text' | 'rect' | 'ellipse' | 'diamond' | 'arrow'
export interface ConnectorBinding { layerId: string; side: 'top' | 'right' | 'bottom' | 'left' }
export interface TextRun {
  text: string
  fontFamily: string
  fill: string
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  shadow: boolean
  translucent: boolean
}
export interface OCRLine {
  /** Coordinates in the source layer's bounding-box space, not the PNG's pixel dimensions. */
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  runs: TextRun[]
}
export interface OCRText {
  /** Immutable raster retained for comparison and restoration. */
  sourceAssetId: string
  width: number
  height: number
  lines: OCRLine[]
}
export interface CanvasLayer {
  id: string
  kind: LayerKind
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  hidden: boolean
  locked: boolean
  assetId?: string
  text?: string
  fontSize?: number
  fontFamily?: string
  bold?: boolean
  italic?: boolean
  align?: 'left' | 'center' | 'right'
  fill?: string
  stroke?: string
  strokeWidth?: number
  cornerRadius?: number
  /** Labels belong to their shape; moving a node also moves its text. */
  textColor?: string
  /** Arrow vertices normalized to this layer's width and height. */
  points?: number[]
  startBinding?: ConnectorBinding
  endBinding?: ConnectorBinding
  routing?: 'straight' | 'horizontal' | 'vertical'
  ocr?: OCRText
}
/** Layer coordinates are relative to the artboard, and may extend beyond it. */
export interface Composition {
  id: string
  title: string
  sourceId: string
  x: number
  y: number
  width: number
  height: number
  background: string
  version: number
  layers: CanvasLayer[]
  warnings?: string[]
}
/** A generation still running on the host, whoever started it (conversation tool or canvas). */
export interface PendingGeneration { key: string; prompt: string; size: string; parentId?: string; startedAt: string }
export interface CanvasEntry {
  sessionId: string
  title: string
  count: number
  revision: number
  updatedAt: string
  cover?: string
  diagramCover?: string
}
export interface Status {
  version: string
  configured: boolean
  keyRef: string
  model: string
  defaultSize: string
  watermark: boolean
}
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
/** 0.1.0 builds titled images with the first 24 characters of the prompt; show those as a readable label instead. */
export const labelOf = (item: Pick<CanvasItem, 'title' | 'prompt'>): string =>
  item.title === item.prompt.replace(/\s+/g, ' ').slice(0, 24) ? titleFrom(item.prompt) : item.title
export const entryOf = (canvas: Canvas): CanvasEntry => {
  const originals = canvas.items.filter(i => i.role !== 'layer')
  const first = originals[0], last = originals.at(-1), diagram = canvas.compositions?.at(-1)
  const title = first && (canvas.title === undefined || canvas.title === first.title) ? labelOf(first) : canvas.title ?? '未命名画布'
  return { sessionId: canvas.sessionId, title, count: originals.length + (canvas.compositions?.length ?? 0), revision: canvas.revision, updatedAt: canvas.updatedAt, ...(last ? { cover: last.id } : diagram && diagram.layers.every(l => l.kind !== 'image' && !l.ocr) ? { diagramCover: diagram.id } : {}) }
}
/**
 * A short, readable label from a prompt: the first clause, cut at a word
 * boundary for Latin text. Used when neither the caller nor the model named it.
 */
export function titleFrom(prompt: string, max = 18): string {
  const text = prompt.replace(/\s+/g, ' ').trim()
  const clause = text.split(/[，。；！？,.;!?:：\n（(]/)[0]!.trim() || text
  const cjk = /[\u3400-\u9fff]/.test(clause)
  if (cjk) return clause.length > max ? clause.slice(0, max) + '…' : clause
  const limit = max * 2
  if (clause.length <= limit) return clause
  const cut = clause.slice(0, limit), space = cut.lastIndexOf(' ')
  return (space > limit / 2 ? cut.slice(0, space) : cut) + '…'
}
/** Aspect presets offered by the canvas; each maps to an exact WxH inside Ark's pixel bounds at 2K. */
export const RATIOS = [
  { id: '1:1', size: '2048x2048' }, { id: '4:3', size: '2304x1728' }, { id: '3:4', size: '1728x2304' },
  { id: '16:9', size: '2560x1440' }, { id: '9:16', size: '1440x2560' }, { id: '3:2', size: '2496x1664' }, { id: '2:3', size: '1664x2496' },
] as const
const PIXELS_MIN = 921_600, PIXELS_MAX = 4_624_220
/** Ark accepts a tier or WxH within the documented pixel and ratio bounds, never both. */
export function parseSize(value: unknown, fallback: string): string {
  const v = value === undefined || value === '' ? fallback : value
  if (typeof v !== 'string') throw new Error('size 必须是 1K、1.5K、2K 或 宽x高。')
  const text = v.trim().toUpperCase().replace('×', 'X')
  if ((SIZE_TIERS as readonly string[]).includes(text)) return text
  const m = /^(\d{2,5})X(\d{2,5})$/.exec(text)
  if (!m) throw new Error('size 必须是 1K、1.5K、2K 或 宽x高，例如 2048x2048。')
  const w = Number(m[1]), h = Number(m[2]), pixels = w * h, ratio = w / h
  if (pixels < PIXELS_MIN || pixels > PIXELS_MAX) throw new Error(`size 总像素需在 ${PIXELS_MIN} 到 ${PIXELS_MAX} 之间（当前 ${pixels}）。`)
  if (ratio < 1 / 16 || ratio > 16) throw new Error('size 宽高比需在 1:16 到 16:1 之间。')
  return `${w}x${h}`
}
export function parseGenerate(raw: unknown, defaults: { size: string; watermark: boolean }): GenerateInput {
  if (!isRecord(raw)) throw new Error('无效的生成参数。')
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : ''
  if (!prompt) throw new Error('请填写提示词。')
  if (prompt.length > MAX_PROMPT) throw new Error(`提示词不能超过 ${MAX_PROMPT} 个字符。`)
  const images = raw.images === undefined ? [] : raw.images
  if (!Array.isArray(images) || images.some(x => typeof x !== 'string' || !x.trim())) throw new Error('images 必须是字符串数组。')
  if (images.length > MAX_REFS) throw new Error(`参考图最多 ${MAX_REFS} 张。`)
  if (raw.watermark !== undefined && typeof raw.watermark !== 'boolean') throw new Error('watermark 必须是布尔值。')
  if (raw.transparent !== undefined && typeof raw.transparent !== 'boolean') throw new Error('transparent 必须是布尔值。')
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 80) : undefined
  return { prompt, images: (images as string[]).map(x => x.trim()), size: parseSize(raw.size, defaults.size), watermark: raw.watermark ?? defaults.watermark, ...(title ? { title } : {}), ...(raw.transparent ? { transparent: true } : {}), ...(raw.style === undefined ? {} : { style: parseGenerationStyle(raw.style) }) }
}
