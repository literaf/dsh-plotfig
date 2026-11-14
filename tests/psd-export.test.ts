import { describe, expect, it, vi } from 'vitest'
import { initializeCanvas, readPsd, writePsdUint8Array } from 'ag-psd'
import type { Layer, PixelData, Psd } from 'ag-psd'
import { buildPsdDocument } from '../src/client/psd-export.js'
import type { CanvasLayer, Composition, TextRun } from '../src/shared/types.js'

vi.mock('../src/client/layer-render.js', () => ({ renderLayersCanvas: vi.fn() }))
initializeCanvas(() => { throw new Error('PSD tests must use pixel data') }, (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData))
const shape = (id: string, patch: Partial<CanvasLayer> = {}): CanvasLayer => ({ id, name: id, kind: 'rect', x: 3, y: 4, width: 12, height: 10, rotation: 0, opacity: 1, hidden: false, locked: false, fill: '#123456', ...patch })
const scene = (layers: CanvasLayer[], background = 'transparent'): Composition => ({ id: 'aaaaaaaaaaaa', title: 'PSD test', sourceId: 'bbbbbbbbbbbb', x: 0, y: 0, width: 64, height: 48, version: 0, background, layers })
const rasterize = vi.fn(async (_layers: CanvasLayer[], box: { width: number; height: number }): Promise<PixelData> => {
  const data = new Uint8ClampedArray(box.width * box.height * 4)
  for (let i = 0; i < data.length; i += 4) data.set([120, 80, 60, 255], i)
  return { width: box.width, height: box.height, data }
})
const roundtrip = (psd: Psd) => readPsd(writePsdUint8Array(psd, { noBackground: true, trimImageData: true, invalidateTextLayers: false }), { useImageData: true })
const run = (text: string, patch: Partial<TextRun> = {}): TextRun => ({ text, fontFamily: 'Arial', fill: '#123456', bold: false, italic: false, underline: false, strikethrough: false, shadow: false, translucent: false, ...patch })
const leaves = (layers: Layer[]): Layer[] => layers.flatMap(l => l.children ? leaves(l.children) : [l])

describe('PSD binary roundtrip', () => {
  it('preserves independent layers, order, negative positions, hidden state, locking and opacity', async () => {
    rasterize.mockClear()
    const source = scene([shape('bottom'), shape('outside', { x: -25, opacity: 0.5, locked: true }), shape('hidden top', { hidden: true })], '#ffffff')
    const doc = await buildPsdDocument(source, rasterize), out = roundtrip(doc)
    expect([out.width, out.height]).toEqual([64, 48])
    expect(out.children!.map(l => l.name)).toEqual(['画板背景', 'bottom', 'outside', 'hidden top'])
    expect(out.children![3]!.hidden).toBe(true)
    expect(out.children![2]).toMatchObject({ left: -27, protected: { all: true } })
    expect(out.children![2]!.opacity).toBeCloseTo(0.5, 2)
    expect(out.children![2]!.imageData!.data[3]).toBe(255)
    expect(out.imageData!.data).toEqual(doc.imageData!.data)
    expect(rasterize.mock.calls.slice(0, 3).every(([layers]) => layers[0]!.opacity === 1 && !layers[0]!.hidden)).toBe(true)
  })
  it('writes rotated native text with editable content and a pixel preview', async () => {
    const source = scene([shape('标题', { kind: 'text', text: '可编辑文字', rotation: 90, fontSize: 12, fontFamily: 'Arial', bold: true, align: 'center' })])
    const out = roundtrip(await buildPsdDocument(source, rasterize)), text = out.children![0]!.text!
    expect(text.text).toBe('可编辑文字')
    expect(text.style).toMatchObject({ font: { name: 'ArialMT' }, fauxBold: true, fontSize: 12 })
    expect(text.paragraphStyle?.justification).toBe('center')
    expect(text.transform![1]).toBeCloseTo(1); expect(text.transform![2]).toBeCloseTo(-1)
    expect(out.children![0]!.imageData).toBeDefined()
    const raster = roundtrip(await buildPsdDocument(source, rasterize, false))
    expect(raster.children![0]!.text).toBeUndefined()
    expect(raster.children![0]!.imageData).toBeDefined()
  })
  it('keeps OCR style runs editable inside a named group, with opacity and shadows applied once', async () => {
    const ocr = { sourceAssetId: 'cccccccccccc', width: 40, height: 20, lines: [{ x: 2, y: 3, width: 36, height: 14, fontSize: 10, runs: [run('A'), run('B', { bold: true, translucent: true, shadow: true })] }] }
    const source = scene([shape('OCR', { kind: 'text', width: 80, height: 30, rotation: 30, opacity: 0.8, ocr })])
    const out = roundtrip(await buildPsdDocument(source, rasterize, true, r => r.text.length * 6))
    const group = out.children![0]!, spans = group.children!
    expect(group.name).toBe('OCR'); expect(group.opacity).toBeCloseTo(0.8, 2)
    expect(spans.map(l => l.text!.text)).toEqual(['A', 'B'])
    expect(spans[1]!.opacity).toBeCloseTo(0.6, 2)
    expect(spans[1]!.effects?.dropShadow?.[0]?.opacity).toBeCloseTo(0.3, 2)
    expect(spans[1]!.text?.style?.fauxBold).toBe(true)
    const matrix = spans[0]!.text!.transform!
    expect(matrix[0]).toBeCloseTo(Math.cos(Math.PI / 6) * 2)
    expect(matrix[3]).toBeCloseTo(Math.cos(Math.PI / 6) * 1.5)
    const raster = roundtrip(await buildPsdDocument(source, rasterize, false))
    expect(leaves(raster.children!).every(l => !l.text)).toBe(true)
    expect(raster.children).toHaveLength(1)
  })
  it('rejects excessive raster allocation and mismatched pixel buffers', async () => {
    await expect(buildPsdDocument({ ...scene([]), width: 16001 }, rasterize)).rejects.toThrow('画板')
    await expect(buildPsdDocument(scene([shape('huge', { width: 16001 })]), rasterize)).rejects.toThrow('内容过大')
    await expect(buildPsdDocument(scene([]), async () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }))).rejects.toThrow('不一致')
  })
})
