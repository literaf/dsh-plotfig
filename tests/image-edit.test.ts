import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import jpeg from 'jpeg-js'
import { ArkClient } from '../src/ark.js'
import type { ArkImage } from '../src/ark.js'
import { decodePixels, encodePixels, eraseMask, featherEraseMask, finishImageEdit, prepareImageEdit, refineCutoutEdges, resizePixels } from '../src/image-edit.js'
import type { Pixels } from '../src/image-edit.js'
import { arkEditDimensions, editDimensions, expandedLayerBox, parseImageEdit } from '../src/shared/image-edit.js'
import { parseSize } from '../src/shared/types.js'
import { CanvasStore } from '../src/store.js'
import { Seedream } from '../src/service.js'
import { Preferences } from '../src/preferences.js'
import { createHandlers } from '../src/routes.js'

const pixels = (width = 16, height = 16): Pixels => ({ width, height, data: Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 37 % 256) })
const image = (p: Pixels): ArkImage => ({ ...p, bytes: encodePixels(p), mime: 'image/png' })
const maskUrl = (p: Pixels) => `data:image/png;base64,${Buffer.from(encodePixels(p)).toString('base64')}`
const input = (patch: Record<string, unknown> = {}) => parseImageEdit({ operation: 'remove-background', image: 'item:aaaaaaaaaaaa', requestId: 'request-001', ...patch }, false)
const meta = { title: '测试原图', prompt: 'fixture', refs: [], externalRefs: 0, size: '16x16' }
let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'seedream-edit-')) })
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }) })

