import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI4ScholarClient } from '../src/ai4scholar.js'
import type { GeneratedImage } from '../src/image-data.js'
import type { ImageRequest } from '../src/ai4scholar.js'
import { decodePixels, encodePixels, finishImageEdit, prepareImageEdit } from '../src/image-edit.js'
import type { Pixels } from '../src/pixels.js'
import { parseImageEdit } from '../src/shared/image-edit.js'
import { parseGenerate } from '../src/shared/types.js'
import { bboxTag, cleanRegions, decomposePrompt } from '../src/shared/regions.js'
import { CanvasStore } from '../src/store.js'
import { Seedream } from '../src/service.js'

const solid = (width: number, height: number, rgba: number[]): Pixels => ({ width, height, data: Uint8Array.from({ length: width * height * 4 }, (_, i) => rgba[i % 4]!) })
const image = (p: Pixels): GeneratedImage => ({ bytes: encodePixels(p), width: p.width, height: p.height, mime: 'image/png' })
let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'seedream-regions-')) })
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }) })

describe('Normalized <bbox> coordinates', () => {
  it('normalizes pixel boxes to 0–1000, left top right bottom, clamped and non-empty', () => {
    expect(bboxTag({ x: 180, y: 64, width: 632, height: 134 }, 1000, 1000)).toBe('<bbox>180 64 812 198</bbox>')
    expect(bboxTag({ x: 0, y: 0, width: 2496, height: 1664 }, 2496, 1664)).toBe('<bbox>0 0 1000 1000</bbox>')
    expect(bboxTag({ x: 100, y: 100, width: 0, height: 0 }, 2000, 2000)).toBe('<bbox>50 50 51 51</bbox>')
    expect(cleanRegions([{ x: -10, y: 5, width: 30, height: 1 }, { x: 90, y: 90, width: 40, height: 40 }], 100, 100)).toEqual([{ x: 90, y: 90, width: 10, height: 10 }])
  })
  it('appends regions to the decomposition note only when some are selected', () => {
    expect(decomposePrompt('拆分图层', [], 100, 100)).toBe('拆分图层')
    const prompt = decomposePrompt('拆分图层', [{ x: 10, y: 20, width: 30, height: 40 }, { x: 50, y: 50, width: 50, height: 50 }], 100, 100)
    expect(prompt).toContain('<bbox>100 200 400 600</bbox>、<bbox>500 500 1000 1000</bbox>')
    expect(prompt.startsWith('拆分图层\n')).toBe(true)
  })
})

describe('inpaint', () => {
  const input = (patch: Record<string, unknown> = {}) => parseImageEdit({ operation: 'inpaint', image: 'item:aaaaaaaaaaaa', requestId: 'inpaint-001', prompt: '画一个量筒', regions: [{ x: 10, y: 10, width: 20, height: 20 }], feather: 0, ...patch }, false)
  it('requires a description and rectangles, and rejects masks', () => {
    expect(() => input({ prompt: '' })).toThrow('描述')
    expect(() => input({ regions: [] })).toThrow('框选')
    expect(() => input({ regions: Array.from({ length: 17 }, () => ({ x: 0, y: 0, width: 1, height: 1 })) })).toThrow('1–16')
    expect(() => input({ mask: 'data:image/png;base64,AAAA' })).toThrow()
  })
  it('sends bbox tags with the request and restores every pixel outside the boxes', () => {
    const source = solid(64, 48, [20, 40, 60, 255]), prepared = prepareImageEdit(input(), encodePixels(source))
    expect(prepared.request.images).toHaveLength(1)
    expect(prepared.request.prompt).toContain('<bbox>156 208 469 625</bbox>')
    expect(prepared.request.prompt).toContain('画一个量筒')
    const out = decodePixels(finishImageEdit(prepared, image(solid(64, 48, [250, 250, 250, 255]))).image.bytes)
    for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4, inside = x >= 10 && x < 30 && y >= 10 && y < 30
      expect(out.data[i]).toBe(inside ? 250 : 20)
    }
  })
})

describe('inpaint clipping', () => {
  it('warns when the model drew past a box edge, and not when it stayed inside', () => {
    const input = parseImageEdit({ operation: 'inpaint', image: 'item:aaaaaaaaaaaa', requestId: 'inpaint-002', prompt: '画一个量筒', regions: [{ x: 10, y: 10, width: 20, height: 20 }], feather: 0 }, false)
    const source = solid(64, 48, [240, 240, 240, 255]), prepared = prepareImageEdit(input, encodePixels(source))
    const inside = { ...source, data: new Uint8Array(source.data) }
    for (let y = 12; y < 28; y++) for (let x = 12; x < 28; x++) inside.data.set([30, 30, 30], (y * 64 + x) * 4)
    expect(finishImageEdit(prepared, image(inside)).warnings).toEqual([])
    const shadow = { ...inside, data: new Uint8Array(inside.data) }
    for (let y = 26; y < 40; y++) for (let x = 6; x < 40; x++) if (!(x >= 10 && x < 30 && y >= 10 && y < 30)) shadow.data.set([120, 120, 120], (y * 64 + x) * 4)
    expect(finishImageEdit(prepared, image(shadow)).warnings.join()).toContain('框外也画了内容')
  })
})

describe('transparent text-to-image', () => {
  async function setup(result: Pixels) {
    const store = new CanvasStore(root), api = new AI4ScholarClient({ apiKey: async () => 'sk-user-fixture', userAgent: 't', timeoutMs: 1000, fetch: vi.fn() }), requests: ImageRequest[] = []
    vi.spyOn(api, 'generate').mockImplementation(async r => { requests.push(r); return { images: [image(result)] } })
    return { store, requests, service: new Seedream(api, store) }
  }
  it('requests a transparent PNG, records it, and only then', async () => {
    const cut = solid(32, 32, [10, 20, 30, 255]); cut.data[3] = 0
    const { service, requests } = await setup(cut)
    const a = await service.generate('s', parseGenerate({ prompt: '一个烧杯图标', transparent: true }, { size: '2K', watermark: false }), new AbortController().signal)
    expect(requests[0]).toMatchObject({ background: 'transparent' })
    expect(requests[0]!.prompt).toContain('透明')
    expect(a.items[0]).toMatchObject({ transparent: true })
    expect(a.items[0]!.warnings).toBeUndefined()
    await service.generate('s', parseGenerate({ prompt: '一个烧杯图标' }, { size: '2K', watermark: false }), new AbortController().signal)
    expect(requests[1]!.background).toBeUndefined()
    expect(() => parseGenerate({ prompt: 'x', transparent: 'yes' }, { size: '2K', watermark: false })).toThrow('transparent')
  })
  it('keeps an opaque result but warns when no transparency came back', async () => {
    const { service } = await setup(solid(32, 32, [10, 20, 30, 255]))
    const result = await service.generate('s', parseGenerate({ prompt: '烧杯', transparent: true }, { size: '2K', watermark: false }), new AbortController().signal)
    expect(result.items[0]!.warnings?.join()).toContain('未返回透明')
  })
  it('passes opaque for consistent repeated edits and rejects it with transparent', async () => {
    const { service, requests } = await setup(solid(32, 32, [10, 20, 30, 255]))
    await service.generate('s', parseGenerate({ prompt: '把烧杯换成蓝色', opaque: true }, { size: '2K', watermark: false }), new AbortController().signal)
    expect(requests[0]!.background).toBe('opaque')
    expect(() => parseGenerate({ prompt: 'x', opaque: true, transparent: true }, { size: '2K', watermark: false })).toThrow('不能同时')
  })
})

