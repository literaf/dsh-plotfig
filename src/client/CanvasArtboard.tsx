import { useEffect, useRef, useSyncExternalStore } from 'react'
import type Konva from 'konva'
import { Group, Rect, Transformer } from 'react-konva'
import type { CanvasLayer, Composition } from '../shared/types.js'
import type { CanvasModel } from './controller.js'
import type { EditorModel } from './editor-model.js'
import { LayerContent } from './layer-render.js'

const ACCENT = '#3b6cf6'
const normalAngle = (value: number) => ((value + 180) % 360 + 360) % 360 - 180

/** The same saved scene as the detailed editor, editable in the shared canvas. */
export function CanvasArtboard({ model, initial, active, selected, scale, panning, busy, onSelect, onMove, onEdit }: {
  model: CanvasModel; initial: Composition; active: boolean; selected: string[]; scale: number; panning: boolean; busy: boolean
  onSelect(compositionId: string, layerId?: string, append?: boolean): void
  onMove(move: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }): void
  onEdit(editor: EditorModel): void
}) {
  const editor = model.editor(initial), state = useSyncExternalStore(editor.subscribe, editor.getSnapshot)
  const c = state.composition, nodes = useRef(new Map<string, Konva.Group>()), transformer = useRef<Konva.Transformer>(null)
  const dragStart = useRef<CanvasLayer[]>(), dragFrame = useRef<number>(), transformFrame = useRef<number>()
  const editable = c.layers.filter(l => selected.includes(l.id) && !l.locked && !l.hidden)
  useEffect(() => {
    const current = editor.getSnapshot()
    if (!current.dirty && initial.version > current.composition.version) editor.reload(initial)
  }, [editor, initial])
  useEffect(() => {
    transformer.current?.nodes(editable.map(l => nodes.current.get(l.id)).filter((n): n is Konva.Group => !!n))
    transformer.current?.getLayer()?.batchDraw()
  }, [c.layers, selected, panning, busy])
  useEffect(() => () => { if (transformFrame.current !== undefined) cancelAnimationFrame(transformFrame.current); if (dragFrame.current !== undefined) cancelAnimationFrame(dragFrame.current) }, [])
  const change = (update: (layers: CanvasLayer[]) => CanvasLayer[]) => {
    const before = editor.getSnapshot().composition
    editor.change(value => ({ ...value, layers: update(value.layers) }))
    if (editor.getSnapshot().composition !== before) onEdit(editor)
  }
  const finishTransform = () => {
    if (transformFrame.current !== undefined) return
    transformFrame.current = requestAnimationFrame(() => {
      transformFrame.current = undefined
      const patches = new Map<string, Partial<CanvasLayer>>()
      for (const l of editable) {
        const node = nodes.current.get(l.id); if (!node) continue
        const sx = node.scaleX(), sy = node.scaleY()
        patches.set(l.id, { x: node.x(), y: node.y(), width: Math.max(1, l.width * sx), height: Math.max(1, l.height * sy), rotation: normalAngle(node.rotation()),
          ...(l.kind === 'text' && !l.ocr ? { fontSize: Math.max(1, Math.min(2000, (l.fontSize ?? 36) * sy)) } : {}) })
        node.scale({ x: 1, y: 1 })
      }
      change(layers => layers.map(l => patches.has(l.id) ? { ...l, ...patches.get(l.id) } : l))
    })
  }
  const finishDrag = () => {
    if (dragFrame.current !== undefined) return
    // Transformer starts a drag on every selected node. Commit once after all of their dragend events.
    dragFrame.current = requestAnimationFrame(() => {
      dragFrame.current = undefined
      const start = dragStart.current; dragStart.current = undefined; if (!start) return
      const positions = new Map(start.flatMap(l => { const node = nodes.current.get(l.id); return node ? [[l.id, node.position()] as const] : [] }))
      change(layers => layers.map(l => positions.has(l.id) ? { ...l, ...positions.get(l.id) } : l))
    })
  }
  return <Group x={initial.x} y={initial.y} draggable={!panning && !busy}
    onMouseDown={e => { if (panning) return; e.cancelBubble = true; onSelect(c.id) }}
    onTouchStart={e => { if (panning) return; e.cancelBubble = true; onSelect(c.id) }}
    onDragEnd={e => { if (e.target !== e.currentTarget) return; e.cancelBubble = true; const to = { x: e.target.x(), y: e.target.y() }; if (to.x !== initial.x || to.y !== initial.y) onMove({ id: c.id, from: { x: initial.x, y: initial.y }, to }) }}>
    <Rect width={c.width} height={c.height} fill={c.background === 'transparent' ? '#fff' : c.background} shadowBlur={18 / scale} shadowOpacity={0.1}/>
    {c.layers.filter(l => !l.hidden).map(l => <Group key={l.id} id={l.id} ref={n => { if (n) nodes.current.set(l.id, n); else nodes.current.delete(l.id) }}
      x={l.x} y={l.y} rotation={l.rotation} opacity={l.opacity} draggable={!panning && !busy && !l.locked}
      onMouseDown={e => { if (panning || l.locked || busy) return; e.cancelBubble = true; onSelect(c.id, l.id, e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey) }}
      onTouchStart={e => { if (panning || l.locked || busy) return; e.cancelBubble = true; onSelect(c.id, l.id) }}
      onMouseEnter={e => { const container = e.target.getStage()?.container(); if (container) container.style.cursor = panning ? 'grab' : l.locked ? 'default' : 'move' }}
      onMouseLeave={e => { const container = e.target.getStage()?.container(); if (container) container.style.cursor = '' }}
      onDragStart={e => { e.cancelBubble = true; if (!dragStart.current) { const ids = selected.includes(l.id) ? selected : [l.id]; dragStart.current = c.layers.filter(n => ids.includes(n.id) && !n.locked && !n.hidden) } }}
      onDragMove={e => { e.cancelBubble = true }}
      onDragEnd={e => { e.cancelBubble = true; finishDrag() }}
      onTransformEnd={finishTransform}>
      <LayerContent layer={l} sessionId={model.sessionId} alphaHit/>
      {selected.includes(l.id) ? <Rect width={l.width} height={l.height} stroke={ACCENT} strokeWidth={1 / scale} listening={false}/> : null}
    </Group>)}
    {active && !selected.length ? <Rect width={c.width} height={c.height} stroke={ACCENT} strokeWidth={2 / scale} listening={false}/> : null}
    <Transformer ref={transformer} visible={active && !panning && !busy} rotateEnabled flipEnabled={false} keepRatio={editable.every(l => l.kind === 'image')}
      padding={2} borderStroke={ACCENT} anchorStroke={ACCENT} anchorFill="#fff" anchorSize={8}
      onMouseDown={e => { e.cancelBubble = true }} onTouchStart={e => { e.cancelBubble = true }}
      boundBoxFunc={(old, next) => Math.abs(next.width) < 8 || Math.abs(next.height) < 8 ? old : next}/>
  </Group>
}
