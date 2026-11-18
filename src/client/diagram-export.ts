import Konva from 'konva'
import type { Composition } from '../shared/types.js'
import { diagramSvg } from '../shared/diagram-svg.js'
import { nodeLabel, textAttributes } from './layer-render.js'

/** SVG line breaks and baselines use the same text measurements as the canvas. */
export async function exportSvg(composition: Composition): Promise<Uint8Array> {
  await document.fonts?.ready
  return new TextEncoder().encode(diagramSvg(composition, {
    nodeLabel,
    textLayout: layer => {
      const text = new Konva.Text(textAttributes(layer))
      try {
        const metrics = text.measureSize('M'), size = layer.fontSize ?? 36
        const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent, descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent
        return { lines: text.textArr.map(l => l.text), baseline: (ascent - descent) / 2 + size * 0.6, lineHeight: size * 1.2 }
      } finally { text.destroy() }
    },
  }))
}
