import type { CanvasLayer } from '../shared/types.js'
import { layersBounds } from '../shared/layers.js'
import type { CanvasModel } from './controller.js'
import type { EditorModel } from './editor-model.js'
import { renderLayers } from './layer-render.js'

export function selectionBounds(layers: CanvasLayer[]) {
  const bounds = layersBounds(layers)
  if (!bounds) throw new Error('请先选择要导出的可见图层。')
  const pad = Math.max(0, ...layers.filter(l => !l.hidden).map(l => (l.strokeWidth ?? 0) / 2))
  const x = Math.floor(bounds.x - pad), y = Math.floor(bounds.y - pad)
  return { x, y, width: Math.ceil(bounds.x + bounds.width + pad) - x, height: Math.ceil(bounds.y + bounds.height + pad) - y }
}

/** Local raster merge; immutable source assets remain available to undo. */
export async function mergeSelectedLayers(model: CanvasModel, editor: EditorModel, selected: string[]): Promise<string> {
  const layers = editor.getSnapshot().composition.layers, ids = new Set(selected)
  const chosen = layers.filter(l => ids.has(l.id))
  if (chosen.length < 2 || chosen.some(l => l.locked || l.hidden)) throw new Error('请选择至少两个未锁定的可见图层。')
  const box = selectionBounds(chosen), png = await renderLayers(model.sessionId, chosen, box)
  const item = await model.importComposite(png, '合并图层')
  if (editor.getSnapshot().composition.layers !== layers) throw new Error('图层在合并期间发生变化，请重新选择后合并。')
  const last = layers.findLastIndex(l => ids.has(l.id))
  const merged: CanvasLayer = { id: crypto.randomUUID(), kind: 'image', name: '合并图层', assetId: item.id, ...box, opacity: 1, rotation: 0, hidden: false, locked: false }
  editor.change(c => ({ ...c, layers: c.layers.flatMap((l, index) => index === last ? [merged] : ids.has(l.id) ? [] : [l]) }))
  return merged.id
}
