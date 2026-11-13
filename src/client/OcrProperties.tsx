import { useEffect, useState } from 'react'
import type { CanvasLayer, OCRLine, OCRText, TextRun } from '../shared/types.js'
import { MAX_OCR_RUNS, MAX_OCR_TEXT, ocrPlainText, replaceRunText } from '../shared/ocr.js'

export function OcrProperties({ layer, disabled, compare, onCompare, onRestore, onChange }: {
  layer: CanvasLayer & { ocr: OCRText }; disabled: boolean; compare: boolean
  onCompare(): void; onRestore(): void; onChange(ocr: OCRText, group?: string): void
}) {
  const [lineIndex, setLineIndex] = useState(0), [runIndex, setRunIndex] = useState(0)
  const ocr = layer.ocr, index = Math.min(lineIndex, ocr.lines.length - 1), line = ocr.lines[index]!, part = Math.min(runIndex, line.runs.length - 1), run = line.runs[part]!
  useEffect(() => { setRunIndex(0) }, [index])
  const lineScale = layer.height / ocr.height, widthScale = layer.width / ocr.width
  const updateLine = (patch: Partial<OCRLine>, group?: string) => onChange({ ...ocr, lines: ocr.lines.map((l, i) => i === index ? { ...l, ...patch } : l) }, group && `ocr:${layer.id}:${index}:${group}`)
  const updateRun = (patch: Partial<TextRun>, group?: string) => updateLine({ runs: line.runs.map((r, i) => i === part ? { ...r, ...patch } : r) }, group && `${part}:${group}`)
  const otherLength = ocrPlainText(ocr).length - line.runs.reduce((sum, r) => sum + r.text.length, 0)
  return <div className="sd-ocr-properties">
    <div className="sd-ocr-caption">可编辑文字<span>OCR</span></div>
    <p>字体和字号为近似还原。缺少字体时使用本机替代字体。</p>
    <div className="sd-ocr-actions"><button type="button" disabled={disabled} onClick={onCompare} aria-pressed={compare}>{compare ? '返回编辑效果' : '对照原图'}</button><button type="button" disabled={disabled} onClick={onRestore}>恢复原图层</button></div>
    <fieldset disabled={disabled}>
      <label>文字行<select aria-label="文字行" value={index} onChange={e => { setLineIndex(Number(e.target.value)); setRunIndex(0) }}>{ocr.lines.map((l, i) => <option key={i} value={i}>第 {i + 1} 行 · {l.runs.map(r => r.text).join('').slice(0, 36) || '空行'}</option>)}</select></label>
      <label>当前行文字<input aria-label="识别文字" value={line.runs.map(r => r.text).join('')} maxLength={MAX_OCR_TEXT - otherLength} onChange={e => {
        const runs = replaceRunText(line.runs, e.target.value)
        if (runs.length <= MAX_OCR_RUNS) updateLine({ runs }, 'text')
      }}/></label>
      {line.runs.length > 1 ? <label>样式片段<select aria-label="文字样式片段" value={part} onChange={e => setRunIndex(Number(e.target.value))}>{line.runs.map((r, i) => <option key={i} value={i}>{i + 1}. {r.text.slice(0, 32) || '空片段'}</option>)}</select></label> : null}
      <label>{line.runs.length > 1 ? '当前片段字体' : '字体'}<input aria-label="识别文字字体" value={run.fontFamily} maxLength={100} onChange={e => { if (e.target.value.trim()) updateRun({ fontFamily: e.target.value }, 'font') }}/></label>
      <div className="sd-layer-grid">
        <label>字号上限<input type="number" aria-label="识别文字字号" min={1} max={2000 * lineScale} step={1} value={Math.round(line.fontSize * lineScale * 100) / 100} onChange={e => { const v = Number(e.target.value) / lineScale; if (v >= 1 && v <= 2000) updateLine({ fontSize: v }, 'fontSize') }}/></label>
        <label>颜色<input type="color" aria-label="识别文字颜色" value={run.fill} onChange={e => updateRun({ fill: e.target.value }, 'fill')}/></label>
      </div>
      <div className="sd-editor-style sd-ocr-styles">{([['bold', '粗体'], ['italic', '斜体'], ['underline', '下划线'], ['strikethrough', '删除线'], ['shadow', '阴影'], ['translucent', '半透明']] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={run[key]} aria-label={`识别文字${label}`} onClick={() => updateRun({ [key]: !run[key] })}>{label}</button>)}</div>
      <details className="sd-ocr-geometry"><summary>文字行位置与大小</summary><div className="sd-layer-grid">{([['x', '行 X', widthScale], ['y', '行 Y', lineScale], ['width', '行宽', widthScale], ['height', '行高', lineScale]] as const).map(([key, label, scale]) => <label key={key}>{label}<input type="number" aria-label={label} step={1} value={Math.round(line[key] * scale * 100) / 100} onChange={e => { const n = Number(e.target.value) / scale; if (Number.isFinite(n) && n >= (key === 'width' || key === 'height' ? 1 : -32000) && n <= 32000) updateLine({ [key]: n }, key) }}/></label>)}</div></details>
      <p>文字超出行宽时自动缩小。位置与大小跟随整个图层缩放；修改会自动保存。</p>
    </fieldset>
  </div>
}
