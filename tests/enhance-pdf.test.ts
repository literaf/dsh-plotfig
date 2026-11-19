import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkClient } from '../src/ark.js'
import type { ArkImage, ArkRequest } from '../src/ark.js'
import { decodePixels, encodePixels, finishEnhance, prepareImageEdit, resizePixels } from '../src/image-edit.js'
import type { Pixels } from '../src/pixels.js'
import { enhanceDimensions, expansionSteps, parseImageEdit } from '../src/shared/image-edit.js'
import { parseSize } from '../src/shared/types.js'
import { buildPdf } from '../src/shared/pdf.js'
import { CanvasStore } from '../src/store.js'
import { Seedream } from '../src/service.js'

function scene(width: number, height: number, dx = 0, dy = 0): Pixels {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x + dx, v = y + dy
    data.set([128 + 75 * Math.sin(u * 0.12) + 35 * Math.cos(v * 0.07), 125 + 80 * Math.cos(u * 0.07 + v * 0.12), 100 + 90 * Math.sin(u * 0.03 - v * 0.04), 255].map(Math.round), (y * width + x) * 4)
  }
  return { width, height, data }
}
const image = (p: Pixels): ArkImage => ({ bytes: encodePixels(p), width: p.width, height: p.height, mime: 'image/png' })
let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'seedream-enhance-')) })
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }) })

describe('chained multi-sided expansion', () => {
  it('orders sides horizontally first and keeps one side per step', () => {
    expect(expansionSteps({ left: 4, top: 6, right: 0, bottom: 2 })).toEqual([
      { left: 4, top: 0, right: 0, bottom: 0 }, { left: 0, top: 6, right: 0, bottom: 0 }, { left: 0, top: 0, right: 0, bottom: 2 }])
  })
  async function setup(fail?: number) {
    const store = new CanvasStore(root), source = scene(160, 200, 40, 30)
    const { items: [item] } = await store.add('s', [image(source)], { title: '原图', prompt: 'x', refs: [], externalRefs: 0, size: '160x200' })
    const ark = new ArkClient({ apiKey: async () => 'k', userAgent: 't', timeoutMs: 1000, fetch: vi.fn() }), requests: ArkRequest[] = []
    // A faithful model: return the continuous scene the context came from, at the requested size.
    vi.spyOn(ark, 'generate').mockImplementation(async request => {
      requests.push(request)
      if (requests.length === fail) throw new Error('upstream failed')
      const [w, h] = request.size.split('x').map(Number) as [number, number]
      return { images: [image(scene(w, h))] }
    })
    return { store, source, item: item!, ark, requests, service: new Seedream(ark, store) }
  }
  it('bills one pass per side, preserves every original byte and records the full expansion', async () => {
    const { store, source, item, service, requests } = await setup()
    const input = parseImageEdit({ operation: 'expand', image: `item:${item.id}`, requestId: 'multi-side-01', expand: { left: 30, right: 20, top: 24, bottom: 0 } }, false)
    const result = await service.editImage('s', input, new AbortController().signal)
    expect(requests).toHaveLength(3)
    for (const r of requests) expect(() => parseSize(r.size, '2K')).not.toThrow()
    expect(requests.map(r => r.prompt.slice(0, 5))).toEqual(['仅向左扩展', '仅向右扩展', '仅向上扩展'])
    const saved = result.items[0]!, out = decodePixels(await store.readImage('s', saved.id))
    expect([out.width, out.height]).toEqual([210, 224])
    for (let y = 0; y < source.height; y++) expect(out.data.subarray(((y + 24) * 210 + 30) * 4, ((y + 24) * 210 + 190) * 4)).toEqual(Buffer.from(source.data.subarray(y * 160 * 4, (y + 1) * 160 * 4)))
    expect(saved.edit).toMatchObject({ applied: true, expand: { left: 30, right: 20, top: 24, bottom: 0 } })
    expect(service.pending('s')).toEqual([])
  })
  it('saves completed passes when a later pass fails and never retries', async () => {
    const { store, item, service, requests } = await setup(2)
    const input = parseImageEdit({ operation: 'expand', image: `item:${item.id}`, requestId: 'multi-side-02', expand: { left: 30, right: 0, top: 24, bottom: 0 } }, false)
    const result = await service.editImage('s', input, new AbortController().signal)
    expect(requests).toHaveLength(2)
    const saved = result.items[0]!, out = decodePixels(await store.readImage('s', saved.id))
    expect([out.width, out.height]).toEqual([190, 200])
    expect(saved.title).toContain('部分完成')
    expect(saved.edit).toMatchObject({ applied: false, needsReview: true, expand: { left: 30, right: 0, top: 0, bottom: 0 } })
    expect(result.warnings.join()).toContain('第 2/2 步失败')
  })
  it('rejects an oversized combined target before billing', async () => {
    const { item, service, requests } = await setup()
    const input = parseImageEdit({ operation: 'expand', image: `item:${item.id}`, requestId: 'multi-side-03', expand: { left: 16000, right: 10, top: 0, bottom: 0 } }, false)
    await expect(service.editImage('s', input, new AbortController().signal)).rejects.toThrow()
    expect(requests).toHaveLength(0)
  })
})

