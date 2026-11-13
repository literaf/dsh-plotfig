import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent } from 'react'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { Group, Layer, Rect, Stage, Transformer } from 'react-konva'
import type { CanvasLayer, Composition, LayerKind } from '../shared/types.js'
import { alignLayers, layerBounds, layersBounds, MAX_LAYERS } from '../shared/layers.js'
import type { LayerBox } from '../shared/layers.js'
import type { CanvasModel } from './controller.js'
import { imageUrl } from './controller.js'
import type { ConversationActions } from './handoff.js'
import { LayerContent, renderLayers, downloadPng } from './layer-render.js'
import { DownloadIcon, FitIcon, MinusIcon, PlusIcon, QuoteIcon, RedoIcon, TrashIcon, UndoIcon } from './icons.js'

const ACCENT = '#3b6cf6'
const DEFAULT_FONT = 'Arial, PingFang SC, Microsoft YaHei, sans-serif'
const normalAngle = (value: number) => ((value + 180) % 360 + 360) % 360 - 180
const copy = (l: CanvasLayer): CanvasLayer => ({ ...l, id: crypto.randomUUID(), name: `${l.name} 副本`, x: l.x + 32, y: l.y + 32, locked: false })
const selectedBox = (layers: CanvasLayer[], selected: string[]) => layersBounds(layers.filter(l => selected.includes(l.id)))

