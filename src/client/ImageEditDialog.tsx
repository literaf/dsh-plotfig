import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type Konva from 'konva'
import { Circle, Image as KImage, Layer, Line, Rect, Stage } from 'react-konva'
import type { CanvasItem } from '../shared/types.js'
import { editDimensions, enhanceDimensions, expansionSteps, IMAGE_EDIT_LABELS, MAX_EDIT_PIXELS } from '../shared/image-edit.js'
import type { ExpandMargins, ImageEditOperation } from '../shared/image-edit.js'
import type { CanvasModel } from './controller.js'
import { imageUrl } from './controller.js'
import { loadImage } from './images.js'
import { CloseIcon } from './icons.js'
import { maskPng } from './edit-mask.js'
import type { MaskMark } from './edit-mask.js'

export function ImageEditDialog({ model, source, initialOperation, onClose, onComplete }: {
  model: CanvasModel; source: CanvasItem; initialOperation: ImageEditOperation; onClose(): void; onComplete?(item: CanvasItem): void
}) {
  const [operation, setOperation] = useState(initialOperation), [prompt, setPrompt] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [tool, setTool] = useState<'brush' | 'rect' | 'eraser'>('brush'), [brushSize, setBrushSize] = useState(Math.max(12, Math.round(source.width / 25)))
  const [feather, setFeather] = useState(Math.min(24, Math.round(Math.min(source.width, source.height) * 0.008)))
  const [marks, setMarks] = useState<MaskMark[]>([]), [undone, setUndone] = useState<MaskMark[]>([]), [live, setLive] = useState<MaskMark>()
  const [margins, setMargins] = useState<ExpandMargins>({ left: Math.max(1, Math.round(source.width * 0.15)), right: 0, top: 0, bottom: 0 })
  const area = useRef<HTMLDivElement>(null), dialog = useRef<HTMLElement>(null), stage = useRef<Konva.Stage>(null), activeMark = useRef<MaskMark>(), submitting = useRef(false), mounted = useRef(true)
  const [size, setSize] = useState({ width: 0, height: 0 }), [image, setImage] = useState<HTMLImageElement>(), [imageError, setImageError] = useState('')
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let current = true
    setImage(undefined); setImageError('')
    void loadImage(imageUrl(model.sessionId, source.id)).then(value => { if (current) setImage(value) }, () => { if (current) setImageError('原图读取失败，请关闭后重新打开。') })
    return () => { current = false }
  }, [model.sessionId, source.id])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  useLayoutEffect(() => {
    const element = area.current; if (!element) return
    const resize = () => setSize({ width: element.clientWidth, height: element.clientHeight }), observer = new ResizeObserver(resize)
    resize(); observer.observe(element); return () => observer.disconnect()
  }, [])
  let dimensionError = '', width = source.width, height = source.height
  try { const target = operation === 'enhance' ? enhanceDimensions(width, height) : editDimensions(width, height, operation === 'expand' ? margins : undefined); width = target.width; height = target.height } catch (e) { dimensionError = e instanceof Error ? e.message : '尺寸无效' }
  // The preview stays at source scale; only the label reports the enhanced size.
  const previewWidth = operation === 'enhance' ? source.width : width, previewHeight = operation === 'enhance' ? source.height : height
  const steps = operation === 'expand' ? Math.max(1, expansionSteps(margins).length) : 1, marking = operation === 'erase' || operation === 'inpaint'
  // Inpainting sends rectangles as <bbox> tags; they must stay inside the image in whole pixels.
  const regions = marks.filter(m => m.kind === 'rect' && m.points.length >= 4).map(m => {
    const x = Math.min(source.width - 1, Math.floor(Math.min(m.points[0]!, m.points[2]!))), y = Math.min(source.height - 1, Math.floor(Math.min(m.points[1]!, m.points[3]!)))
    const right = Math.min(source.width, Math.ceil(Math.max(m.points[0]!, m.points[2]!))), bottom = Math.min(source.height, Math.ceil(Math.max(m.points[1]!, m.points[3]!)))
    return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }
  })
  const left = operation === 'expand' ? margins.left : 0, top = operation === 'expand' ? margins.top : 0
  const scale = Math.max(0.001, Math.min((size.width - 40) / previewWidth, (size.height - 40) / previewHeight, 1)), originX = (size.width - previewWidth * scale) / 2, originY = (size.height - previewHeight * scale) / 2
  const point = () => {
    const p = stage.current?.getPointerPosition(); if (!p) return undefined
    return { x: Math.max(0, Math.min(source.width, (p.x - originX) / scale - left)), y: Math.max(0, Math.min(source.height, (p.y - originY) / scale - top)) }
  }
  const down = () => {
    if (!marking || busy || marks.length >= (operation === 'inpaint' ? 16 : 300)) return
    const p = point(); if (!p) return
    const mark: MaskMark = { kind: operation === 'inpaint' || tool === 'rect' ? 'rect' : 'brush', subtract: operation === 'erase' && tool === 'eraser', size: brushSize, points: [p.x, p.y] }
    activeMark.current = mark; setLive(mark)
  }
  const move = () => {
    const mark = activeMark.current, p = point(); if (!mark || !p) return
    const points = mark.kind === 'rect' ? [mark.points[0]!, mark.points[1]!, p.x, p.y] : mark.points.length >= 20000 ? mark.points : [...mark.points, p.x, p.y]
    activeMark.current = { ...mark, points }; setLive(activeMark.current)
  }
  const end = () => {
    const mark = activeMark.current; if (!mark) return
    activeMark.current = undefined; setLive(undefined)
    if (mark.kind === 'rect' && (mark.points.length < 4 || Math.abs(mark.points[2]! - mark.points[0]!) < 1 || Math.abs(mark.points[3]! - mark.points[1]!) < 1)) return
    setMarks(value => [...value, mark]); setUndone([])
  }
  const undo = () => { if (!marks.length || busy) return; setUndone(v => [...v, marks.at(-1)!]); setMarks(v => v.slice(0, -1)) }
  const redo = () => { if (!undone.length || busy) return; setMarks(v => [...v, undone.at(-1)!]); setUndone(v => v.slice(0, -1)) }
  const ratio = (w: number, h: number) => {
    let targetWidth = source.width, targetHeight = source.height
    if (targetWidth / targetHeight < w / h) targetWidth = Math.ceil(targetHeight * w / h); else targetHeight = Math.ceil(targetWidth * h / w)
    if (targetWidth === source.width && targetHeight === source.height) { targetWidth = Math.ceil(targetWidth * 1.25); targetHeight = Math.ceil(targetHeight * 1.25) }
    const dx = targetWidth - source.width, dy = targetHeight - source.height
    setMargins({ left: Math.floor(dx / 2), right: Math.ceil(dx / 2), top: Math.floor(dy / 2), bottom: Math.ceil(dy / 2) })
  }
  const submit = async () => {
    if (submitting.current || dimensionError || !image) return
    submitting.current = true; setBusy(true); setError('')
    try {
      const items = await model.editImage({ operation, image: `item:${source.id}`, requestId: crypto.randomUUID(), prompt,
        ...(operation === 'erase' ? { mask: maskPng(source.width, source.height, marks), feather } : {}), ...(operation === 'inpaint' ? { regions, feather } : {}), ...(operation === 'expand' ? { expand: margins } : {}) })
      const item = items[0]; if (item) onComplete?.(item)
      if (mounted.current) onClose()
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '编辑失败。') }
    finally { submitting.current = false; if (mounted.current) setBusy(false) }
  }
  const allMarks = live ? [...marks, live] : marks
  return <div className="sd-image-edit-backdrop" onKeyDown={e => {
    e.stopPropagation()
    if (e.key === 'Escape') onClose()
    if (e.key === 'Tab') {
      const controls = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')]
      const first = controls[0], last = controls.at(-1)
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !(e.target as HTMLElement).closest('input,textarea')) { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
  }}>
    <section ref={dialog} tabIndex={-1} className="sd-image-edit-dialog" role="dialog" aria-modal="true" aria-label="AI 图片编辑">
      <header><div><strong>{IMAGE_EDIT_LABELS[operation]}</strong><span>{source.title}</span></div><button className="sd-icon-button" aria-label="关闭图片编辑" onClick={onClose}><CloseIcon/></button></header>
      <div className="sd-image-edit-tabs" role="tablist" aria-label="图片编辑方式">{(Object.entries(IMAGE_EDIT_LABELS) as Array<[ImageEditOperation, string]>).map(([id, label]) => <button key={id} role="tab" aria-selected={operation === id} disabled={busy} onClick={() => { if (id !== operation) { setMarks([]); setUndone([]) } setOperation(id); setError('') }}>{label}</button>)}</div>
      <div className="sd-image-edit-body">
        <div className="sd-image-edit-preview" ref={area} aria-label={operation === 'erase' ? '涂抹消除区域' : operation === 'inpaint' ? '框选重绘区域' : '图片编辑预览'} style={{ cursor: marking && !busy ? 'crosshair' : 'default' }}>
          {size.width > 0 ? <Stage ref={stage} width={size.width} height={size.height} x={originX} y={originY} scaleX={scale} scaleY={scale} onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerLeave={end}>
            <Layer><Rect width={previewWidth} height={previewHeight} stroke="#91a5c0" strokeWidth={1 / scale} fill={operation === 'expand' ? '#91a5c022' : 'transparent'}/>{image ? <KImage image={image} x={left} y={top} width={source.width} height={source.height}/> : null}{operation === 'expand' ? <Rect x={left} y={top} width={source.width} height={source.height} stroke="#3b6cf6" strokeWidth={2 / scale} dash={[8 / scale, 5 / scale]} listening={false}/> : null}</Layer>
            {marking ? <Layer opacity={0.55} listening={false}>{allMarks.map((mark, i) => {
              const common = { globalCompositeOperation: mark.subtract ? 'destination-out' as const : 'source-over' as const, fill: operation === 'inpaint' ? '#3b6cf6' : '#f43f5e' }
              if (mark.kind === 'rect') return <Rect key={i} {...common} x={Math.min(mark.points[0]!, mark.points[2] ?? mark.points[0]!)} y={Math.min(mark.points[1]!, mark.points[3] ?? mark.points[1]!)} width={Math.abs((mark.points[2] ?? mark.points[0]!) - mark.points[0]!)} height={Math.abs((mark.points[3] ?? mark.points[1]!) - mark.points[1]!)}/>
              return mark.points.length === 2 ? <Circle key={i} {...common} x={mark.points[0]!} y={mark.points[1]!} radius={mark.size / 2}/> : <Line key={i} {...common} points={mark.points} stroke="#f43f5e" strokeWidth={mark.size} lineCap="round" lineJoin="round"/>
            })}</Layer> : null}
          </Stage> : null}
          {!image ? <div className="sd-image-edit-loading" role={imageError ? 'alert' : undefined}>{imageError || '正在读取原图…'}</div> : null}
          <div className="sd-image-edit-dimensions">{width} × {height}{operation === 'expand' ? ' · 蓝框内保留原图' : ''}</div>
        </div>
        <aside className="sd-image-edit-controls">
          {operation === 'remove-background' ? <p>抠出主要主体，默认去除旁注、图表及背景。需要保留的文字或物体可在下方说明。AI 可能微调细节，原图会保留。</p> : operation === 'enhance' ? <>
            <p>提高分辨率并锐化线条和文字，输出约 {width} × {height}，模型最大输出约 460 万像素。透明区域按原图保留。</p>
            <p>AI 可能改写小字。与原图明显不同的位置会用原图放大还原，这些位置略模糊但内容正确。结果标记“需核对”，另存到画布，不自动替换图层。</p>
          </> : operation === 'inpaint' ? <>
            <p>框选要重绘的区域，最多 16 个，并在下方描述要画的内容。框外的像素从原图原样保留。</p>
            <label>边缘过渡 · {feather} px<input type="range" aria-label="重绘边缘过渡" min={0} max={64} value={feather} disabled={busy} onChange={e => setFeather(Number(e.target.value))}/></label>
            <div className="sd-image-edit-mask-actions"><button disabled={!marks.length || busy} onClick={undo}>撤销选区</button><button disabled={!undone.length || busy} onClick={redo}>重做选区</button><button disabled={!marks.length || busy} onClick={() => { setMarks([]); setUndone([]) }}>清空</button></div>
          </> : operation === 'erase' ? <>
            <p>涂抹或框选要移除的部分，覆盖边缘、阴影并留出过渡空间。未选中的像素会从原图保留。</p>
            <div className="sd-image-edit-brushes">{([['brush', '涂抹'], ['rect', '框选'], ['eraser', '减选']] as const).map(([id, label]) => <button key={id} aria-pressed={tool === id} disabled={busy} onClick={() => setTool(id)}>{label}</button>)}</div>
            <label>画笔大小 · {brushSize} px<input type="range" aria-label="画笔大小" min={1} max={Math.min(2048, Math.max(source.width, source.height))} value={brushSize} disabled={busy || tool === 'rect'} onChange={e => setBrushSize(Number(e.target.value))}/></label>
            <label>边缘过渡 · {feather} px<input type="range" aria-label="消除边缘过渡" min={0} max={64} value={feather} disabled={busy} onChange={e => setFeather(Number(e.target.value))}/></label>
            <div className="sd-image-edit-mask-actions"><button disabled={!marks.length || busy} onClick={undo}>撤销选区</button><button disabled={!undone.length || busy} onClick={redo}>重做选区</button><button disabled={!marks.length || busy} onClick={() => { setMarks([]); setUndone([]) }}>清空</button></div>
          </> : <>
            <p>每次扩展一侧；同时设置多侧时按左、右、上、下依次扩展，每侧生成一张。原图的文字、像素及透明度完整保留；衔接偏差较大的结果会标记“需检查”，不自动替换图层。</p>
            <div className="sd-image-edit-ratios" aria-label="扩图方向">{([['left', '向左'], ['right', '向右'], ['top', '向上'], ['bottom', '向下']] as const).map(([side, name]) => <button key={side} aria-pressed={margins[side] > 0 && Object.values(margins).filter(v => v > 0).length === 1} disabled={busy} onClick={() => setMargins({ left: 0, right: 0, top: 0, bottom: 0, [side]: margins[side] || Math.max(1, Math.round((side === 'left' || side === 'right' ? source.width : source.height) * 0.15)) })}>{name}</button>)}</div>
            {steps > 1 ? <p>当前同时扩展 {steps} 侧，将依次生成 {steps} 张，后一步沿用前一步的结果。某一步失败时保存已完成的部分，不自动重试。</p> : null}
            <div className="sd-image-edit-ratios">{[[1, 1], [16, 9], [9, 16], [4, 3]].map(([w, h]) => <button key={`${w}:${h}`} disabled={busy} onClick={() => ratio(w!, h!)}>{w}:{h}</button>)}</div>
            <fieldset disabled={busy} className="sd-layer-grid">{([['left', '左'], ['right', '右'], ['top', '上'], ['bottom', '下']] as const).map(([key, name]) => <label key={key}>{name}侧扩展<input type="number" min={0} max={16000} step={1} aria-label={`${name}侧扩展`} value={margins[key]} onChange={e => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= 0 && v <= 16000) setMargins(m => ({ ...m, [key]: v })) }}/></label>)}</fieldset>
          </>}
          <label>{operation === 'inpaint' ? '重绘内容' : '补充要求（可选）'}<textarea aria-label="图片编辑补充要求" value={prompt} maxLength={4000} rows={3} disabled={busy} onChange={e => setPrompt(e.target.value)} placeholder={operation === 'remove-background' ? '例如：保留人物和手中花束' : operation === 'erase' ? '例如：移除人物及地面的投影' : operation === 'inpaint' ? '必填：例如在框内画一个带刻度的量筒' : operation === 'enhance' ? '例如：重点保持图中英文标注清晰' : '例如：延续森林背景和柔和光线'}/></label>
          <div className="sd-image-edit-cost">生成 {steps} 张图片，按火山接口计费。结果另存，原图保留。{busy ? <p>可以关闭此窗口；完成后结果仍会出现在画布。</p> : null}</div>
          {error || dimensionError ? <p className="sd-image-edit-error" role="alert">{error || dimensionError}</p> : null}
          <button className="sd-button sd-button-primary" disabled={busy || !image || !!dimensionError || source.width * source.height > MAX_EDIT_PIXELS || (operation === 'erase' && !marks.some(m => !m.subtract)) || (operation === 'inpaint' && (!regions.length || !prompt.trim())) || (operation === 'expand' && !Object.values(margins).some(v => v > 0))} onClick={() => { void submit() }}>{busy ? '正在生成…' : `开始${IMAGE_EDIT_LABELS[operation]}`}</button>
        </aside>
      </div>
    </section>
  </div>
}
