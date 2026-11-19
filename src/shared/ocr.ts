import { isRecord, ITEM_ID } from './types.js'
import type { CanvasItem, CanvasLayer, OCRLine, OCRText, TextRun } from './types.js'

export const MAX_OCR_LINES = 200
export const MAX_OCR_RUNS = 100
export const MAX_OCR_TEXT = 10000
const bools = ['bold', 'italic', 'underline', 'strikethrough', 'shadow', 'translucent'] as const
const validNumber = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const string = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
const color = (v: unknown): v is string => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v)
const font = (v: unknown) => typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'unknown'
  ? v.replace(/[^\p{L}\p{N} _.&-]/gu, '').trim().slice(0, 100) || 'Arial' : 'Arial'
const box = (v: unknown): [number, number, number, number] | undefined =>
  Array.isArray(v) && v.length === 4 && v.every(n => validNumber(n, -1e7, 1e7)) && v[2]! > v[0]! && v[3]! > v[1]! ? v as [number, number, number, number] : undefined
const bounds = (raw: unknown, width: number, height: number) => {
  if (!isRecord(raw)) return undefined
  const absolute = box(raw.absolute)
  if (absolute) return absolute
  const normalized = box(raw.normalized)
  return normalized?.map((n, i) => n * (i % 2 ? height : width) / 1000) as [number, number, number, number] | undefined
}
export const ocrPlainText = (ocr: OCRText): string => ocr.lines.map(l => l.runs.map(r => r.text).join('')).join('\n')

/** Read the documented Ark contract without inventing OCR for a raster that has none. */
export function readOCR(asset: CanvasItem | undefined, canvas: { width: number; height: number }): OCRText | undefined {
  const raw = asset?.layerMetadata?.textRecognition, source = box(asset?.layerMetadata?.bounds)
  if (!asset || !source || !isRecord(raw) || !Array.isArray(raw.lines) || !raw.lines.length || raw.lines.length > MAX_OCR_LINES) return undefined
  const width = source[2] - source[0], height = source[3] - source[1]
  if (width > 32000 || height > 32000) return undefined
  const lines: OCRLine[] = []
  for (const value of raw.lines) {
    if (!isRecord(value) || !Array.isArray(value.runs) || !value.runs.length || value.runs.length > MAX_OCR_RUNS) return undefined
    const b = bounds(value.bounding_box, canvas.width, canvas.height)
    // Invalid geometry must leave the original bitmap intact, never drop a line silently.
    if (!b || b[2] - b[0] > 32000 || b[3] - b[1] > 32000) return undefined
    const runs: TextRun[] = []
    for (const run of value.runs) {
      if (!isRecord(run) || !string(run.text, MAX_OCR_TEXT) || /[\r\n]/.test(run.text)) return undefined
      const s = isRecord(run.style) ? run.style : {}
      runs.push({ text: run.text, fontFamily: font(s.similar_font_family), fill: color(s.foreground_color) ? s.foreground_color : '#20242c',
        bold: s.bold === true, italic: s.italic === true, underline: s.underline === true, strikethrough: s.strikethrough === true, shadow: s.shadow === true, translucent: s.translucent === true })
    }
    const line: OCRLine = { x: b[0] - source[0], y: b[1] - source[1], width: b[2] - b[0], height: b[3] - b[1], fontSize: Math.max(1, Math.min(2000, (b[3] - b[1]) * 0.75)), runs }
    lines.push(line)
  }
  const result: OCRText = { sourceAssetId: asset.id, width, height, lines }
  const text = ocrPlainText(result)
  if (!text.trim() || text.length > MAX_OCR_TEXT) return undefined
  try { return parseOCR(result, new Set([asset.id])) } catch { return undefined }
}

