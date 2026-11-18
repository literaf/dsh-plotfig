import type { CanvasLayer, Composition } from './types.js'
import { arrowPoints, isNode, nodeTextLayer } from './diagram.js'
const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
export const canExportSvg = (layers: CanvasLayer[]) => layers.every(l => l.kind !== 'image' && !l.ocr)
/** Standalone vector export; only local vector/text primitives, no scripts or external resources. */
export interface SvgTextLayout { lines: string[]; baseline: number; lineHeight: number }
export function diagramSvg(c: Pick<Composition, 'title' | 'width' | 'height' | 'background' | 'layers'>, options: { textLayout?(l: CanvasLayer): SvgTextLayout; nodeLabel?(l: CanvasLayer): CanvasLayer } = {}): string {
  if (!canExportSvg(c.layers)) throw new Error('SVG 导出仅适用于文字与图形画板。含图片的画板请导出 PNG 或 PSD。')
  const draw = (l: CanvasLayer): string => {
    const fill = xml(l.fill === 'transparent' ? 'none' : l.fill ?? 'none'), stroke = xml(l.stroke === 'transparent' ? 'none' : l.stroke ?? 'none')
    const attrs = `fill="${fill}" stroke="${stroke}" stroke-width="${l.strokeWidth ?? 0}"`
    let content = ''
    if (l.kind === 'text') {
      const size = l.fontSize ?? 36, x = l.align === 'center' ? l.width / 2 : l.align === 'right' ? l.width : 0
      const layout = options.textLayout?.(l) ?? { lines: (l.text ?? '').split('\n'), baseline: size * 0.85, lineHeight: size * 1.2 }
      content = `<text fill="${fill}" font-family="${xml(l.fontFamily ?? 'Arial')}" font-size="${size}" font-weight="${l.bold ? 'bold' : 'normal'}" font-style="${l.italic ? 'italic' : 'normal'}" text-anchor="${l.align === 'center' ? 'middle' : l.align === 'right' ? 'end' : 'start'}">${layout.lines.map((s, i) => `<tspan x="${x}" y="${layout.baseline + i * layout.lineHeight}">${xml(s)}</tspan>`).join('')}</text>`
    } else if (l.kind === 'rect') content = `<rect width="${l.width}" height="${l.height}" rx="${l.cornerRadius ?? 0}" ${attrs}/>`
    else if (l.kind === 'ellipse') content = `<ellipse cx="${l.width / 2}" cy="${l.height / 2}" rx="${l.width / 2}" ry="${l.height / 2}" ${attrs}/>`
    else if (l.kind === 'diamond') content = `<polygon points="${l.width / 2},0 ${l.width},${l.height / 2} ${l.width / 2},${l.height} 0,${l.height / 2}" ${attrs}/>`
    else if (l.kind === 'arrow') {
      const p = arrowPoints(l), n = p.length, x = p[n - 2]!, y = p[n - 1]!
      let j = n - 4
      while (j > 0 && p[j] === x && p[j + 1] === y) j -= 2
      const a = Math.atan2(y - p[j + 1]!, x - p[j]!), len = Math.max(10, (l.strokeWidth ?? 3) * 3), w = len * 0.45
      content = `<polyline points="${p.map((v, i) => `${v}${i % 2 ? ' ' : ','}`).join('').trim()}" fill="none" stroke="${stroke}" stroke-width="${l.strokeWidth ?? 3}" stroke-linejoin="round"/><path d="M${x},${y} L${x - len * Math.cos(a) + w * Math.sin(a)},${y - len * Math.sin(a) - w * Math.cos(a)} L${x - len * Math.cos(a) - w * Math.sin(a)},${y - len * Math.sin(a) + w * Math.cos(a)} Z" fill="${stroke}"/>`
    }
    if (isNode(l) && l.text) { const text = (options.nodeLabel ?? nodeTextLayer)({ ...l, x: 0, y: 0, rotation: 0 }); content += draw(text) }
    return `<g transform="translate(${l.x} ${l.y}) rotate(${l.rotation})" opacity="${l.opacity}">${content}</g>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}"><title>${xml(c.title)}</title>${c.background !== 'transparent' ? `<rect width="100%" height="100%" fill="${xml(c.background)}"/>` : ''}${c.layers.filter(l => !l.hidden).map(draw).join('')}</svg>`
}