describe('image editing pixels and input contract', () => {
  it('feathers only inside irregular selections, preserving holes and full-strength interiors', () => {
    const mask = new Uint8Array(60 * 60)
    for (let y = 5; y < 55; y++) mask.fill(255, y * 60 + 5, y * 60 + 55)
    mask[30 * 60 + 30] = 0
    const feathered = featherEraseMask(mask, 60, 60, 8)
    for (let p = 0; p < mask.length; p++) if (!mask[p]) expect(feathered[p]).toBe(0)
    expect(feathered[5 * 60 + 20]).toBeLessThan(32)
    expect(feathered[6 * 60 + 20]).toBeGreaterThan(feathered[5 * 60 + 20]!)
    expect(feathered[20 * 60 + 20]).toBe(255)
    expect(feathered[30 * 60 + 29]).toBeLessThan(32)
    expect(featherEraseMask(mask, 60, 60, 0)).toBe(mask)
  })
  it('decontaminates supported white fringes without deleting alpha, opaque whites or isolated fine details', () => {
    const p = { width: 5, height: 1, data: new Uint8Array([40, 80, 120, 255, 148, 168, 188, 128, 255, 255, 255, 0, 255, 255, 255, 255, 10, 20, 30, 100]) }
    const cleaned = refineCutoutEdges(p)
    for (let c = 0; c < 3; c++) expect(Math.abs(cleaned.data[4 + c]! - p.data[c]!)).toBeLessThanOrEqual(3)
    expect(cleaned.data.slice(12)).toEqual(p.data.slice(12))
    for (let i = 3; i < p.data.length; i += 4) expect(cleaned.data[i]).toBe(p.data[i])
  })
  it('rejects unsafe references, invalid regions and incompatible options before generation', () => {
    for (const patch of [
      { image: '/tmp/private.png' }, { image: 'https://example.test/a.png' }, { image: 'item:../../secret' },
      { operation: '__proto__' }, { requestId: '' }, { watermark: 'false' },
      { operation: 'erase' }, { operation: 'erase', regions: [{ x: -1, y: 0, width: 2, height: 3 }] },
      { operation: 'erase', regions: [{ x: 0, y: 0, width: 1.5, height: 3 }] },
      { operation: 'erase', mask: maskUrl(pixels()), regions: [] },
      { operation: 'expand', expand: { left: 0, right: 0, top: 0, bottom: 0 } },
      { operation: 'expand', expand: { left: 1, right: 0, top: 0, bottom: Infinity } },
      { regions: [] }, { expand: {} },
    ]) expect(() => input(patch)).toThrow()
    expect(() => editDimensions(16000, 16000)).toThrow()
    expect(() => editDimensions(1000, 16)).toThrow('宽高比')
    for (const [w, h] of [[16, 16], [16000, 1000], [1000, 16000], [4000, 4000], [1776, 998], [15, 240]]) {
      const size = arkEditDimensions(w!, h!)
      expect(() => parseSize(`${size.width}x${size.height}`, '2K')).not.toThrow()
    }
  })
  it('decodes real PNG/JPEG and interpolates transparent edges without dark fringes', () => {
    const p = pixels()
    expect(decodePixels(encodePixels(p))).toEqual({ ...p, data: Buffer.from(p.data) })
    const jpg = jpeg.encode({ ...p, data: Buffer.from(p.data) }, 90).data
    expect(decodePixels(jpg)).toMatchObject({ width: 16, height: 16 })
    const scaled = resizePixels({ width: 2, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0]) }, 3, 1)
    expect([...scaled.data.slice(4, 8)]).toEqual([255, 0, 0, 128])
  })
  it('keeps every RGBA byte outside the erase selection, including transparent pixel colors', () => {
    const source = pixels(), edited = pixels()
    edited.data.fill(255)
    const prepared = prepareImageEdit(input({ operation: 'erase', regions: [{ x: 3, y: 4, width: 5, height: 6 }] }), encodePixels(source))
    const result = decodePixels(finishImageEdit(prepared, image(edited)).image.bytes)
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4, selected = x >= 3 && x < 8 && y >= 4 && y < 10
      expect([...result.data.slice(i, i + 4)]).toEqual([...((selected ? edited : source).data.slice(i, i + 4))])
    }
    expect(prepared.request.images).toHaveLength(2)
    expect(prepared.request).not.toHaveProperty('mask')
  })
  it('validates mask dimensions and content, and blends a partial mask in premultiplied alpha', () => {
    const source = pixels(), mask = { ...pixels(), data: new Uint8Array(16 * 16 * 4) }
    expect(() => eraseMask(input({ operation: 'erase', mask: maskUrl(mask) }), source)).toThrow('先涂抹')
    expect(() => eraseMask(input({ operation: 'erase', mask: maskUrl(pixels(17, 16)) }), source)).toThrow('尺寸')
    expect(() => eraseMask(input({ operation: 'erase', regions: [{ x: 15, y: 0, width: 2, height: 1 }] }), source)).toThrow('超出')
    source.data.set([200, 0, 0, 128], 0); mask.data.set([255, 255, 255, 128], 0)
    const generated = pixels(); generated.data.set([0, 100, 0, 255], 0)
    const prepared = prepareImageEdit(input({ operation: 'erase', mask: maskUrl(mask) }), encodePixels(source))
    const out = decodePixels(finishImageEdit(prepared, image(generated)).image.bytes)
    expect([...out.data.slice(0, 4)]).toEqual([66, 67, 0, 192])
    expect(out.data.slice(4)).toEqual(Buffer.from(source.data.slice(4)))
  })
  it('copies the entire original rectangle exactly into every expansion offset', () => {
    const source = pixels(), expand = { left: 3, top: 5, right: 7, bottom: 9 }
    const prepared = prepareImageEdit(input({ operation: 'expand', expand }), encodePixels(source))
    expect(prepared.request.images).toHaveLength(1)
    const guide = decodePixels(Buffer.from(prepared.request.images[0]!.split(',')[1]!, 'base64'))
    expect(`${guide.width}x${guide.height}`).toBe(prepared.request.size)
    expect(guide.data[3]).toBe(0)
    expect(prepared.request.background).toBe('opaque')
    const generated = pixels(26, 30); generated.data.fill(245)
    const out = decodePixels(finishImageEdit(prepared, image(generated)).image.bytes)
    expect([out.width, out.height]).toEqual([26, 30])
    for (let y = 0; y < 30; y++) for (let x = 0; x < 26; x++) {
      const actual = [...out.data.slice((y * 26 + x) * 4, (y * 26 + x + 1) * 4)]
      expect(actual).toEqual(x >= 3 && x < 19 && y >= 5 && y < 21 ? [...source.data.slice(((y - 5) * 16 + x - 3) * 4, ((y - 5) * 16 + x - 2) * 4)] : [245, 245, 245, 245])
    }
    const layer = { x: 120, y: 80, width: 32, height: 48, rotation: 90 }, box = expandedLayerBox(layer, source, expand)
    expect(box).toEqual({ x: 135, y: 74, width: 52, height: 90 })
    expect(box.x - expand.top * 3).toBe(layer.x)
    expect(box.y + expand.left * 2).toBe(layer.y)
  })
  it('uses transparent output only for background removal and reports an opaque result', async () => {
    const p = pixels(), prepared = prepareImageEdit(input(), encodePixels(p)), bodies: Record<string, unknown>[] = []
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.body) { bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ data: [{ url: 'https://cdn.test/cutout.png' }] })) }
      return new Response(new Uint8Array(encodePixels(p)))
    }) as typeof globalThis.fetch
    const ark = new ArkClient({ apiKey: async () => 'test', userAgent: 'test', timeoutMs: 1000, fetch })
    await ark.generate(prepared.request, new AbortController().signal)
    expect(bodies[0]).toMatchObject({ background: 'transparent', output_format: 'png' })
    expect(finishImageEdit(prepared, image(p)).warnings).toEqual([])
    p.data.fill(255)
    expect(finishImageEdit(prepared, image(p)).warnings.join()).toContain('未返回透明')
    await expect(ark.generate({ ...prepared.request, decomposition: { maxImages: 3 } }, new AbortController().signal)).rejects.toThrow()
    expect(bodies).toHaveLength(1)
  })
  it('flags changed expansion anchors before restoring original pixels, without certifying unchanged outputs', () => {
    const source = { width: 32, height: 32, data: new Uint8Array(32 * 32 * 4).fill(255) }, generated = { width: 48, height: 48, data: new Uint8Array(48 * 48 * 4).fill(255) }
    const prepared = prepareImageEdit(input({ operation: 'expand', expand: { left: 8, right: 8, top: 8, bottom: 8 } }), encodePixels(source))
    expect(finishImageEdit(prepared, image(generated)).warnings).toEqual([])
    generated.data.fill(0)
    const result = finishImageEdit(prepared, image(generated))
    expect(result.warnings.join()).toContain('扩图需检查')
    const out = decodePixels(result.image.bytes)
    for (let y = 0; y < 32; y++) expect(out.data.subarray(((y + 8) * 48 + 8) * 4, ((y + 8) * 48 + 40) * 4)).toEqual(Buffer.from(source.data.subarray(y * 32 * 4, (y + 1) * 32 * 4)))
  })

})