/** Validate every editable text property and keep the original asset bound to this Session. */
export function parseOCR(raw: unknown, assets: ReadonlySet<string>): OCRText {
  const invalid = () => new Error('识别文字数据无效。')
  if (!isRecord(raw) || typeof raw.sourceAssetId !== 'string' || !ITEM_ID.test(raw.sourceAssetId) || !assets.has(raw.sourceAssetId)) throw new Error('文字原图只能引用当前对话的图片。')
  if (!validNumber(raw.width, 1, 32000) || !validNumber(raw.height, 1, 32000) || !Array.isArray(raw.lines) || !raw.lines.length || raw.lines.length > MAX_OCR_LINES) throw invalid()
  const lines = raw.lines.map((l): OCRLine => {
    if (!isRecord(l) || !validNumber(l.x, -32000, 32000) || !validNumber(l.y, -32000, 32000) || !validNumber(l.width, 1, 32000) || !validNumber(l.height, 1, 32000) || !validNumber(l.fontSize, 1, 2000) || !Array.isArray(l.runs) || !l.runs.length || l.runs.length > MAX_OCR_RUNS) throw invalid()
    const runs = l.runs.map((r): TextRun => {
      if (!isRecord(r) || !string(r.text, MAX_OCR_TEXT) || /[\r\n]/.test(r.text) || !string(r.fontFamily, 100) || !r.fontFamily.trim() || !color(r.fill) || bools.some(k => typeof r[k] !== 'boolean')) throw invalid()
      return { text: r.text, fontFamily: r.fontFamily, fill: r.fill, bold: r.bold as boolean, italic: r.italic as boolean, underline: r.underline as boolean, strikethrough: r.strikethrough as boolean, shadow: r.shadow as boolean, translucent: r.translucent as boolean }
    })
    return { x: l.x, y: l.y, width: l.width, height: l.height, fontSize: l.fontSize, runs }
  })
  const result = { sourceAssetId: raw.sourceAssetId, width: raw.width, height: raw.height, lines }
  if (ocrPlainText(result).length > MAX_OCR_TEXT) throw invalid()
  return result
}

/** Conversion preserves the existing layer's move, scale, rotation, opacity and stacking position. */
export function editableText(layer: CanvasLayer, ocr: OCRText): CanvasLayer {
  const { assetId: _asset, ...rest } = layer
  const first = ocr.lines[0]!.runs[0]!
  return { ...rest, kind: 'text', text: ocrPlainText(ocr), fontSize: 36, fontFamily: first.fontFamily, bold: first.bold, italic: first.italic, fill: first.fill, align: 'left', ocr }
}
export function originalTextImage(layer: CanvasLayer): CanvasLayer {
  if (!layer.ocr) return layer
  return { id: layer.id, kind: 'image', name: layer.name, assetId: layer.ocr.sourceAssetId, x: layer.x, y: layer.y, width: layer.width, height: layer.height, rotation: layer.rotation, opacity: layer.opacity, hidden: layer.hidden, locked: layer.locked }
}

/** Preserve style runs on either side of a text edit. Insertions inherit the adjacent run. */
export function replaceRunText(runs: TextRun[], next: string): TextRun[] {
  next = next.replace(/[\r\n]+/g, ' ').slice(0, MAX_OCR_TEXT)
  const previous = runs.map(r => r.text).join('')
  if (previous === next) return runs
  let start = 0, end = 0
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++
  while (end < previous.length - start && end < next.length - start && previous[previous.length - 1 - end] === next[next.length - 1 - end]) end++
  const slice = (from: number, to: number) => {
    let offset = 0
    return runs.flatMap(r => { const text = r.text.slice(Math.max(0, from - offset), Math.max(0, Math.min(r.text.length, to - offset))); offset += r.text.length; return text ? [{ ...r, text }] : [] })
  }
  let offset = 0
  const inherited = runs.find(r => { offset += r.text.length; return offset > start }) ?? runs.at(-1)!
  const inserted = next.slice(start, next.length - end)
  const result = [...slice(0, start), ...(inserted ? [{ ...inherited, text: inserted }] : []), ...slice(previous.length - end, previous.length)]
  const compact: TextRun[] = []
  for (const run of result) {
    const last = compact.at(-1)
    const { text: _a, ...a } = run, { text: _b, ...b } = last ?? run
    if (last && JSON.stringify(a) === JSON.stringify(b)) last.text += run.text
    else compact.push({ ...run })
  }
  return compact.length ? compact : [{ ...runs[0]!, text: '' }]
}
