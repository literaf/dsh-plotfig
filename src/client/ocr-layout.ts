import { fontStack } from '../shared/fonts.js'
import type Konva from 'konva'
import type { OCRText, TextRun } from '../shared/types.js'

export type TextMeasure = (run: TextRun, fontSize: number) => number
/** OCR font names use the Ark font list; missing fonts fall back to the closest category. */
export const ocrFontFamily = (name: string) => fontStack(name.replace(/[^\p{L}\p{N} _.&-]/gu, '').trim() || 'Arial')
let measureContext: CanvasRenderingContext2D | null | undefined
export const measureTextRun: TextMeasure = (run, size) => {
  measureContext ??= document.createElement('canvas').getContext('2d')
  if (!measureContext) throw new Error('当前环境无法绘制文字。')
  measureContext.font = `${run.italic ? 'italic ' : ''}${run.bold ? 'bold ' : ''}${size}px ${ocrFontFamily(run.fontFamily)}`
  return measureContext.measureText(run.text).width
}
/** OCR has no point size. Estimate once from each source line's text and bounding box. */
export function estimateOCRFonts(ocr: OCRText, measure: TextMeasure = measureTextRun): OCRText {
  return { ...ocr, lines: ocr.lines.map(line => {
    const width = line.runs.reduce((sum, run) => sum + measure(run, line.fontSize), 0)
    const fontSize = Math.max(1, Math.min(2000, line.height * 0.95, line.fontSize * (width ? Math.min(1.35, line.width / width) : 1)))
    return { ...line, fontSize }
  }) }
}
/** Shared by the live editor, artboard preview and PNG export. Each run keeps its own style. */
export function ocrTextNodes(ocr: OCRText, measure: TextMeasure = measureTextRun): Konva.TextConfig[] {
  return ocr.lines.flatMap(line => {
    const widths = line.runs.map(run => measure(run, line.fontSize)), total = widths.reduce((a, b) => a + b, 0)
    const shrink = Math.max(Number.EPSILON, Math.min(1, total ? line.width / total : 1, line.height / (line.fontSize * 1.15)))
    const fontSize = line.fontSize * shrink
    let x = line.x
    return line.runs.map((run, index) => {
      const width = widths[index]! * shrink
      const config: Konva.TextConfig = {
        x, y: line.y, text: run.text, width: Math.max(1, width + 0.01), height: line.height,
        fontSize, fontFamily: ocrFontFamily(run.fontFamily), fontStyle: [run.bold ? 'bold' : '', run.italic ? 'italic' : ''].filter(Boolean).join(' ') || 'normal',
        fill: run.fill, opacity: run.translucent ? 0.6 : 1, lineHeight: 1, verticalAlign: 'middle', wrap: 'none',
        textDecoration: [run.underline ? 'underline' : '', run.strikethrough ? 'line-through' : ''].filter(Boolean).join(' '),
        shadowEnabled: run.shadow, shadowColor: '#000000', shadowOpacity: 0.3, shadowBlur: fontSize * 0.08, shadowOffsetX: fontSize * 0.05, shadowOffsetY: fontSize * 0.05,
      }
      x += width
      return config
    })
  })
}