describe('editing persistence, cancellation and session isolation', () => {
  async function setup() {
    const store = new CanvasStore(root), source = image(pixels())
    const { items: [item] } = await store.add('session-a', [source], meta)
    const ark = new ArkClient({ apiKey: async () => 'test', userAgent: 'test', timeoutMs: 1000, fetch: vi.fn() })
    const generate = vi.spyOn(ark, 'generate').mockResolvedValue({ images: [source] })
    const service = new Seedream(ark, store), request = input({ image: `item:${item!.id}` })
    return { store, source, item: item!, ark, generate, service, request }
  }
  it('deduplicates concurrent calls and persisted receipts after a service reload', async () => {
    const { service, request, generate, ark, store, item, source } = await setup()
    const [a, b] = await Promise.all([service.editImage('session-a', request, new AbortController().signal), service.editImage('session-a', request, new AbortController().signal)])
    expect(a.items[0]!.id).toBe(b.items[0]!.id); expect(generate).toHaveBeenCalledTimes(1)
    const loaded = new Seedream(ark, new CanvasStore(root))
    expect((await loaded.editImage('session-a', request, new AbortController().signal)).items[0]!.id).toBe(a.items[0]!.id)
    await expect(loaded.editImage('session-a', { ...request, prompt: 'different' }, new AbortController().signal)).rejects.toThrow('不同参数')
    expect(generate).toHaveBeenCalledTimes(1)
    expect(await store.readImage('session-a', item.id)).toEqual(Buffer.from(source.bytes))
  })
  it('persists late results after the caller aborts and prevents deletion while generating', async () => {
    const { service, request, generate, store, source, item } = await setup()
    let finish!: () => void
    generate.mockImplementation(async (_input, signal) => { await new Promise<void>(r => { finish = r }); expect(signal.aborted).toBe(false); return { images: [source] } })
    const control = new AbortController(), waiting = service.editImage('session-a', request, control.signal)
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    const h = createHandlers(service, new Preferences(join(root, 'prefs.json'), { size: '2K', watermark: false }), async () => ({ version: '0.1.0', model: 'test', configured: true, keyRef: 'ARK_API_KEY', defaultSize: '2K', watermark: false }))
    expect((await h.removeItem(new Request(`http://local/item?session=session-a&id=${item.id}`, { method: 'DELETE' }))).status).not.toBe(200)
    control.abort(); finish(); await waiting
    expect((await store.get('session-a')).items).toHaveLength(2)
    expect(service.pending('session-a')).toEqual([])
  })
  it('never bills invalid selections, another session, local paths or pre-aborted callers', async () => {
    const { service, request, generate } = await setup()
    await expect(service.editImage('session-b', request, new AbortController().signal)).rejects.toThrow('没有')
    await expect(service.editImage('session-a', input({ ...request, operation: 'erase', requestId: 'bad-mask-01', mask: maskUrl({ ...pixels(), data: new Uint8Array(1024) }) }), new AbortController().signal)).rejects.toThrow('先涂抹')
    await expect(service.editImage('session-a', request, AbortSignal.abort())).rejects.toThrow()
    const h = createHandlers(service, new Preferences(join(root, 'prefs.json'), { size: '2K', watermark: false }), async () => ({ version: '0', model: 'test', configured: true, keyRef: 'ARK_API_KEY', defaultSize: '2K', watermark: false }))
    expect((await h.editImage(new Request('http://local/edit-image?session=session-a', { method: 'POST', body: JSON.stringify({ ...request, image: '/tmp/private.png' }) }))).status).toBe(400)
    expect(generate).not.toHaveBeenCalled()
  })
  it('saves the paid raw image with a warning if local processing fails', async () => {
    const { service, request, generate, source, store } = await setup()
    const bad = { ...source, bytes: new Uint8Array([1, 2, 3]) }
    generate.mockResolvedValue({ images: [bad] })
    const result = await service.editImage('session-a', request, new AbortController().signal)
    expect(result.items[0]!.edit?.applied).toBe(false)
    expect(result.items[0]!.edit?.needsReview).toBe(true)
    expect(result.warnings.join()).toContain('已保留模型原始结果')
    expect(await store.readImage('session-a', result.items[0]!.id)).toEqual(Buffer.from(bad.bytes))
  })
  it('retains review warnings and the receipt after reopening the canvas', async () => {
    const { service, request, generate } = await setup()
    const opaque = { ...pixels(), data: new Uint8Array(16 * 16 * 4).fill(255) }
    generate.mockResolvedValue({ images: [image(opaque)] })
    const result = await service.editImage('session-a', request, new AbortController().signal)
    const stored = (await new CanvasStore(root).get('session-a')).items.find(item => item.id === result.items[0]!.id)!
    expect(stored.edit).toMatchObject({ applied: true, needsReview: true })
    expect(stored.warnings?.join()).toContain('未返回透明')
    expect(generate).toHaveBeenCalledTimes(1)
  })
  it('does not automatically retry upstream errors, even with the same request id', async () => {
    const { service, request, generate } = await setup()
    generate.mockRejectedValue(new Error('upstream failed'))
    await expect(service.editImage('session-a', request, new AbortController().signal)).rejects.toThrow('upstream failed')
    await expect(service.editImage('session-a', request, new AbortController().signal)).rejects.toThrow('upstream failed')
    expect(generate).toHaveBeenCalledTimes(1); expect(service.pending('session-a')).toEqual([])
  })
})
