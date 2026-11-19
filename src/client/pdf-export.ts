import type { Composition } from '../shared/types.js'
import { buildPdf } from '../shared/pdf.js'
import { renderLayersCanvas } from './layer-render.js'

/** `deflate` in CompressionStream is the zlib format that PDF FlateDecode reads. */
export async function zlibDeflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
/** One page at the artboard's pixel size, rendered by the same path as PNG export. */
export async function exportPdf(sessionId: string, composition: Composition): Promise<Uint8Array> {
  const canvas = await renderLayersCanvas(sessionId, composition.layers, { x: 0, y: 0, width: composition.width, height: composition.height }, composition.background)
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法绘制 PDF 页面。')
    return await buildPdf(ctx.getImageData(0, 0, canvas.width, canvas.height), composition.title, zlibDeflate)
  } finally { canvas.width = 0; canvas.height = 0 }
}
