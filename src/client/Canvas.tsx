import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { KonvaEventObject } from 'konva/lib/Node'
import type Konva from 'konva'
import { Group, Image as KImage, Layer, Rect, Stage } from 'react-konva'
import type { CanvasItem } from '../shared/types.js'
import { labelOf } from '../shared/types.js'
import type { CanvasModel, PendingView } from './controller.js'
import { imageUrl } from './controller.js'
import type { Outcome } from './handoff.js'
import { Composer, SizePicker } from './Composer.js'
import type { SizeChoice } from './Composer.js'
import { CloseIcon, DownloadIcon, EditIcon, FitIcon, ImageIcon, MinusIcon, PlusIcon, QuoteIcon, RedoIcon, TrashIcon, UndoIcon } from './icons.js'

export interface View { x: number; y: number; scale: number }
interface Move { id: string; from: { x: number; y: number }; to: { x: number; y: number } }
interface Box { x: number; y: number; width: number; height: number }
const MIN_SCALE = 0.02, MAX_SCALE = 4, PAD = 48, GAP = 80, ACCENT = '#3b6cf6'
/** Space kept clear for the label and toolbar above, and the composer below, when fitting. */
const TOP = 76, BOTTOM = 132
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** Bounding box of items plus placeholder slots, in canvas units. */
export function bounds(items: Box[]): Box | undefined {
  if (!items.length) return undefined
  const x0 = Math.min(...items.map(i => i.x)), y0 = Math.min(...items.map(i => i.y))
  const x1 = Math.max(...items.map(i => i.x + i.width)), y1 = Math.max(...items.map(i => i.y + i.height))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}
