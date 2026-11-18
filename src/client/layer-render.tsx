import Konva from 'konva'
import { useMemo } from 'react'
import { Arrow, Ellipse, Group, Image as KImage, Line, Rect, Text } from 'react-konva'
import type { CanvasLayer, Composition } from '../shared/types.js'
import type { LayerBox } from '../shared/layers.js'
import { imageUrl } from './controller.js'
import { loadImage, useImage } from './images.js'
import { ocrTextNodes } from './ocr-layout.js'
import { arrowPoints, isNode, nodeTextLayer } from '../shared/diagram.js'

export const diamondPoints = (l: CanvasLayer) => [l.width / 2, 0, l.width, l.height / 2, l.width / 2, l.height, 0, l.height / 2]
export const arrowAttributes = (l: CanvasLayer) => ({ points: arrowPoints(l), pointerLength: Math.max(10, (l.strokeWidth ?? 3) * 3), pointerWidth: Math.max(10, (l.strokeWidth ?? 3) * 3) * 0.9, hitStrokeWidth: 14, lineJoin: 'round' as const })

export const textAttributes = (l: CanvasLayer) => ({
  text: l.text ?? '', width: l.width, height: l.height, fontSize: l.fontSize ?? 36,
  fontFamily: l.fontFamily ?? 'Arial', fontStyle: [l.bold ? 'bold' : '', l.italic ? 'italic' : ''].filter(Boolean).join(' ') || 'normal',
  fill: l.fill ?? '#222222', align: l.align ?? 'left', lineHeight: 1.2, wrap: 'word',
})
/** Measure wrapping once so labels remain centered even after editing. */
export function nodeLabel(l: CanvasLayer): CanvasLayer {
  const first = nodeTextLayer(l), probe = new Konva.Text({ ...textAttributes(first), height: Math.max(1, l.height - 12) })
  try { return nodeTextLayer(l, Math.max(1, probe.textArr.length)) } finally { probe.destroy() }
}
/** Small hit masks let transparent PNG regions pass clicks to lower layers without caching the visible image. */
const hitMasks = new WeakMap<HTMLImageElement, { width: number; height: number; runs: number[][] }>()
function alphaMask(image: HTMLImageElement) {
  const cached = hitMasks.get(image); if (cached) return cached
  const ratio = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.ceil(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.ceil(image.naturalHeight * ratio))
  const context = canvas.getContext('2d')!
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height), runs: number[][] = []
  for (let y = 0; y < canvas.height; y++) {
    let start = -1
    for (let x = 0; x <= canvas.width; x++) {
      const opaque = x < canvas.width && data[(y * canvas.width + x) * 4 + 3]! > 16
      if (opaque && start < 0) start = x
      else if (!opaque && start >= 0) { runs.push([start, y, x - start]); start = -1 }
    }
  }
  const mask = { width: canvas.width, height: canvas.height, runs }; hitMasks.set(image, mask); return mask
}
export function LayerContent({ layer: l, sessionId, alphaHit = false }: { layer: CanvasLayer; sessionId: string; alphaHit?: boolean }) {
  const image = useImage(l.kind === 'image' && l.assetId ? imageUrl(sessionId, l.assetId) : undefined)
  const hitFunc = useMemo(() => {
    if (!image || !alphaHit) return undefined
    const mask = alphaMask(image)
    return (context: Konva.Context, shape: Konva.Shape) => {
      // A small screen-space tolerance keeps downscaled lettering and thin edges clickable.
      const scale = shape.getAbsoluteScale(), px = 2 / Math.abs(scale.x || 1), py = 2 / Math.abs(scale.y || 1)
      context.beginPath()
      for (const [x, y, width] of mask.runs) context.rect(x! * l.width / mask.width - px, y! * l.height / mask.height - py, width! * l.width / mask.width + px * 2, l.height / mask.height + py * 2)
      context.closePath(); context.fillStrokeShape(shape)
    }
  }, [image, alphaHit, l.width, l.height])
  if (l.kind === 'image') return image ? <KImage image={image} width={l.width} height={l.height} {...(hitFunc ? { hitFunc } : {})}/> : <Rect width={l.width} height={l.height} fill="#d4d7de"/>
  if (l.kind === 'text' && l.ocr) return <><Rect width={l.width} height={l.height} fill="rgba(0,0,0,0)"/><Group scaleX={l.width / l.ocr.width} scaleY={l.height / l.ocr.height}>{ocrTextNodes(l.ocr).map((attrs, i) => <Text key={i} {...attrs}/>)}</Group></>
  if (l.kind === 'text') return <Text {...textAttributes(l)}/>
  const shape = { fill: l.fill ?? 'transparent', stroke: l.stroke ?? 'transparent', strokeWidth: l.strokeWidth ?? 0 }
  const label = isNode(l) && l.text ? nodeLabel({ ...l, x: 0, y: 0, rotation: 0 }) : undefined
  return <>
    {l.kind === 'arrow' ? <Arrow {...shape} fill={l.stroke ?? '#507b8b'} {...arrowAttributes(l)}/>
      : l.kind === 'diamond' ? <Line points={diamondPoints(l)} closed {...shape}/>
      : l.kind === 'rect' ? <Rect width={l.width} height={l.height} cornerRadius={l.cornerRadius ?? 0} {...shape}/>
      : <Ellipse x={l.width / 2} y={l.height / 2} radiusX={l.width / 2} radiusY={l.height / 2} {...shape}/>}
    {label ? <Text {...textAttributes(label)} x={label.x} y={label.y} listening={false}/> : null}
  </>
}
export function CompositionContent({ composition, sessionId }: { composition: Composition; sessionId: string }) {
  return <>
    <Rect width={composition.width} height={composition.height} fill={composition.background === 'transparent' ? '#ffffff' : composition.background}/>
    {composition.layers.filter(l => !l.hidden).map(l => <Group key={l.id} x={l.x} y={l.y} rotation={l.rotation} opacity={l.opacity} listening={false}><LayerContent layer={l} sessionId={sessionId}/></Group>)}
  </>
}
/** Same Konva attributes as the editor, rendered off-screen at output resolution. */
export async function renderLayers(sessionId: string, layers: CanvasLayer[], bounds: LayerBox, background = 'transparent'): Promise<string> {
  return (await renderLayersCanvas(sessionId, layers, bounds, background)).toDataURL('image/png')
}
export async function renderLayersCanvas(sessionId: string, layers: CanvasLayer[], bounds: LayerBox, background = 'transparent'): Promise<HTMLCanvasElement> {
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
      else if (l.kind === 'text' && l.ocr) {
        const text = new Konva.Group({ scaleX: l.width / l.ocr.width, scaleY: l.height / l.ocr.height })
        ocrTextNodes(l.ocr).forEach(attrs => text.add(new Konva.Text(attrs)))
        group.add(text)
      }
      else if (l.kind === 'text') group.add(new Konva.Text(textAttributes(l)))
      else {
        const attrs = { fill: l.fill ?? 'transparent', stroke: l.stroke ?? 'transparent', strokeWidth: l.strokeWidth ?? 0 }
        group.add(l.kind === 'arrow' ? new Konva.Arrow({ ...attrs, fill: l.stroke ?? '#507b8b', ...arrowAttributes(l) })
          : l.kind === 'diamond' ? new Konva.Line({ ...attrs, points: diamondPoints(l), closed: true })
          : l.kind === 'rect' ? new Konva.Rect({ width: l.width, height: l.height, cornerRadius: l.cornerRadius ?? 0, ...attrs })
          : new Konva.Ellipse({ x: l.width / 2, y: l.height / 2, radiusX: l.width / 2, radiusY: l.height / 2, ...attrs }))
        if (isNode(l) && l.text) { const label = nodeLabel({ ...l, x: 0, y: 0, rotation: 0 }); group.add(new Konva.Text({ ...textAttributes(label), x: label.x, y: label.y })) }
      }
      plane.add(group)
    }
    plane.draw()
    return stage.toCanvas({ pixelRatio: 1 })
  } finally { stage.destroy(); container.remove() }
}
export function downloadPng(data: string, name: string): void {
  const bytes = Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), c => c.charCodeAt(0))
  downloadFile(bytes, name, 'png', 'image/png')
}
export function downloadFile(bytes: Uint8Array, name: string, extension: string, type: string): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type })), a = document.createElement('a')
  a.download = name.replace(/[\\/:*?"<>|]/g, '_') + '.' + extension; a.href = url
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
