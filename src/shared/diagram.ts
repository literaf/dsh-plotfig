import type { CanvasLayer, ConnectorBinding } from './types.js'

export const isNode = (l: CanvasLayer): boolean => ['rect', 'ellipse', 'diamond'].includes(l.kind)
export const isConnected = (l: CanvasLayer): boolean => l.kind === 'arrow' && !!(l.startBinding || l.endBinding)
export const arrowPoints = (l: CanvasLayer): number[] => (l.points ?? [0, 0.5, 1, 0.5]).map((p, i) => p * (i % 2 ? l.height : l.width))
/** Shape labels share a regular text layer's geometry in the canvas and exports. */
export function nodeTextLayer(l: CanvasLayer, lineCount = l.text?.split('\n').length ?? 1): CanvasLayer {
  const size = l.fontSize ?? 26, padding = l.kind === 'diamond' ? l.width * 0.2 : 14
  const height = Math.min(l.height - 12, lineCount * size * 1.2)
  const x = padding, y = Math.max(6, (l.height - height) / 2), a = l.rotation * Math.PI / 180
  return { ...l, kind: 'text', x: l.x + x * Math.cos(a) - y * Math.sin(a), y: l.y + x * Math.sin(a) + y * Math.cos(a),
    width: Math.max(1, l.width - 2 * padding), height: Math.max(1, height), fontSize: size,
    fill: l.textColor ?? '#253748', strokeWidth: 0, align: l.align ?? 'center' }
}
function anchor(l: CanvasLayer, side: ConnectorBinding['side']): [number, number] {
  const [x, y] = side === 'top' ? [l.width / 2, 0] : side === 'bottom' ? [l.width / 2, l.height] : side === 'left' ? [0, l.height / 2] : [l.width, l.height / 2]
  const a = l.rotation * Math.PI / 180
  return [l.x + x! * Math.cos(a) - y! * Math.sin(a), l.y + x! * Math.sin(a) + y! * Math.cos(a)]
}
/** Recompute links after a node edit; deleting a node leaves a detached, editable arrow. */
export function updateConnectors(layers: CanvasLayer[]): CanvasLayer[] {
  const nodes = new Map(layers.filter(isNode).map(l => [l.id, l]))
  return layers.map(l => {
    if (!isConnected(l)) return l
    const from = l.startBinding && nodes.get(l.startBinding.layerId), to = l.endBinding && nodes.get(l.endBinding.layerId)
    if (!from || !to || !l.startBinding || !l.endBinding) {
      const { startBinding: _a, endBinding: _b, ...detached } = l
      return detached
    }
    const a = anchor(from, l.startBinding.side), b = anchor(to, l.endBinding.side)
    const fromHorizontal = ['left', 'right'].includes(l.startBinding.side), toHorizontal = ['left', 'right'].includes(l.endBinding.side)
    const points = !l.routing || l.routing === 'straight' ? [a, b]
      : fromHorizontal !== toHorizontal ? [a, fromHorizontal ? [b[0], a[1]] : [a[0], b[1]], b]
      : fromHorizontal ? [a, [(a[0] + b[0]) / 2, a[1]], [(a[0] + b[0]) / 2, b[1]], b]
      : [a, [a[0], (a[1] + b[1]) / 2], [b[0], (a[1] + b[1]) / 2], b]
    const xs = points.map(p => p[0]!), ys = points.map(p => p[1]!)
    const x = Math.min(...xs) - 8, y = Math.min(...ys) - 8, width = Math.max(...xs) - x + 8, height = Math.max(...ys) - y + 8
    return { ...l, x, y, width, height, rotation: 0, points: points.flatMap(p => [(p[0]! - x) / width, (p[1]! - y) / height]) }
  })
}

/** Copy a selection while preserving connections within that selection only. */
export function duplicateLayers(layers: CanvasLayer[], id: () => string): CanvasLayer[] {
  const ids = new Map(layers.map(l => [l.id, id()]))
  return updateConnectors(layers.map(l => {
    const { startBinding, endBinding, ...rest } = l
    return { ...rest, id: ids.get(l.id)!, name: `${l.name} 副本`, x: l.x + 32, y: l.y + 32, locked: false,
      ...(startBinding && endBinding && ids.has(startBinding.layerId) && ids.has(endBinding.layerId)
        ? { startBinding: { ...startBinding, layerId: ids.get(startBinding.layerId)! }, endBinding: { ...endBinding, layerId: ids.get(endBinding.layerId)! } } : {}) }
  }))
}