describe('enhance', () => {
  it('targets the largest valid output and refuses images already at the model limit', () => {
    const t = enhanceDimensions(800, 600)
    expect(t.width * t.height).toBeLessThanOrEqual(4_624_220)
    expect(t.width / t.height).toBeCloseTo(800 / 600, 2)
    expect(() => parseSize(`${t.width}x${t.height}`, '2K')).not.toThrow()
    expect(enhanceDimensions(200, 100)).toEqual({ width: 800, height: 400 })
    expect(() => enhanceDimensions(2048, 2048)).toThrow('最大输出')
  })
  it('sends the original image with a content-preserving prompt', () => {
    const source = scene(400, 300)
    const prepared = prepareImageEdit(parseImageEdit({ operation: 'enhance', image: 'item:aaaaaaaaaaaa', requestId: 'enhance-001', prompt: '保持英文标注' }, false), encodePixels(source))
    expect(prepared.request.images).toHaveLength(1)
    expect(prepared.request.background).toBe('opaque')
    expect(prepared.request.prompt).toContain('保持英文标注')
    expect([prepared.width, prepared.height]).toEqual([1600, 1200])
    expect(() => parseImageEdit({ operation: 'enhance', image: 'item:aaaaaaaaaaaa', requestId: 'enhance-001', expand: { left: 1, right: 0, top: 0, bottom: 0 } }, false)).toThrow()
  })
  it('accepts a faithful upscale, flags drifted content and keeps the source silhouette', () => {
    const source = scene(120, 90), faithful = resizePixels(source, 480, 360)
    const ok = finishEnhance(source, faithful)
    // Even a faithful upscale is held for review: small text may be rewritten without large pixel drift.
    expect(ok.warnings.join()).toContain('变清晰结果需核对')
    expect([ok.image.width, ok.image.height]).toEqual([480, 360])
    expect(finishEnhance(source, scene(480, 360, 200, 0)).warnings.join()).toContain('变清晰需检查')
    const cut = { ...source, data: new Uint8Array(source.data) }
    for (let y = 0; y < 90; y++) for (let x = 0; x < 40; x++) cut.data[(y * 120 + x) * 4 + 3] = 0
    const out = decodePixels(finishEnhance(cut, faithful).image.bytes)
    expect(out.data[(180 * 480 + 20) * 4 + 3]).toBe(0)
    expect(out.data[(180 * 480 + 400) * 4 + 3]).toBe(255)
  })
})

describe('PDF export', () => {
  const deflate = async (b: Uint8Array) => new Uint8Array(deflateSync(b))
  const objects = (pdf: Buffer) => pdf.toString('latin1')
  it('writes a valid single page sized to the artboard with an exact xref table', async () => {
    const px = scene(30, 20), pdf = Buffer.from(await buildPdf(px, '水循环 · Water', deflate, new Date('2026-11-19T00:00:00Z')))
    const text = objects(pdf)
    expect(text.startsWith('%PDF-1.7')).toBe(true)
    expect(text).toContain('/MediaBox [0 0 30 20]')
    expect(text).not.toContain('/SMask')
    const xref = Number(/startxref\n(\d+)/.exec(text)![1])
    expect(text.slice(xref, xref + 4)).toBe('xref')
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]))
    offsets.forEach((o, i) => expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`))
    const start = text.indexOf('stream\n', text.indexOf('/Subtype /Image')) + 7, length = Number(/\/Subtype \/Image[^>]*\/Length (\d+)/.exec(text)![1])
    const rgb = inflateSync(pdf.subarray(start, start + length))
    expect(rgb.length).toBe(30 * 20 * 3)
    expect([...rgb.subarray(0, 3)]).toEqual([...px.data.subarray(0, 3)])
    // The title is UTF-16BE so Chinese survives.
    expect(text.toUpperCase()).toContain('<FEFF6C345FAA73AF')
  })
  it('keeps transparency as a soft mask and rejects malformed input', async () => {
    const px = scene(8, 8); px.data[3] = 0
    expect(objects(Buffer.from(await buildPdf(px, 't', deflate)))).toContain('/SMask 7 0 R')
    await expect(buildPdf({ width: 2, height: 2, data: new Uint8Array(3) }, 't', deflate)).rejects.toThrow()
  })
})
