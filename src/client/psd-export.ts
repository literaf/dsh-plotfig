import { writePsdUint8Array } from 'ag-psd'
import type { Layer, LayerTextData, PixelData, Psd, RGB, TextStyle } from 'ag-psd'
import type { CanvasLayer, Composition, TextRun } from '../shared/types.js'
import { layerBounds } from '../shared/layers.js'
import type { LayerBox } from '../shared/layers.js'
import { ocrTextNodes } from './ocr-layout.js'
import type { TextMeasure } from './ocr-layout.js'
import { psdFontName, psdFontRuns } from './psd-fonts.js'
import { nodeLabel, renderLayersCanvas } from './layer-render.js'
import { isNode, nodeTextLayer } from '../shared/diagram.js'

export const MAX_PSD_PIXELS = 80_000_000
export type PsdRasterizer = (layers: CanvasLayer[], box: LayerBox, background: string) => Promise<PixelData>
const rgb = (color: string): RGB => ({ r: parseInt(color.slice(1, 3), 16), g: parseInt(color.slice(3, 5), 16), b: parseInt(color.slice(5, 7), 16) })
const textStyle = (run: Pick<TextRun, 'fontFamily' | 'fill' | 'bold' | 'italic'> & Partial<TextRun>, fontSize: number): TextStyle => ({
  font: { name: psdFontName(run.fontFamily, run.text) }, fontSize, fillColor: rgb(run.fill), fauxBold: run.bold, fauxItalic: run.italic,
  underline: run.underline ?? false, strikethrough: run.strikethrough ?? false, autoLeading: false, leading: fontSize * 1.2,
})
const integerBox = (b: LayerBox): LayerBox => ({ x: Math.floor(b.x), y: Math.floor(b.y), width: Math.max(1, Math.ceil(b.x + b.width) - Math.floor(b.x)), height: Math.max(1, Math.ceil(b.y + b.height) - Math.floor(b.y)) })
const paddedBox = (l: CanvasLayer) => {
  const b = layerBounds(l), pad = Math.ceil((l.strokeWidth ?? 0) / 2 * Math.SQRT2) + 2
  return integerBox({ x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad })
}
const transform = (l: CanvasLayer, sx = 1, sy = 1, x = 0, y = 0): number[] => {
  const a = l.rotation * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a)
  return [cos * sx, sin * sx, -sin * sy, cos * sy, l.x + x * sx * cos - y * sy * sin, l.y + x * sx * sin + y * sy * cos]
}
const nativeText = (l: CanvasLayer): LayerTextData => ({
  text: l.text ?? '', orientation: 'horizontal', shapeType: 'box', boxBounds: [0, 0, l.width, l.height], transform: transform(l),
  style: textStyle({ fontFamily: l.fontFamily ?? 'Arial', fill: l.fill ?? '#20242c', bold: l.bold ?? false, italic: l.italic ?? false }, l.fontSize ?? 36),
  styleRuns: psdFontRuns(l.text ?? '', l.fontFamily ?? 'Arial'),
  paragraphStyle: { justification: l.align ?? 'left' },
})

