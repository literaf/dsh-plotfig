import Konva from 'konva'
import { Ellipse, Group, Image as KImage, Rect, Text } from 'react-konva'
import type { CanvasLayer, Composition } from '../shared/types.js'
import type { LayerBox } from '../shared/layers.js'
import { imageUrl } from './controller.js'
import { loadImage, useImage } from './images.js'

export const textAttributes = (l: CanvasLayer) => ({
  text: l.text ?? '', width: l.width, height: l.height, fontSize: l.fontSize ?? 36,
  fontFamily: l.fontFamily ?? 'Arial', fontStyle: [l.bold ? 'bold' : '', l.italic ? 'italic' : ''].filter(Boolean).join(' ') || 'normal',
  fill: l.fill ?? '#222222', align: l.align ?? 'left', lineHeight: 1.2, wrap: 'word',
})
export function LayerContent({ layer: l, sessionId }: { layer: CanvasLayer; sessionId: string }) {
  const image = useImage(l.kind === 'image' && l.assetId ? imageUrl(sessionId, l.assetId) : undefined)
  if (l.kind === 'image') return image ? <KImage image={image} width={l.width} height={l.height}/> : <Rect width={l.width} height={l.height} fill="#d4d7de"/>
  if (l.kind === 'text') return <Text {...textAttributes(l)}/>
  const shape = { fill: l.fill ?? 'transparent', stroke: l.stroke ?? 'transparent', strokeWidth: l.strokeWidth ?? 0 }
  return l.kind === 'rect' ? <Rect width={l.width} height={l.height} {...shape}/> : <Ellipse x={l.width / 2} y={l.height / 2} radiusX={l.width / 2} radiusY={l.height / 2} {...shape}/>
}
export function CompositionContent({ composition, sessionId }: { composition: Composition; sessionId: string }) {
  return <>
    <Rect width={composition.width} height={composition.height} fill={composition.background === 'transparent' ? '#ffffff' : composition.background}/>
    {composition.layers.filter(l => !l.hidden).map(l => <Group key={l.id} x={l.x} y={l.y} rotation={l.rotation} opacity={l.opacity} listening={false}><LayerContent layer={l} sessionId={sessionId}/></Group>)}
  </>
}
/** Same Konva attributes as the editor, rendered off-screen at output resolution. */
export async function renderLayers(sessionId: string, layers: CanvasLayer[], bounds: LayerBox, background = 'transparent'): Promise<string> {
  const x = Math.floor(bounds.x), y = Math.floor(bounds.y), width = Math.ceil(bounds.x + bounds.width) - x, height = Math.ceil(bounds.y + bounds.height) - y
  if (width < 1 || height < 1 || width > 16000 || height > 16000 || width * height > 32_000_000) throw new Error('导出范围过大，请缩小到 3200 万像素以内。')
  await document.fonts?.ready
  const visible = layers.filter(l => !l.hidden)
  const decoded = new Map<string, HTMLImageElement>()
  await Promise.all(visible.filter(l => l.kind === 'image' && l.assetId).map(async l => { decoded.set(l.assetId!, await loadImage(imageUrl(sessionId, l.assetId!))) }))
  const container = document.createElement('div'), stage = new Konva.Stage({ container, width, height }), plane = new Konva.Layer()
  try {
    stage.add(plane)
    if (background !== 'transparent') plane.add(new Konva.Rect({ width, height, fill: background, listening: false }))
    for (const l of visible) {
      const group = new Konva.Group({ x: l.x - x, y: l.y - y, rotation: l.rotation, opacity: l.opacity, listening: false })
      if (l.kind === 'image') group.add(new Konva.Image({ image: decoded.get(l.assetId!), width: l.width, height: l.height }))
      else if (l.kind === 'text') group.add(new Konva.Text(textAttributes(l)))
      else {
        const attrs = { fill: l.fill ?? 'transparent', stroke: l.stroke ?? 'transparent', strokeWidth: l.strokeWidth ?? 0 }
        group.add(l.kind === 'rect' ? new Konva.Rect({ width: l.width, height: l.height, ...attrs }) : new Konva.Ellipse({ x: l.width / 2, y: l.height / 2, radiusX: l.width / 2, radiusY: l.height / 2, ...attrs }))
      }
      plane.add(group)
    }
    plane.draw()
    return stage.toDataURL({ pixelRatio: 1 })
  } finally { stage.destroy(); container.remove() }
}
export function downloadPng(data: string, name: string): void {
  const bytes = Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), c => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })), a = document.createElement('a')
  a.download = name.replace(/[\\/:*?"<>|]/g, '_') + '.png'; a.href = url
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