export function LayerEditor({ model, initial, onClose, onOpenCopy, conversation }: {
  model: CanvasModel; initial: Composition; onClose(): void; onOpenCopy(id: string): void; conversation?: ConversationActions | undefined
}) {
  const editor = model.editor(initial), state = useSyncExternalStore(editor.subscribe, editor.getSnapshot)
  const c = state.composition, layers = c.layers
  const host = useRef<HTMLDivElement>(null), area = useRef<HTMLDivElement>(null), stage = useRef<Konva.Stage>(null), transformer = useRef<Konva.Transformer>(null)
  const nodes = useRef(new Map<string, Konva.Group>()), transformFrame = useRef<number>()
  const [size, setSize] = useState({ width: 0, height: 0 }), [view, setView] = useState({ x: 0, y: 0, scale: 0.3 })
  const [selected, setSelected] = useState<string[]>([]), [hand, setHand] = useState(false), [space, setSpace] = useState(false)
  const [panel, setPanel] = useState(true), [menu, setMenu] = useState(false), [exportMenu, setExportMenu] = useState(false)
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [localError, setLocalError] = useState('')
  const [marquee, setMarquee] = useState<LayerBox>(), marqueeStart = useRef<{ x: number; y: number; keep: string[] }>()
  const dragStart = useRef<{ id: string; x: number; y: number; layers: CanvasLayer[] }>()
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>()
  const panning = hand || space, chosen = layers.filter(l => selected.includes(l.id)), one = chosen.length === 1 ? chosen[0] : undefined
  const editable = chosen.filter(l => !l.locked && !l.hidden)
  const flash = (text: string) => { clearTimeout(noticeTimer.current); setNotice(text); noticeTimer.current = setTimeout(() => setNotice(''), 3000) }
  useEffect(() => {
    const current = editor.getSnapshot()
    if (!current.dirty && initial.version > current.composition.version) editor.reload(initial)
  }, [editor, initial])
  useEffect(() => () => { clearTimeout(noticeTimer.current); if (transformFrame.current !== undefined) cancelAnimationFrame(transformFrame.current) }, [])
  useLayoutEffect(() => {
    const element = area.current; if (!element) return
    const resize = () => setSize({ width: element.clientWidth, height: element.clientHeight }), observer = new ResizeObserver(resize)
    resize(); observer.observe(element); return () => observer.disconnect()
  }, [])
  const fit = useCallback((all = false) => {
    if (!size.width || !size.height) return
    const boxes = [{ x: 0, y: 0, width: c.width, height: c.height }, ...(all ? layers.filter(l => !l.hidden).map(layerBounds) : [])]
    const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y)), width = Math.max(...boxes.map(b => b.x + b.width)) - x, height = Math.max(...boxes.map(b => b.y + b.height)) - y
    const scale = Math.max(0.01, Math.min((size.width - 96) / width, (size.height - 112) / height, 1))
    setView({ x: (size.width - width * scale) / 2 - x * scale, y: (size.height - height * scale) / 2 - y * scale, scale })
  }, [size, c.width, c.height, layers])
  const fitted = useRef(false)
  useEffect(() => { if (!fitted.current && size.width) { fitted.current = true; fit(true) } }, [fit, size])
  useEffect(() => { setSelected(s => s.filter(id => layers.some(l => l.id === id))) }, [layers])
  useEffect(() => {
    transformer.current?.nodes(editable.map(l => nodes.current.get(l.id)).filter((n): n is Konva.Group => !!n))
    transformer.current?.getLayer()?.batchDraw()
  }, [layers, selected, panning])
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (editor.getSnapshot().dirty) { e.preventDefault(); e.returnValue = '' } }
    const reset = () => setSpace(false)
    window.addEventListener('beforeunload', warn); window.addEventListener('blur', reset)
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('blur', reset) }
  }, [editor])
  const changeLayers = (update: (layers: CanvasLayer[]) => CanvasLayer[], group?: string) => { if (!busy) editor.change(current => ({ ...current, layers: update(current.layers) }), group) }
  const patch = (id: string, value: Partial<CanvasLayer>, group?: string) => changeLayers(ls => ls.map(l => l.id === id ? { ...l, ...value } : l), group)
  const remove = () => { const ids = new Set(editable.map(l => l.id)); changeLayers(ls => ls.filter(l => !ids.has(l.id))); setSelected([]) }
  const duplicate = () => {
    if (!editable.length) return
    if (layers.length + editable.length > MAX_LAYERS) { flash(`最多 ${MAX_LAYERS} 个图层`); return }
    const added = editable.map(copy); changeLayers(ls => [...ls, ...added]); setSelected(added.map(l => l.id))
  }
  const add = (kind: Exclude<LayerKind, 'image'>) => {
    if (layers.length >= MAX_LAYERS) { flash(`最多 ${MAX_LAYERS} 个图层`); return }
    const width = Math.max(120, c.width * 0.3), height = kind === 'text' ? Math.max(80, c.height * 0.12) : Math.max(100, c.height * 0.2)
    const layer: CanvasLayer = { id: crypto.randomUUID(), kind, name: kind === 'text' ? '文字' : kind === 'rect' ? '矩形' : '圆形',
      x: (c.width - width) / 2, y: (c.height - height) / 2, width, height, rotation: 0, opacity: 1, hidden: false, locked: false,
      ...(kind === 'text' ? { text: '双击编辑文字', fontSize: Math.max(24, c.width / 28), fontFamily: DEFAULT_FONT, bold: false, italic: false, align: 'left' as const, fill: '#20242c' }
        : { fill: '#dbeafe', stroke: '#3b6cf6', strokeWidth: Math.max(2, c.width / 800) }) }
    changeLayers(ls => [...ls, layer]); setSelected([layer.id]); setPanel(true); setHand(false); area.current?.focus()
  }
  const align = (value: Parameters<typeof alignLayers>[2]) => { changeLayers(ls => alignLayers(ls, new Set(selected), value)); setMenu(false) }
  const order = (direction: 'front' | 'back' | 'up' | 'down') => {
    const ids = new Set(editable.map(l => l.id))
    changeLayers(ls => {
      if (direction === 'front') return [...ls.filter(l => !ids.has(l.id)), ...ls.filter(l => ids.has(l.id))]
      if (direction === 'back') return [...ls.filter(l => ids.has(l.id)), ...ls.filter(l => !ids.has(l.id))]
      const next = [...ls]
      if (direction === 'up') { for (let i = next.length - 2; i >= 0; i--) if (ids.has(next[i]!.id) && !ids.has(next[i + 1]!.id)) [next[i], next[i + 1]] = [next[i + 1]!, next[i]!] }
      else { for (let i = 1; i < next.length; i++) if (ids.has(next[i]!.id) && !ids.has(next[i - 1]!.id)) [next[i], next[i - 1]] = [next[i - 1]!, next[i]!] }
      return next
    }); setMenu(false)
  }
  const select = (id: string, append = false) => {
    setSelected(s => append ? s.includes(id) ? s.filter(x => x !== id) : [...s, id] : s.includes(id) ? s : [id])
    area.current?.focus()
  }
  const pointer = () => {
    const p = stage.current?.getPointerPosition(); return p ? { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale } : undefined
  }
  const startMarquee = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (panning || ('button' in e.evt && e.evt.button !== 0)) return
    const p = pointer(); if (!p) return
    const keep = 'shiftKey' in e.evt && e.evt.shiftKey ? selected : []
    marqueeStart.current = { ...p, keep }; setSelected(keep); setMarquee({ ...p, width: 0, height: 0 }); area.current?.focus()
  }
  const endMarquee = () => {
    if (marquee && marqueeStart.current && (marquee.width > 2 || marquee.height > 2)) {
      const hits = layers.filter(l => {
        if (l.locked || l.hidden) return false
        const b = layerBounds(l); return b.x <= marquee.x + marquee.width && b.x + b.width >= marquee.x && b.y <= marquee.y + marquee.height && b.y + b.height >= marquee.y
      }).map(l => l.id)
      setSelected([...new Set([...marqueeStart.current.keep, ...hits])])
    }
    marqueeStart.current = undefined; setMarquee(undefined)
  }
  const zoom = (factor: number, p = { x: size.width / 2, y: size.height / 2 }) => setView(v => {
    const scale = Math.max(0.01, Math.min(8, v.scale * factor)), k = scale / v.scale
    return { scale, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k }
  })
  const finishTransform = () => {
    if (transformFrame.current !== undefined) return
    transformFrame.current = requestAnimationFrame(() => {
      transformFrame.current = undefined
      const changes = new Map<string, Partial<CanvasLayer>>()
      for (const l of editable) {
        const node = nodes.current.get(l.id); if (!node) continue
        const sx = node.scaleX(), sy = node.scaleY()
        changes.set(l.id, { x: node.x(), y: node.y(), width: Math.max(1, l.width * sx), height: Math.max(1, l.height * sy), rotation: normalAngle(node.rotation()), ...(l.kind === 'text' ? { fontSize: Math.max(1, Math.min(2000, (l.fontSize ?? 36) * sy)) } : {}) })
        node.scale({ x: 1, y: 1 })
      }
      changeLayers(ls => ls.map(l => changes.has(l.id) ? { ...l, ...changes.get(l.id) } : l))
    })
  }
  const getOutput = async (selection: boolean) => {
    const outputLayers = selection ? layers.filter(l => selected.includes(l.id)) : layers
    let box = selection ? layersBounds(outputLayers) : { x: 0, y: 0, width: c.width, height: c.height }
    if (!box) throw new Error('请先选择要导出的可见图层。')
    if (selection) { const pad = Math.max(0, ...outputLayers.map(l => (l.strokeWidth ?? 0) / 2)); box = { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 } }
    const png = await renderLayers(model.sessionId, outputLayers, box, selection ? 'transparent' : c.background)
    return { png, box: { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.x + box.width) - Math.floor(box.x), height: Math.ceil(box.y + box.height) - Math.floor(box.y) } }
  }
  const task = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setLocalError(''); setMenu(false); setExportMenu(false)
    try { await action() } catch (error) { setLocalError(error instanceof Error ? error.message : '操作失败') } finally { setBusy(false) }
  }
  const exportPng = (selection: boolean) => task(async () => { const { png } = await getOutput(selection); downloadPng(png, selection ? `${c.title} · 选中图层` : c.title); flash('PNG 已导出') })
  const merge = () => task(async () => {
    const selectedLayers = layers.filter(l => selected.includes(l.id) && !l.hidden)
    if (selectedLayers.length < 2 || selectedLayers.some(l => l.locked)) throw new Error('请选择至少两个未锁定的可见图层。')
    const { png, box } = await getOutput(true), item = await model.importComposite(png, '合并图层')
    const ids = new Set(selectedLayers.map(l => l.id)), last = layers.findLastIndex(l => ids.has(l.id))
    const merged: CanvasLayer = { id: crypto.randomUUID(), kind: 'image', name: '合并图层', assetId: item.id, ...box, opacity: 1, rotation: 0, hidden: false, locked: false }
    changeLayers(ls => ls.flatMap((l, index) => index === last ? [merged] : ids.has(l.id) ? [] : [l])); setSelected([merged.id]); flash('已合并，原图层可撤销恢复')
  })
  const reference = () => task(async () => {
    if (!conversation) return
    const { png } = await getOutput(selected.length > 0), item = await model.importComposite(png, selected.length ? `${c.title} · 选中图层` : c.title)
    const outcome = await conversation.reference(item)
    flash(outcome === 'filled' ? '已引用到对话输入框' : outcome === 'copied' ? '已复制，可粘贴到原对话中' : outcome === 'busy' ? '对话正在提交，请稍后再试' : '请打开所属对话后引用')
  })
  const saveAsImage = () => task(async () => {
    const { png } = await getOutput(false); await model.importComposite(png, c.title, false)
    if (await editor.flush()) onClose()
  })
  const saveCopy = () => task(async () => {
    const created = await model.createComposition(c.sourceId, { ...c, title: `${c.title.slice(0, 195)} · 副本` })
    const latest = model.getSnapshot().canvas?.compositions?.find(v => v.id === c.id)
    if (latest) editor.reload(latest)
    onOpenCopy(created.id)
  })
  const close = () => task(async () => { if (await editor.flush()) onClose() })
  const onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (target.closest('input,textarea,select,[contenteditable=true]')) return
    if (busy) return
    const modifier = event.metaKey || event.ctrlKey
    if (event.code === 'Space') { event.preventDefault(); setSpace(true); return }
    if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? editor.redo() : editor.undo() }
    else if (modifier && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(layers.filter(l => !l.hidden && !l.locked).map(l => l.id)) }
    else if (modifier && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicate() }
    else if (modifier && event.key === '0') { event.preventDefault(); fit(true) }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove() }
    else if (event.key === 'Escape') { setSelected([]); setMenu(false); setExportMenu(false) }
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); const step = event.shiftKey ? 10 : 1, dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
      changeLayers(ls => ls.map(l => selected.includes(l.id) && !l.locked ? { ...l, x: l.x + dx, y: l.y + dy } : l), 'nudge')
    }
  }
  return <div className="sd-layer-editor" ref={host} onKeyDown={onKey} onKeyUp={event => { if (event.code === 'Space') setSpace(false) }} data-testid="layer-editor">
    <div className="sd-editor-head">
      <button className="sd-button" onClick={() => { void close() }} disabled={busy}>‹ 画布</button>
      <div className="sd-editor-heading"><strong title={c.title}>{c.title}</strong><span role="status">{state.error ? '尚未保存' : state.saving || state.dirty ? '保存中…' : '已保存'} · {layers.length} 个图层</span></div>
      <button className="sd-icon-button" onClick={() => setPanel(!panel)} aria-pressed={panel} title="图层与属性" aria-label="图层与属性"><LayersIcon/></button>
      <div className="sd-editor-menu-anchor">
        <button className="sd-button" onClick={() => setExportMenu(!exportMenu)} disabled={busy}><DownloadIcon/>导出</button>
        {exportMenu ? <div className="sd-editor-menu" role="menu">
          <button role="menuitem" onClick={() => { void exportPng(false) }}>画板 PNG</button>
          <button role="menuitem" disabled={!chosen.length} onClick={() => { void exportPng(true) }}>选中内容 PNG</button>
          <button role="menuitem" onClick={() => { void saveAsImage() }}>保存为画布图片</button>
        </div> : null}
      </div>
    </div>
    <div className="sd-editor-tools" role="toolbar" aria-label="图层编辑工具">
      <button onClick={() => setHand(false)} aria-pressed={!hand} title="选择图层">选择</button><button onClick={() => setHand(true)} aria-pressed={hand} title="拖动画布（按住空格）">抓手</button><span/>
      <button disabled={busy} onClick={() => add('text')} title="添加文字">T 文字</button><button disabled={busy} onClick={() => add('rect')} title="添加矩形">▭ 矩形</button><button disabled={busy} onClick={() => add('ellipse')} title="添加圆形">○ 圆形</button><span/>
      <button onClick={() => editor.undo()} disabled={busy || !state.canUndo} title="撤销 (⌘Z)" aria-label="撤销编辑"><UndoIcon/></button>
      <button onClick={() => editor.redo()} disabled={busy || !state.canRedo} title="重做 (⇧⌘Z)" aria-label="重做编辑"><RedoIcon/></button>
      <button onClick={remove} disabled={busy || !editable.length} title="删除选中图层" aria-label="删除选中图层"><TrashIcon/></button>
      <div className="sd-editor-menu-anchor">
        <button onClick={() => setMenu(!menu)} disabled={busy || !chosen.length} aria-expanded={menu}>更多 ⋯</button>
        {menu ? <div className="sd-editor-menu" role="menu">
          <button role="menuitem" onClick={() => { duplicate(); setMenu(false) }} disabled={!editable.length}>复制图层</button>
          <button role="menuitem" onClick={() => { void merge() }} disabled={editable.length < 2 || busy || chosen.some(l => l.locked)}>合并图层</button>
          <button role="menuitem" onClick={() => align('grid')} disabled={editable.length < 2}>自动整理</button><hr/>
          {([['left', '左对齐'], ['center', '水平居中'], ['right', '右对齐'], ['top', '顶对齐'], ['middle', '垂直居中'], ['bottom', '底对齐']] as const).map(([v, name]) => <button role="menuitem" key={v} disabled={editable.length < 2} onClick={() => align(v)}>{name}</button>)}<hr/>
          {([['front', '置于顶层'], ['up', '上移一层'], ['down', '下移一层'], ['back', '置于底层']] as const).map(([v, name]) => <button role="menuitem" key={v} disabled={!editable.length} onClick={() => order(v)}>{name}</button>)}
        </div> : null}
      </div>
      {conversation ? <button disabled={busy} onClick={() => { void reference() }} title={selected.length ? '引用选中内容到对话' : '引用整张画板到对话'}><QuoteIcon/>引用</button> : null}
    </div>
    {state.error || localError ? <div className="sd-editor-error" role="alert"><span>{localError || state.error}</span>{state.error ? <><button className="sd-button" onClick={() => { void editor.flush() }} disabled={busy || state.saving}>重试保存</button><button className="sd-button" onClick={() => { void saveCopy() }} disabled={busy || state.saving}>另存副本</button></> : <button className="sd-button" onClick={() => setLocalError('')}>关闭</button>}</div> : null}
    {c.warnings?.length ? <details className="sd-editor-warning"><summary>分层结果有 {c.warnings.length} 条提示</summary>{c.warnings.map((w, i) => <p key={i}>{w}</p>)}</details> : null}
    <div className="sd-editor-body">
      <div className="sd-editor-stage" ref={area} tabIndex={0} style={{ cursor: panning ? 'grab' : 'default' }}>
        {size.width > 0 ? <Stage ref={stage} width={size.width} height={size.height} x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale} draggable={panning}
          onWheel={e => { e.evt.preventDefault(); if (e.evt.ctrlKey || e.evt.metaKey) zoom(Math.exp(-e.evt.deltaY * 0.01), stage.current?.getPointerPosition() ?? undefined); else setView(v => ({ ...v, x: v.x - e.evt.deltaX, y: v.y - e.evt.deltaY })) }}
          onDragEnd={e => { if (e.target === stage.current) setView(v => ({ ...v, x: e.target.x(), y: e.target.y() })) }}
          onMouseDown={e => { if (e.target === stage.current || e.target.name() === 'artboard') startMarquee(e) }}
          onMouseMove={() => { const start = marqueeStart.current, p = pointer(); if (start && p) setMarquee({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) }) }}
          onMouseUp={endMarquee} onMouseLeave={endMarquee}>
          <Layer>
            <Rect name="artboard" width={c.width} height={c.height} fill={c.background === 'transparent' ? '#ffffff' : c.background} stroke="#a4a9b3" strokeWidth={1 / view.scale} shadowColor="#000" shadowBlur={16 / view.scale} shadowOpacity={0.08}/>
            {layers.filter(l => !l.hidden).map(l => <Group key={l.id} ref={n => { if (n) nodes.current.set(l.id, n); else nodes.current.delete(l.id) }} id={l.id} x={l.x} y={l.y} rotation={l.rotation} opacity={l.opacity}
              draggable={!panning && !l.locked && !busy}
              onMouseDown={e => { if (panning) return; e.cancelBubble = true; if (l.locked) startMarquee(e); else select(l.id, e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey) }}
              onTouchStart={e => { if (!panning && !l.locked) { e.cancelBubble = true; select(l.id) } }}
              onDblClick={() => { if (l.kind === 'text' && !l.locked) { setSelected([l.id]); setPanel(true); requestAnimationFrame(() => host.current?.querySelector<HTMLTextAreaElement>('[aria-label="文字内容"]')?.focus()) } }}
              onDragStart={e => { e.cancelBubble = true; const ids = selected.includes(l.id) ? selected : [l.id]; setSelected(ids); dragStart.current = { id: l.id, x: l.x, y: l.y, layers: layers.filter(n => ids.includes(n.id) && !n.locked) } }}
              onDragMove={e => { e.cancelBubble = true; const start = dragStart.current; if (!start) return; const dx = e.target.x() - start.x, dy = e.target.y() - start.y; for (const other of start.layers) if (other.id !== l.id) nodes.current.get(other.id)?.position({ x: other.x + dx, y: other.y + dy }) }}
              onDragEnd={e => { e.cancelBubble = true; const start = dragStart.current; dragStart.current = undefined; if (!start) return; const dx = e.target.x() - start.x, dy = e.target.y() - start.y, ids = new Set(start.layers.map(n => n.id)); changeLayers(ls => ls.map(n => ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) }}
              onTransformEnd={finishTransform}>
              <LayerContent layer={l} sessionId={model.sessionId}/>
            </Group>)}
            <Transformer ref={transformer} visible={!panning} rotateEnabled flipEnabled={false} keepRatio={chosen.every(l => l.kind === 'image')} padding={2} borderStroke={ACCENT} anchorStroke={ACCENT} anchorFill="#fff" anchorSize={8}
              boundBoxFunc={(old, next) => Math.abs(next.width) < 8 || Math.abs(next.height) < 8 ? old : next}/>
            {marquee ? <Rect {...marquee} stroke={ACCENT} strokeWidth={1 / view.scale} fill="#3b6cf622" listening={false}/> : null}
          </Layer>
        </Stage> : null}
        <div className="sd-editor-frame-label" style={{ left: view.x, top: view.y - 24 }}>{c.width} × {c.height}<span>画板</span></div>
        <div className="sd-editor-hint">{chosen.length ? `已选择 ${chosen.length} 个图层 · Shift 多选` : '拖动元素或框选 · 按住空格移动画布'}</div>
        <div className="sd-zoom">
          <button onClick={() => zoom(1 / 1.2)} aria-label="缩小图层画布"><MinusIcon/></button><button className="sd-zoom-value" onClick={() => fit(true)} title="查看全部图层">{Math.round(view.scale * 100)}%</button><button onClick={() => zoom(1.2)} aria-label="放大图层画布"><PlusIcon/></button><button onClick={() => fit(false)} title="适应画板" aria-label="适应画板"><FitIcon/></button>
        </div>
        {notice ? <div className="sd-toast" role="status">{notice}</div> : null}
        {busy ? <div className="sd-editor-busy" role="status"><span className="sd-spinner"/>正在处理…</div> : null}
      </div>
      {panel ? <aside className="sd-layer-panel" aria-label="图层与属性面板">
        <div className="sd-layer-panel-title">图层<span>{layers.length}</span></div>
        <div className="sd-layer-list" role="listbox" aria-label="图层列表" aria-multiselectable="true">
          {[...layers].reverse().map(l => <div key={l.id} className="sd-layer-row" data-selected={selected.includes(l.id)} data-hidden={l.hidden}>
            <button className="sd-layer-select" role="option" aria-selected={selected.includes(l.id)} onClick={e => select(l.id, e.shiftKey || e.metaKey || e.ctrlKey)} title={l.name}>
              <span className="sd-layer-thumb">{l.kind === 'image' ? <img src={imageUrl(model.sessionId, l.assetId!)} alt="" loading="lazy"/> : l.kind === 'text' ? 'T' : l.kind === 'rect' ? '▭' : '○'}</span><span>{l.name}</span>
            </button>
            <button className="sd-layer-state" onClick={() => patch(l.id, { hidden: !l.hidden })} aria-label={`${l.hidden ? '显示' : '隐藏'} ${l.name}`} title={l.hidden ? '显示' : '隐藏'}>{l.hidden ? '◌' : '◉'}</button>
            <button className="sd-layer-state" onClick={() => patch(l.id, { locked: !l.locked })} aria-label={`${l.locked ? '解锁' : '锁定'} ${l.name}`} title={l.locked ? '解锁' : '锁定'}>{l.locked ? '▣' : '◇'}</button>
          </div>)}
        </div>
        <div className="sd-layer-properties">
          {one ? <>
            <strong>属性{one.locked ? ' · 已锁定' : ''}</strong>
            <label>名称<input aria-label="图层名称" value={one.name} maxLength={200} disabled={busy} onChange={e => patch(one.id, { name: e.target.value }, `name:${one.id}`)}/></label>
            <fieldset disabled={one.locked || busy}>
              <div className="sd-layer-grid">{([['x', 'X'], ['y', 'Y'], ['width', '宽'], ['height', '高'], ['rotation', '角度'], ['opacity', '不透明度']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" aria-label={label} step={key === 'opacity' ? 0.1 : 1} min={key === 'opacity' ? 0 : key === 'width' || key === 'height' ? 1 : undefined} max={key === 'opacity' ? 1 : undefined} value={Math.round(one[key] * 100) / 100} onChange={e => { const value = Number(e.target.value); if (!Number.isFinite(value) || (['width', 'height'].includes(key) && value < 1) || (key === 'opacity' && (value < 0 || value > 1))) return; patch(one.id, { [key]: key === 'rotation' ? normalAngle(value) : value }, key) }}/></label>)}</div>
              {one.kind === 'text' ? <>
                <label>文字<textarea aria-label="文字内容" value={one.text} maxLength={10000} rows={3} onChange={e => patch(one.id, { text: e.target.value }, 'text')}/></label>
                <label>字体<select aria-label="字体" value={one.fontFamily} onChange={e => patch(one.id, { fontFamily: e.target.value })}><option value={DEFAULT_FONT}>无衬线</option><option value="Georgia, Songti SC, SimSun, serif">衬线</option><option value="Menlo, Consolas, monospace">等宽</option></select></label>
                <div className="sd-layer-grid"><label>字号<input type="number" aria-label="字号" min={1} max={2000} value={one.fontSize} onChange={e => { const v = Number(e.target.value); if (v > 0 && v <= 2000) patch(one.id, { fontSize: v }, 'fontSize') }}/></label><label>颜色<input aria-label="文字颜色" type="color" value={one.fill} onChange={e => patch(one.id, { fill: e.target.value }, 'fill')}/></label></div>
                <div className="sd-editor-style"><button aria-pressed={one.bold} onClick={() => patch(one.id, { bold: !one.bold })}>粗体</button><button aria-pressed={one.italic} onClick={() => patch(one.id, { italic: !one.italic })}>斜体</button><select aria-label="文字对齐" value={one.align} onChange={e => patch(one.id, { align: e.target.value as NonNullable<CanvasLayer['align']> })}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></div>
              </> : one.kind !== 'image' ? <>
                <div className="sd-layer-grid"><label>填充<input type="color" aria-label="填充颜色" value={one.fill === 'transparent' ? '#ffffff' : one.fill} onChange={e => patch(one.id, { fill: e.target.value }, 'fill')}/></label><label>描边<input type="color" aria-label="描边颜色" value={one.stroke === 'transparent' ? '#ffffff' : one.stroke} onChange={e => patch(one.id, { stroke: e.target.value }, 'stroke')}/></label></div>
                <label className="sd-layer-check"><input type="checkbox" checked={one.fill === 'transparent'} onChange={e => patch(one.id, { fill: e.target.checked ? 'transparent' : '#dbeafe' })}/>无填充</label>
                <label>描边宽度<input type="number" aria-label="描边宽度" min={0} max={1000} value={one.strokeWidth} onChange={e => { const v = Number(e.target.value); if (v >= 0 && v <= 1000) patch(one.id, { strokeWidth: v }, 'strokeWidth') }}/></label>
              </> : null}
            </fieldset>
          </> : chosen.length ? <><strong>已选择 {chosen.length} 个图层</strong><p>拖动可一起移动。在“更多”中对齐、整理或合并。</p></> : <>
            <strong>画板</strong><label>标题<input aria-label="画板标题" value={c.title} maxLength={200} disabled={busy} onChange={e => editor.change(v => ({ ...v, title: e.target.value }), 'title')}/></label>
            <label>背景<select aria-label="画板背景" value={c.background} disabled={busy} onChange={e => editor.change(v => ({ ...v, background: e.target.value }))}><option value="transparent">透明</option><option value="#ffffff">白色</option><option value="#000000">黑色</option></select></label>
            <p>图层可以拖到画板外。导出“选中内容”可单独保存这些元素。</p>
          </>}
        </div>
        <div className="sd-layer-panel-foot">本地编辑 · 自动保存</div>
      </aside> : null}
    </div>
  </div>
}
export function LayersIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 10 5-10 5L2 8l10-5Zm-9 10 9 5 9-5M3 18l9 5 9-5"/></svg> }