/** Fit a box inside a viewport, never enlarging past 100 %; `top` and `bottom` are reserved for floating controls. */
export function fit(box: Box, width: number, height: number, bottom = 0, top = 0): View {
  const w = Math.max(1, width - PAD * 2), h = Math.max(1, height - PAD * 2 - bottom - top)
  const scale = clamp(Math.min(w / box.width, h / box.height, 1), MIN_SCALE, MAX_SCALE)
  return { scale, x: (width - box.width * scale) / 2 - box.x * scale, y: top + PAD + (h - box.height * scale) / 2 - box.y * scale }
}
/** Expected output shape for a pending request, so the placeholder matches what will arrive. */
export function pendingShape(size: string | undefined, fallbackHeight: number): { width: number; height: number } {
  const m = size ? /^(\d+)x(\d+)$/.exec(size) : null
  if (!m) return { width: fallbackHeight, height: fallbackHeight }
  const w = Number(m[1]), h = Number(m[2]), k = fallbackHeight / Math.max(w, h)
  return { width: Math.round(w * k), height: Math.round(h * k) }
}
const images = new Map<string, HTMLImageElement>()
function useImage(src: string): HTMLImageElement | undefined {
  const [image, setImage] = useState(() => { const c = images.get(src); return c?.complete && c.naturalWidth ? c : undefined })
  useEffect(() => {
    let img = images.get(src)
    if (img?.complete && img.naturalWidth) { setImage(img); return }
    if (!img) { img = new window.Image(); img.decoding = 'async'; img.src = src; images.set(src, img) }
    const done = () => setImage(img)
    img.addEventListener('load', done)
    return () => img.removeEventListener('load', done)
  }, [src])
  return image
}
function Picture({ item, sessionId, selected, hovered, scale, onSelect, onHover, onMove }: {
  item: CanvasItem; sessionId: string; selected: boolean; hovered: boolean; scale: number
  onSelect(id: string): void; onHover(id: string | undefined): void; onMove(move: Move): void
}) {
  const image = useImage(imageUrl(sessionId, item.id))
  const select = (e: KonvaEventObject<MouseEvent | TouchEvent>) => { e.cancelBubble = true; onSelect(item.id) }
  const handle = 8 / scale, line = 1 / scale
  return <Group x={item.x} y={item.y} draggable
    onMouseDown={select} onTouchStart={select}
    onMouseEnter={e => { onHover(item.id); const c = e.target.getStage()?.container(); if (c) c.style.cursor = 'move' }}
    onMouseLeave={e => { onHover(undefined); const c = e.target.getStage()?.container(); if (c) c.style.cursor = '' }}
    onDragEnd={e => { e.cancelBubble = true; const to = { x: e.target.x(), y: e.target.y() }; if (to.x !== item.x || to.y !== item.y) onMove({ id: item.id, from: { x: item.x, y: item.y }, to }) }}>
    <Rect width={item.width} height={item.height} fill="#fff" shadowColor="#101828" shadowOpacity={selected ? 0.16 : 0.1} shadowBlur={(selected ? 28 : 18) / scale} shadowOffsetY={(selected ? 8 : 4) / scale} listening={false}/>
    {image ? <KImage image={image} width={item.width} height={item.height}/> : <Rect width={item.width} height={item.height} fill="#ececef"/>}
    {selected || hovered ? <Rect width={item.width} height={item.height} stroke={ACCENT} strokeWidth={(selected ? 2 : 1.5) * line} opacity={selected ? 1 : 0.55} listening={false}/> : null}
    {selected ? [[0, 0], [item.width, 0], [0, item.height], [item.width, item.height]].map(([x, y]) =>
      <Rect key={`${x},${y}`} x={x! - handle / 2} y={y! - handle / 2} width={handle} height={handle} fill="#fff" stroke={ACCENT} strokeWidth={1.5 * line} cornerRadius={1.5 * line} listening={false}/>) : null}
  </Group>
}
/** Seconds since a start time, ticking once per second while mounted. */
function useElapsed(since: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  return Math.max(0, Math.floor((now - since) / 1000))
}
/** HTML overlay for a pending result, placed over its canvas slot so text stays crisp at any zoom. */
function PendingCard({ pending, rect }: { pending: PendingView; rect: { left: number; top: number; width: number; height: number } }) {
  const seconds = useElapsed(pending.startedAt)
  const compact = rect.width < 150 || rect.height < 120
  return <div className="sd-pending" style={rect}>
    <div className="sd-pending-shine"/>
    <div className="sd-pending-body">
      <span className="sd-spinner"/>
      {compact ? null : <><strong>正在生成</strong><span className="sd-pending-time">{seconds} 秒</span><p>{pending.prompt}</p></>}
    </div>
  </div>
}
const EXAMPLES = ['热带雨林垂直分层剖面图，教材插画风格，标注每层高度和代表物种', '一只坐在苔藓石头上的红眼树蛙，自然博物水彩风格，浅色背景', '细胞有丝分裂各时期的示意图，扁平矢量风格，白色背景']
export function CanvasView({ model, active = true, onReference, defaultSize }: {
  model: CanvasModel; active?: boolean
  /** Absent for a standalone canvas: no conversation can read its items. */
  onReference?: ((item: CanvasItem) => Promise<Outcome>) | undefined
  defaultSize?: string | undefined
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const items = useMemo(() => state.canvas?.items ?? [], [state.canvas])
  const host = useRef<HTMLDivElement>(null), stage = useRef<Konva.Stage>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 0.3 })
  const [selected, setSelected] = useState<string | undefined>(), [hovered, setHovered] = useState<string | undefined>()
  const [editing, setEditing] = useState(false), [confirming, setConfirming] = useState(false)
  const [prompt, setPrompt] = useState(''), [genSize, setGenSize] = useState<SizeChoice>('')
  const [history, setHistory] = useState<{ done: Move[]; undone: Move[] }>({ done: [], undone: [] })
  const fitted = useRef(false), seen = useRef<string | undefined>(undefined)
  useEffect(() => active ? model.hold() : undefined, [model, active])
  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }))
    observer.observe(el); setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => observer.disconnect()
  }, [])
  const slot = items.length ? Math.max(...items.map(i => i.height)) : 1024
  const placeholders = useMemo(() => {
    let x = items.reduce((m, i) => Math.max(m, i.x + i.width + GAP), 0)
    return state.pending.map(p => {
      const shape = pendingShape(p.size, slot), parent = p.parentId ? items.find(i => i.id === p.parentId) : undefined
      const slotBox = { ...p, ...shape, x, y: parent?.y ?? 0 }
      x += shape.width + GAP
      return slotBox
    })
  }, [items, state.pending, slot])
  const fitAll = useCallback((extra: Box[] = []) => {
    const box = bounds([...items, ...extra])
    if (box && size.width && size.height) setView(fit(box, size.width, size.height, BOTTOM, TOP))
  }, [items, size])
  useEffect(() => { if (!fitted.current && items.length && size.width) { fitted.current = true; fitAll() } }, [items, size, fitAll])
  // Newly arrived results (from this view or the conversation) are revealed and selected.
  useEffect(() => {
    if (!state.canvas) return
    const key = items.map(i => i.id).join(',')
    // The first loaded state is the baseline; anything after it is new, including a first image.
    if (seen.current !== undefined && key !== seen.current && items.length) {
      const known = new Set(seen.current.split(',')), fresh = items.filter(i => !known.has(i.id))
      // Reveal what just arrived at a readable size; the fit button still shows everything.
      if (fresh.length) { const box = bounds(fresh); if (box && size.width) setView(fit(box, size.width, size.height, BOTTOM, TOP)); setSelected(fresh.at(-1)!.id); setEditing(false) }
    }
    seen.current = key
  }, [items, fitAll, state.canvas, size])
  const pendingKeys = state.pending.map(p => p.key).join(',')
  useEffect(() => { if (pendingKeys) fitAll(placeholders) }, [pendingKeys]) // eslint-disable-line react-hooks/exhaustive-deps
  const item = items.find(i => i.id === selected)
  useEffect(() => { if (selected && !item) setSelected(undefined) }, [selected, item])
  useEffect(() => { setConfirming(false) }, [selected])
  useEffect(() => { if (!item) setEditing(false) }, [item])
  const zoomAt = (factor: number, point = { x: size.width / 2, y: size.height / 2 }) => setView(v => {
    const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE), k = scale / v.scale
    return { scale, x: point.x - (point.x - v.x) * k, y: point.y - (point.y - v.y) * k }
  })
  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const pointer = stage.current?.getPointerPosition() ?? undefined
    if (e.evt.ctrlKey || e.evt.metaKey) zoomAt(Math.exp(-e.evt.deltaY * 0.01), pointer)
    else setView(v => ({ ...v, x: v.x - e.evt.deltaX, y: v.y - e.evt.deltaY }))
  }
  const apply = (moves: Move[], to: 'from' | 'to') => { void model.move(moves.map(m => ({ id: m.id, ...m[to] }))) }
  const onMove = (move: Move) => { setHistory(h => ({ done: [...h.done, move].slice(-100), undone: [] })); apply([move], 'to') }
  const undo = () => { const m = history.done.at(-1); if (!m) return; setHistory(h => ({ done: h.done.slice(0, -1), undone: [...h.undone, m] })); apply([m], 'from') }
  const redo = () => { const m = history.undone.at(-1); if (!m) return; setHistory(h => ({ done: [...h.done, m], undone: h.undone.slice(0, -1) })); apply([m], 'to') }
  const [notice, setNotice] = useState('')
  const flash = (text: string) => { setNotice(text); setTimeout(() => setNotice(n => n === text ? '' : n), 2500) }
  const reference = async () => {
    if (!item || !onReference) return
    const outcome = await onReference(item)
    flash(outcome === 'filled' ? '已引用到对话输入框' : outcome === 'copied' ? '已复制引用，可粘贴到对话中' : outcome === 'busy' ? '对话正在提交，请稍后再引用' : '当前无法引用')
  }
  const submit = () => {
    const text = prompt.trim()
    if (!text) return
    if (editing && item) void model.generate({ prompt: text, images: [`item:${item.id}`], title: `${labelOf(item)} · 编辑`, ...(genSize ? { size: genSize } : {}) }, item.id)
    else void model.generate({ prompt: text, ...(genSize ? { size: genSize } : {}) })
    setPrompt(''); setEditing(false)
  }
  const remove = () => { if (item) { void model.remove(item.id); setConfirming(false) } }
  const startEdit = () => { setEditing(true); setConfirming(false); requestAnimationFrame(() => host.current?.querySelector<HTMLTextAreaElement>('.sd-composer textarea')?.focus()) }
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input,textarea,select,button')) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && item) { e.preventDefault(); setConfirming(true) }
    else if (e.key === 'Tab' && item) { e.preventDefault(); startEdit() }
    else if (e.key === 'Escape') { setEditing(false); setConfirming(false); setSelected(undefined) }
    else if (e.key === '0' && mod) { e.preventDefault(); fitAll() }
  }
  const toolbar = useRef<HTMLDivElement>(null), [toolbarWidth, setToolbarWidth] = useState(280)
  useLayoutEffect(() => { if (toolbar.current) setToolbarWidth(toolbar.current.offsetWidth) }, [item?.id, confirming, onReference])
  // Floating controls stay inside the canvas even when the image extends past its edge.
  const inside = (left: number, width: number) => clamp(left, 8, Math.max(8, size.width - width - 8))
  const screen = (b: Box) => ({ left: view.x + b.x * view.scale, top: view.y + b.y * view.scale, width: b.width * view.scale, height: b.height * view.scale })
  const box = item ? screen(item) : undefined
  // Label sits just above the image; the toolbar above the label, or inside the top edge when there is no room.
  const labelTop = box ? Math.max(6, box.top - 24) : 0
  const toolbarTop = box ? (labelTop - 52 >= 8 ? labelTop - 52 : Math.min(box.top + box.height - 52, Math.max(labelTop + 26, 8))) : 0
  const labelWidth = box ? Math.min(Math.max(box.width, 180), size.width - 16) : 0
  const waiting = state.pending.some(p => p.key.startsWith('local-'))
  const error = state.error, toast = notice || state.message
  const dots = Math.max(8, 24 * view.scale)
  const empty = !items.length && !state.pending.length && !state.loading
  return <div className="sd-canvas" ref={host} tabIndex={0} onKeyDown={onKey}
    style={{ backgroundSize: `${dots}px ${dots}px`, backgroundPosition: `${view.x}px ${view.y}px` }}>
    {size.width > 0 ? <Stage ref={stage} width={size.width} height={size.height} x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}
      draggable onWheel={onWheel}
      onMouseDown={e => { if (e.target === e.target.getStage()) { setSelected(undefined); setEditing(false); host.current?.focus() } }}
      onDragMove={e => { if (e.target === e.target.getStage()) setView(v => ({ ...v, x: e.target.x(), y: e.target.y() })) }}
      onDragEnd={e => { if (e.target === e.target.getStage()) setView(v => ({ ...v, x: e.target.x(), y: e.target.y() })) }}>
      <Layer>
        {items.map(i => <Picture key={i.id} item={i} sessionId={model.sessionId} selected={i.id === selected} hovered={i.id === hovered} scale={view.scale}
          onSelect={id => { setSelected(id); if (id !== selected) setEditing(false); host.current?.focus() }} onHover={setHovered} onMove={onMove}/>)}
      </Layer>
    </Stage> : null}
    {placeholders.map(p => <PendingCard key={p.key} pending={p} rect={screen(p)}/>)}
    {empty ? <div className="sd-empty">
      <div className="sd-empty-icon"><ImageIcon size={22}/></div>
      <strong>{onReference ? '这个对话的画布' : '新画布'}</strong>
      <p>{onReference ? '对话里生成的图片会出现在这里。也可以在下方直接描述画面。' : '描述你想要的画面，生成第一张图。这个画布不属于任何对话。'}</p>
      <div className="sd-examples">{EXAMPLES.map(x => <button key={x} type="button" onClick={() => { setPrompt(x); host.current?.querySelector<HTMLTextAreaElement>('.sd-composer textarea')?.focus() }}>{x}</button>)}</div>
    </div> : null}
    {item && box ? <>
      <div className="sd-label" style={{ left: inside(box.left, labelWidth), top: labelTop, width: labelWidth }}>
        <span className="sd-label-title"><ImageIcon size={12}/>{labelOf(item)}</span><span className="sd-label-size">{item.width} × {item.height}</span>
      </div>
      <div className="sd-float" ref={toolbar} role="toolbar" aria-label="图片操作" style={{ left: inside(box.left, toolbarWidth), top: toolbarTop }}>
        {confirming ? <>
          <span className="sd-float-text">删除这张图？本机文件也会删除</span>
          <button className="sd-float-danger" onClick={remove}>删除</button>
          <button onClick={() => setConfirming(false)}>取消</button>
        </> : <>
          <button onClick={() => editing ? setEditing(false) : startEdit()} aria-pressed={editing}><EditIcon/>编辑<kbd>Tab</kbd></button>
          {onReference ? <button onClick={() => { void reference() }} title="引用到对话输入框"><QuoteIcon/>引用</button> : null}
          <span className="sd-float-sep"/>
          <a href={imageUrl(model.sessionId, item.id, true)} download={`${labelOf(item)}.png`} title="下载原图" aria-label="下载"><DownloadIcon/></a>
          <button onClick={() => setConfirming(true)} title="删除" aria-label="删除"><TrashIcon/></button>
        </>}
      </div>
    </> : null}
    {toast ? <div className="sd-toast" role="status">{toast}</div> : null}
    <div className="sd-bottom">
      {error ? <div className="sd-error" role="alert"><span>{error}</span><button type="button" className="sd-icon-button sd-icon-small" onClick={() => model.dismiss()} aria-label="关闭"><CloseIcon size={12}/></button></div> : null}
      <Composer value={prompt} onChange={setPrompt} onSubmit={submit} onStop={() => model.cancel()} waiting={waiting} autoFocus={empty}
        placeholder={editing ? '描述要修改的地方，以及需要保持不变的部分…' : '描述你想生成的画面…'}
        context={editing && item ? <span className="sd-context-chip"><img src={imageUrl(model.sessionId, item.id)} alt=""/>编辑 · {labelOf(item)}</span> : undefined}
        onClearContext={() => setEditing(false)}
        hint={waiting ? '生成中…' : '每次生成都会计费'}>
        <SizePicker value={genSize} onChange={setGenSize} fallback={defaultSize}/>
      </Composer>
    </div>
    <div className="sd-zoom" role="toolbar" aria-label="视图">
      <button onClick={undo} disabled={!history.done.length} title="撤销移动 (⌘Z)" aria-label="撤销"><UndoIcon/></button>
      <button onClick={redo} disabled={!history.undone.length} title="重做 (⇧⌘Z)" aria-label="重做"><RedoIcon/></button>
      <span className="sd-zoom-sep"/>
      <button onClick={() => zoomAt(1 / 1.2)} title="缩小" aria-label="缩小"><MinusIcon/></button>
      <button className="sd-zoom-value" onClick={() => fitAll()} title="适应窗口 (⌘0)">{Math.round(view.scale * 100)}%</button>
      <button onClick={() => zoomAt(1.2)} title="放大" aria-label="放大"><PlusIcon/></button>
      <button onClick={() => fitAll()} title="适应窗口 (⌘0)" aria-label="适应窗口"><FitIcon/></button>
    </div>
  </div>
}