/** A genuine PSD: independent pixel layers, hidden layers, off-artboard content and native text records. */
export async function buildPsdDocument(composition: Composition, rasterize: PsdRasterizer, editableText = true, measure?: TextMeasure, progress?: (done: number, total: number) => void, labelLayout: (l: CanvasLayer) => CanvasLayer = nodeTextLayer): Promise<Psd> {
  if (composition.width > 16000 || composition.height > 16000 || composition.width * composition.height > 32_000_000) throw new Error('PSD 画板须在 3200 万像素以内，每边不超过 16000 像素。')
  let pixels = 0
  const render = async (layers: CanvasLayer[], box: LayerBox, background = 'transparent') => {
    const bounds = integerBox(box)
    pixels += bounds.width * bounds.height
    if (bounds.width > 16000 || bounds.height > 16000 || bounds.width * bounds.height > 32_000_000 || pixels > MAX_PSD_PIXELS) throw new Error('PSD 内容过大：图层累计最多 8000 万像素，请缩小画板或减少图层后导出。')
    const imageData = await rasterize(layers, bounds, background)
    if (imageData.width !== bounds.width || imageData.height !== bounds.height || imageData.data.length !== bounds.width * bounds.height * 4) throw new Error('PSD 图层尺寸与图像数据不一致。')
    return { left: bounds.x, top: bounds.y, imageData }
  }
  const children: Layer[] = [], frame = { x: 0, y: 0, width: composition.width, height: composition.height }
  // The writer serializes children in compositing order, bottom to top.
  // Keep canvas order: reversing it puts an opaque base above every other layer
  // in independent PSD readers, even though the embedded preview looks correct.
  for (const [index, layer] of composition.layers.entries()) {
    const base: Layer = { name: layer.name, hidden: layer.hidden, opacity: layer.opacity, blendMode: 'normal', protected: { all: layer.locked } }
    const visible = { ...layer, hidden: false, opacity: 1 }
    if (editableText && layer.kind === 'text' && layer.ocr) {
      const ocr = layer.ocr, sx = layer.width / ocr.width, sy = layer.height / ocr.height
      const attrs = ocrTextNodes(ocr, measure), spans: Layer[] = []
      let runNumber = 0
      for (const [lineIndex, line] of ocr.lines.entries()) for (const [part, run] of line.runs.entries()) {
        const a = attrs[runNumber++]!, x = Number(a.x), y = Number(a.y), fontSize = Number(a.fontSize), runWidth = Number(a.width)
        if (!run.text) continue
        const spanLayer: CanvasLayer = { ...visible, ocr: { ...ocr, lines: [{ ...line, x, y, width: runWidth, fontSize, runs: [{ ...run, shadow: false, translucent: false }] }] } }
        const matrix = transform(layer, sx, sy, x, y), box = layerBounds({ x: matrix[4]!, y: matrix[5]!, width: runWidth * sx, height: line.height * sy, rotation: layer.rotation })
        const cached = await render([spanLayer], { x: box.x - 2, y: box.y - 2, width: box.width + 4, height: box.height + 4 })
        const text: LayerTextData = { text: run.text, orientation: 'horizontal', shapeType: 'point', pointBase: [0, 0],
          transform: transform(layer, sx, sy, x, y + (line.height - fontSize) / 2 + fontSize * 0.8), style: textStyle(run, fontSize), styleRuns: psdFontRuns(run.text, run.fontFamily) }
        spans.push({ name: `第 ${lineIndex + 1} 行${line.runs.length > 1 ? ` · ${part + 1}` : ''} · ${run.text.slice(0, 28)}`, ...cached, text,
          opacity: run.translucent ? 0.6 : 1, blendMode: 'normal', ...(run.shadow ? { effects: { dropShadow: [{ enabled: true, present: true, color: { r: 0, g: 0, b: 0 }, opacity: 0.3, blendMode: 'multiply', angle: 135, useGlobalLight: false, distance: { units: 'Pixels', value: fontSize * sy * 0.05 * Math.SQRT2 }, size: { units: 'Pixels', value: fontSize * sy * 0.08 } }] } } : {}) })
      }
      children.push({ ...base, children: spans, opened: false })
    } else if (editableText && isNode(layer) && layer.text) {
      const { text: _text, ...shape } = visible, label = labelLayout(visible)
      children.push({ ...base, opened: false, children: [
        { name: '节点', ...await render([shape], paddedBox(shape)), blendMode: 'normal' },
        { name: layer.text, ...await render([label], paddedBox(label)), text: nativeText(label), blendMode: 'normal' },
      ] })
    } else {
      const bitmap = await render([visible], paddedBox(visible))
      children.push({ ...base, ...bitmap, ...(editableText && layer.kind === 'text' ? { text: nativeText(layer) } : {}) })
    }
    progress?.(index + 1, composition.layers.length)
    // Let the browser paint progress between expensive rasterizations.
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  if (composition.background !== 'transparent') children.unshift({ name: '画板背景', ...await render([], frame, composition.background), protected: { all: true }, opacity: 1, blendMode: 'normal' })
  const composite = await render(composition.layers, frame, composition.background)
  return { width: composition.width, height: composition.height, children, imageData: composite.imageData, bitsPerChannel: 8, colorMode: 3,
    imageResources: { resolutionInfo: { horizontalResolution: 72, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches', verticalResolution: 72, verticalResolutionUnit: 'PPI', heightUnit: 'Inches' } } }
}
export async function exportPsd(sessionId: string, composition: Composition, editableText = true, progress?: (done: number, total: number) => void): Promise<Uint8Array> {
  const psd = await buildPsdDocument(composition, async (layers, box, background) => {
    const canvas = await renderLayersCanvas(sessionId, layers, box, background), ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法绘制 PSD 图层。')
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
    canvas.width = 0; canvas.height = 0
    return data
  }, editableText, undefined, progress, nodeLabel)
  return writePsdUint8Array(psd, { noBackground: true, trimImageData: true, invalidateTextLayers: false })
}
