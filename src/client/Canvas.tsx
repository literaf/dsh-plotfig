import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { KonvaEventObject } from 'konva/lib/Node'
import type Konva from 'konva'
import { Group, Image as KImage, Layer, Rect, Stage } from 'react-konva'
import type { CanvasItem, Composition } from '../shared/types.js'
import { isBoard, labelOf } from '../shared/types.js'
import type { CanvasModel, PendingView } from './controller.js'
import { imageUrl } from './controller.js'
import type { ConversationActions, Outcome } from './handoff.js'
import { Composer, SizePicker } from './Composer.js'
import type { SizeChoice } from './Composer.js'
import { CloseIcon, DownloadIcon, EditIcon, FitIcon, ImageIcon, MinusIcon, PlusIcon, QuoteIcon, RedoIcon, TrashIcon, UndoIcon } from './icons.js'
import { useImage } from './images.js'
import { LayerEditor, LayersIcon } from './LayerEditor.js'
import { CompositionContent, renderLayers, downloadPng, downloadFile } from './layer-render.js'
import { layersBounds } from '../shared/layers.js'
import { ImageEditDialog } from './ImageEditDialog.js'
import { exportPsd } from './psd-export.js'

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
function Artboard({ composition: c, sessionId, selected, scale, onSelect, onMove, onOpen }: {
  composition: Composition; sessionId: string; selected: boolean; scale: number; onSelect(id: string): void; onMove(move: Move): void; onOpen(): void
}) {
  return <Group x={c.x} y={c.y} draggable onMouseDown={e => { e.cancelBubble = true; onSelect(c.id) }} onTouchStart={e => { e.cancelBubble = true; onSelect(c.id) }}
    onDblClick={onOpen} onDblTap={onOpen} onDragEnd={e => { e.cancelBubble = true; onMove({ id: c.id, from: { x: c.x, y: c.y }, to: { x: e.target.x(), y: e.target.y() } }) }}>
    <Rect width={c.width} height={c.height} fill="#fff" shadowBlur={18 / scale} shadowOpacity={0.1}/>
    <CompositionContent composition={c} sessionId={sessionId}/>
    {selected ? <Rect width={c.width} height={c.height} stroke={ACCENT} strokeWidth={2 / scale} listening={false}/> : null}
  </Group>
}
const compositionBox = (c: Composition): Box => {
  const b = layersBounds(c.layers), x = Math.min(0, b?.x ?? 0), y = Math.min(0, b?.y ?? 0)
  return { x: c.x + x, y: c.y + y, width: Math.max(c.width, b ? b.x + b.width : 0) - x, height: Math.max(c.height, b ? b.y + b.height : 0) - y }
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
export function CanvasView({ model, active = true, conversation, defaultSize }: {
  model: CanvasModel; active?: boolean
  /** Absent for a standalone canvas: no conversation can read its items. */
  conversation?: ConversationActions | undefined
  defaultSize?: string | undefined
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const inConversation = !isBoard(model.sessionId), bottom = inConversation ? 72 : BOTTOM
  const items = useMemo(() => state.canvas?.items.filter(i => i.role !== 'layer') ?? [], [state.canvas])
  const compositions = useMemo(() => state.canvas?.compositions ?? [], [state.canvas])
  const allBoxes = useMemo(() => [...items, ...compositions.map(compositionBox)], [items, compositions])
  const host = useRef<HTMLDivElement>(null), stage = useRef<Konva.Stage>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 0.3 })
  const [selected, setSelected] = useState<string | undefined>(), [hovered, setHovered] = useState<string | undefined>()
  const [editing, setEditing] = useState(false), [confirming, setConfirming] = useState(false)
  const [prompt, setPrompt] = useState(''), [genSize, setGenSize] = useState<SizeChoice>('')
  const [editorId, setEditorId] = useState<string>(), [splitSource, setSplitSource] = useState<CanvasItem>()
  const [editSource, setEditSource] = useState<CanvasItem>()
  const [splitPrompt, setSplitPrompt] = useState('将主要元素、说明文字与背景拆成独立图层，保持原有位置、颜色和细节。')
  const [maxImages, setMaxImages] = useState(30), [operationBusy, setOperationBusy] = useState(false), [operationError, setOperationError] = useState('')
  const operation = useRef(false)
  const [history, setHistory] = useState<{ done: Move[]; undone: Move[] }>({ done: [], undone: [] })
  const fitted = useRef(false), seen = useRef<string | undefined>(undefined)
  useEffect(() => active ? model.hold() : undefined, [model, active])
  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }))
    observer.observe(el); setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => observer.disconnect()
  }, [editorId])
  const slot = allBoxes.length ? Math.max(...allBoxes.map(i => i.height)) : 1024
  const placeholders = useMemo(() => {
    let x = allBoxes.reduce((m, i) => Math.max(m, i.x + i.width + GAP), 0)
    return state.pending.map(p => {
      const shape = pendingShape(p.size, slot), parent = p.parentId ? items.find(i => i.id === p.parentId) : undefined
      const slotBox = { ...p, ...shape, x, y: parent?.y ?? 0 }
      x += shape.width + GAP
      return slotBox
    })
  }, [items, allBoxes, state.pending, slot])
  const fitAll = useCallback((extra: Box[] = []) => {
    const box = bounds([...allBoxes, ...extra])
    if (box && size.width && size.height) setView(fit(box, size.width, size.height, bottom, TOP))
  }, [allBoxes, size, bottom])
  useEffect(() => { if (!fitted.current && allBoxes.length && size.width) { fitted.current = true; fitAll() } }, [allBoxes, size, fitAll])
  // Newly arrived results (from this view or the conversation) are revealed and selected.
  useEffect(() => {
    if (!state.canvas) return
    const entries = [...items, ...compositions], key = entries.map(i => i.id).join(',')
    // The first loaded state is the baseline; anything after it is new, including a first image.
    if (seen.current !== undefined && key !== seen.current && entries.length) {
      const known = new Set(seen.current.split(',')), fresh = entries.filter(i => !known.has(i.id))
      // Reveal what just arrived at a readable size; the fit button still shows everything.
      if (fresh.length) { const box = bounds(fresh); if (box && size.width) setView(fit(box, size.width, size.height, bottom, TOP)); setSelected(fresh.at(-1)!.id); setEditing(false) }
    }
    seen.current = key
  }, [items, compositions, fitAll, state.canvas, size])
  const pendingKeys = state.pending.map(p => p.key).join(',')
  useEffect(() => { if (pendingKeys) fitAll(placeholders) }, [pendingKeys]) // eslint-disable-line react-hooks/exhaustive-deps
  const item = items.find(i => i.id === selected)
  const composition = compositions.find(c => c.id === selected), opened = compositions.find(c => c.id === editorId)
  useEffect(() => { if (selected && !item && !composition) setSelected(undefined) }, [selected, item, composition])
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
  const handoff = async (action: (() => Promise<Outcome>) | undefined, success: string) => {
    try {
      const outcome = await action?.()
      flash(outcome === 'filled' ? success : outcome === 'copied' ? '已复制，可粘贴到原对话中' : outcome === 'busy' ? '对话正在提交，请稍后再试' : '请先打开这张画布所属的对话')
    } catch (error) { flash(error instanceof Error ? error.message : '无法写入对话输入框') }
  }
  const submit = () => {
    const text = prompt.trim()
    if (!text || inConversation) return
    if (editing && item) void model.generate({ prompt: text, images: [`item:${item.id}`], title: `${labelOf(item)} · 编辑`, ...(genSize ? { size: genSize } : {}) }, item.id)
    else void model.generate({ prompt: text, ...(genSize ? { size: genSize } : {}) })
    setPrompt(''); setEditing(false)
  }
  const remove = () => { if (item) void model.remove(item.id); else if (composition) void model.deleteComposition(composition.id); setConfirming(false) }
  const operate = async (action: () => Promise<void>) => {
    if (operation.current) return
    operation.current = true; setOperationBusy(true); setOperationError('')
    try { await action() } catch (error) { setOperationError(error instanceof Error ? error.message : '操作失败') }
    finally { operation.current = false; setOperationBusy(false) }
  }
  const createBoard = () => operate(async () => { if (item) { const created = await model.createComposition(item.id); setSelected(created.id); setEditorId(created.id) } })
  const split = () => operate(async () => {
    if (!splitSource) return
    const source = splitSource
    setSplitSource(undefined)
    const created = await model.decompose({ image: `item:${source.id}`, prompt: splitPrompt, maxImages })
    setSelected(created.id); setEditorId(created.id)
  })
  const startEdit = () => {
    setConfirming(false)
    if (inConversation) { if (item) void handoff(conversation && (() => conversation.edit(item)), '已引用图片，请在对话中描述修改要求'); return }
    setEditing(true); requestAnimationFrame(() => host.current?.querySelector<HTMLTextAreaElement>('.sd-composer textarea')?.focus())
  }
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input,textarea,select,button')) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && (item || composition)) { e.preventDefault(); setConfirming(true) }
    else if (e.key === 'Tab' && item) { e.preventDefault(); startEdit() }
    else if (e.key === 'Escape') { setEditing(false); setConfirming(false); setSelected(undefined) }
    else if (e.key === '0' && mod) { e.preventDefault(); fitAll() }
  }
  const toolbar = useRef<HTMLDivElement>(null), [toolbarWidth, setToolbarWidth] = useState(280), [toolbarHeight, setToolbarHeight] = useState(42)
  useLayoutEffect(() => {
    const el = toolbar.current; if (!el) return
    const measure = () => { setToolbarWidth(el.offsetWidth); setToolbarHeight(el.offsetHeight) }
    measure(); const observer = new ResizeObserver(measure); observer.observe(el); return () => observer.disconnect()
  }, [item?.id, composition?.id, confirming, inConversation, editorId])
  const viewControls = useRef<HTMLDivElement>(null), [viewControlsBottom, setViewControlsBottom] = useState(58)
  useLayoutEffect(() => {
    const el = viewControls.current; if (!el) return
    const measure = () => setViewControlsBottom(el.offsetTop + el.offsetHeight + 8)
    measure(); const observer = new ResizeObserver(measure); observer.observe(el); return () => observer.disconnect()
  }, [editorId])
  // Floating controls stay inside the canvas even when the image extends past its edge.
  const inside = (left: number, width: number) => clamp(left, 8, Math.max(8, size.width - width - 8))
  const screen = (b: Box) => ({ left: view.x + b.x * view.scale, top: view.y + b.y * view.scale, width: b.width * view.scale, height: b.height * view.scale })
  const box = item ? screen(item) : composition ? screen(composition) : undefined
  // Keep selected-image actions below the floating view controls, including when they wrap.
  const labelTop = box ? Math.max(viewControlsBottom, box.top - 24) : 0
  const toolbarTop = box ? (labelTop - toolbarHeight - 10 >= viewControlsBottom ? labelTop - toolbarHeight - 10 : labelTop + 26) : 0
  const labelWidth = box ? Math.min(Math.max(box.width, 180), size.width - 16) : 0
  const waiting = state.pending.some(p => p.key.startsWith('local-'))
  const reviewWarning = item?.warnings?.join('；')
  const error = operationError || state.error, toast = notice || (reviewWarning ? undefined : state.message)
  const dots = Math.max(8, 24 * view.scale)
  const empty = !items.length && !compositions.length && !state.pending.length && !state.loading
  if (opened) return <LayerEditor key={opened.id} model={model} initial={opened} conversation={conversation} onOpenCopy={setEditorId} onClose={() => { setEditorId(undefined); setSelected(opened.id) }}/>
  return <div className="sd-canvas-shell">
    <div className="sd-canvas-bar" ref={viewControls}>
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
    <div className="sd-canvas" data-mode={inConversation ? 'conversation' : 'board'} ref={host} tabIndex={0} onKeyDown={onKey}
    style={{ backgroundSize: `${dots}px ${dots}px`, backgroundPosition: `${view.x}px ${view.y}px` }}>
    {size.width > 0 ? <Stage ref={stage} width={size.width} height={size.height} x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}
      draggable onWheel={onWheel}
      onMouseDown={e => { if (e.target === e.target.getStage()) { setSelected(undefined); setEditing(false); host.current?.focus() } }}
      onDragMove={e => { if (e.target === e.target.getStage()) setView(v => ({ ...v, x: e.target.x(), y: e.target.y() })) }}
      onDragEnd={e => { if (e.target === e.target.getStage()) setView(v => ({ ...v, x: e.target.x(), y: e.target.y() })) }}>
      <Layer>
        {items.map(i => <Picture key={i.id} item={i} sessionId={model.sessionId} selected={i.id === selected} hovered={i.id === hovered} scale={view.scale}
          onSelect={id => { setSelected(id); if (id !== selected) setEditing(false); host.current?.focus() }} onHover={setHovered} onMove={onMove}/>)}
        {compositions.map(c => <Artboard key={c.id} composition={c} sessionId={model.sessionId} selected={c.id === selected} scale={view.scale} onSelect={id => { setSelected(id); setEditing(false); host.current?.focus() }} onMove={onMove} onOpen={() => setEditorId(c.id)}/>)}
      </Layer>
    </Stage> : null}
    {placeholders.map(p => <PendingCard key={p.key} pending={p} rect={screen(p)}/>)}
    {empty ? <div className="sd-empty">
      <div className="sd-empty-icon"><ImageIcon size={22}/></div>
      <strong>{inConversation ? '这个对话的画布' : '新画布'}</strong>
      <p>{inConversation ? '在对话中描述画面，Seedream 生成的图片会出现在这里。选中图片后可回到同一个对话继续修改。' : '描述你想要的画面，生成第一张图。这个画布不属于任何对话。'}</p>
      <div className="sd-examples">{EXAMPLES.map(x => <button key={x} type="button" onClick={() => {
        if (inConversation) void handoff(conversation && (() => conversation.prompt(x)), '示例已填入对话，可修改后发送')
        else { setPrompt(x); host.current?.querySelector<HTMLTextAreaElement>('.sd-composer textarea')?.focus() }
      }}>{x}</button>)}</div>
    </div> : null}
    {item && box ? <>
      <div className="sd-label" style={{ left: inside(box.left, labelWidth), top: labelTop, width: labelWidth }}>
        <span className="sd-label-title"><ImageIcon size={12}/>{labelOf(item)}{item.edit?.needsReview ? ' · 需检查' : ''}</span><span className="sd-label-size">{item.width} × {item.height}</span>
      </div>
      <div className="sd-float" ref={toolbar} role="toolbar" aria-label="图片操作" style={{ left: inside(box.left, toolbarWidth), top: toolbarTop }}>
        {confirming ? <>
          <span className="sd-float-text">删除这张图？本机文件也会删除</span>
          <button className="sd-float-danger" onClick={remove}>删除</button>
          <button onClick={() => setConfirming(false)}>取消</button>
        </> : <>
          <button onClick={() => editing ? setEditing(false) : startEdit()} aria-pressed={editing}><EditIcon/>编辑<kbd>Tab</kbd></button>
          <button disabled={operationBusy || state.pending.some(p => p.parentId === item.id)} onClick={() => { setSplitSource(item); setOperationError('') }}><LayersIcon/>分图层</button>
          <button disabled={operationBusy || state.pending.some(p => p.parentId === item.id)} onClick={() => setEditSource(item)} title="去背景、涂抹消除、扩图">AI 处理</button>
          <button disabled={operationBusy} onClick={() => { void createBoard() }} title="创建可添加文字与图形的画板，不调用模型">加文字 / 图形</button>
          {inConversation ? <button onClick={() => { void handoff(conversation && (() => conversation.reference(item)), '已引用到对话输入框') }} title="引用到对话输入框"><QuoteIcon/>引用</button> : null}
          <span className="sd-float-sep"/>
          <a href={imageUrl(model.sessionId, item.id, true)} download={`${labelOf(item)}.png`} title="下载原图" aria-label="下载"><DownloadIcon/></a>
          <button onClick={() => setConfirming(true)} title="删除" aria-label="删除"><TrashIcon/></button>
        </>}
      </div>
    </> : null}
    {composition && box ? <>
      <div className="sd-label" style={{ left: inside(box.left, labelWidth), top: labelTop, width: labelWidth }}><span className="sd-label-title"><LayersIcon/>{composition.title}</span><span className="sd-label-size">{composition.layers.length} 层</span></div>
      <div className="sd-float" ref={toolbar} role="toolbar" aria-label="画板操作" style={{ left: inside(box.left, toolbarWidth), top: toolbarTop }}>
        {confirming ? <><span className="sd-float-text">删除画板？原图和素材会保留</span><button className="sd-float-danger" onClick={remove}>删除</button><button onClick={() => setConfirming(false)}>取消</button></> : <>
          <button onClick={() => setEditorId(composition.id)}><LayersIcon/>编辑图层</button>
          <button disabled={operationBusy} onClick={() => { void operate(async () => { const png = await renderLayers(model.sessionId, composition.layers, { x: 0, y: 0, width: composition.width, height: composition.height }, composition.background); downloadPng(png, composition.title) }) }} title="导出画板 PNG" aria-label="导出画板 PNG"><DownloadIcon/></button>
          <button disabled={operationBusy} onClick={() => { void operate(async () => { const bytes = await exportPsd(model.sessionId, composition); downloadFile(bytes, composition.title, 'psd', 'image/vnd.adobe.photoshop'); flash('分层 PSD 已导出') }) }} title="导出独立图层及可编辑文字">PSD</button>
          <button onClick={() => setConfirming(true)} title="删除画板" aria-label="删除画板"><TrashIcon/></button>
        </>}
      </div>
    </> : null}
    <div className="sd-bottom">
      {toast ? <div className="sd-toast" role="status">{toast}</div> : null}
      {error ? <div className="sd-error" role="alert"><span>{error}</span><button type="button" className="sd-icon-button sd-icon-small" onClick={() => { model.dismiss(); setOperationError('') }} aria-label="关闭"><CloseIcon size={12}/></button></div> : null}
      {reviewWarning ? <div className="sd-review-warning" role="status">{reviewWarning}</div> : null}
      {inConversation ? <button className="sd-conversation-link" onClick={() => { void handoff(conversation?.focus, '请在对话输入框继续描述') }}><QuoteIcon size={14}/>回到对话继续描述</button> : <Composer value={prompt} onChange={setPrompt} onSubmit={submit} onStop={() => model.cancel()} waiting={waiting} autoFocus={empty && active}
        placeholder={editing ? '描述要修改的地方，以及需要保持不变的部分…' : '描述你想生成的画面…'}
        context={editing && item ? <span className="sd-context-chip"><img src={imageUrl(model.sessionId, item.id)} alt=""/>编辑 · {labelOf(item)}</span> : undefined}
        onClearContext={() => setEditing(false)}
        hint={waiting ? '生成中…' : '每次生成都会计费'}>
        <SizePicker value={genSize} onChange={setGenSize} fallback={defaultSize}/>
      </Composer>}
    </div>
    </div>
    {splitSource ? <div className="sd-split-backdrop"><div className="sd-split-dialog" role="dialog" aria-modal="true" aria-label="拆分图层" onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setSplitSource(undefined) }}>
      <div className="sd-split-title"><LayersIcon/><strong>拆分图层</strong><button className="sd-icon-button" aria-label="关闭分层设置" onClick={() => setSplitSource(undefined)}><CloseIcon/></button></div>
      <p>原图会保留，分层结果将放进新的可编辑画板。</p>
      <label>分层说明<textarea value={splitPrompt} onChange={e => setSplitPrompt(e.target.value)} rows={3} maxLength={4000}/></label>
      <label>最多输出图片数（含底图）<input type="number" min={2} max={100} value={maxImages} onChange={e => setMaxImages(Number(e.target.value))}/></label>
      <p className="sd-split-cost">此操作调用 Seedream，按实际返回图片数计费。之后拖动、加字和导出均在本地完成。</p>
      <div className="sd-split-actions"><button className="sd-button" onClick={() => setSplitSource(undefined)}>取消</button><button className="sd-button sd-button-primary" disabled={operationBusy || !Number.isInteger(maxImages) || maxImages < 2 || maxImages > 100} onClick={() => { void split() }}>开始分层</button></div>
    </div></div> : null}
    {editSource ? <ImageEditDialog key={editSource.id} model={model} source={editSource} initialOperation="remove-background" onClose={() => setEditSource(undefined)} onComplete={result => setSelected(result.id)}/> : null}
  </div>
}
