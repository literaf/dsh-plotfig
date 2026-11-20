import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasStore, GAP } from '../src/store.js'
import { AI4ScholarClient } from '../src/ai4scholar.js'
import { Seedream } from '../src/service.js'
import { createHandlers } from '../src/routes.js'
import { Preferences } from '../src/preferences.js'
import { drawingFetch, png } from './fixtures.js'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'seedream-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const meta = { title: '雨林', prompt: 'rainforest', refs: [], externalRefs: 0, size: '2K' }
const image = (w = 1330, h = 1773) => ({ bytes: png(w, h), width: w, height: h })
function service(fetch?: typeof globalThis.fetch) {
  const bodies: Array<Record<string, unknown>> = []
  const f = fetch ?? vi.fn(drawingFetch(body => { bodies.push(body) }))
  const store = new CanvasStore(join(root, 'canvases'))
  return { store, bodies, fetch: f, seedream: new Seedream(new AI4ScholarClient({ apiKey: async () => 'sk-user-fixture', timeoutMs: 5000, userAgent: 't', fetch: f }), store) }
}
describe('canvas store', () => {
  it('lays out new images left to right with private files and bumps the revision', async () => {
    const store = new CanvasStore(join(root, 'canvases'))
    const first = await store.add('sess_a', [image()], meta)
    const second = await store.add('sess_a', [image(1024, 1024), image(1024, 1024)], { ...meta, title: '分图层' })
    expect(first.items[0]).toMatchObject({ x: 0, y: 0, width: 1330 })
    expect(second.items.map(i => i.x)).toEqual([1330 + GAP, 1330 + GAP + 1024 + GAP])
    expect(second.items.map(i => i.title)).toEqual(['分图层_1', '分图层_2'])
    expect(second.canvas.revision).toBe(2)
    const file = store.imagePath('sess_a', first.items[0]!.id)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await readdir(join(root, 'canvases', 'sess_a'))).toEqual(['canvas.json', 'images'])
  })
  it('serializes concurrent writes so no item is lost', async () => {
    const store = new CanvasStore(join(root, 'canvases'))
    await Promise.all(Array.from({ length: 6 }, () => store.add('sess_a', [image()], meta)))
    const canvas = await store.get('sess_a')
    expect(canvas.items).toHaveLength(6); expect(canvas.revision).toBe(6); expect(new Set(canvas.items.map(i => i.x)).size).toBe(6)
  })
  it('accepts standalone canvas ids and lists them only after the first image', async () => {
    const store = new CanvasStore(join(root, 'canvases')), id = 'board-' + crypto.randomUUID()
    expect((await store.get(id)).items).toEqual([]); expect(await store.list()).toEqual([])
    await store.add(id, [image()], meta)
    expect((await store.list()).map(e => e.sessionId)).toEqual([id])
  })
  it('rejects traversal in session and item ids', async () => {
    const store = new CanvasStore(join(root, 'canvases'))
    for (const bad of ['../x', 'a/b', '', '.hidden']) expect(() => store.directory(bad)).toThrow()
    for (const bad of ['../../etc', 'ABCDEF123456', 'short']) expect(() => store.imagePath('sess_a', bad)).toThrow()
  })
  it('moves only known items and removes image files', async () => {
    const store = new CanvasStore(join(root, 'canvases'))
    const { items: [item] } = await store.add('sess_a', [image()], meta)
    const moved = await store.move('sess_a', [{ id: item!.id, x: 10.6, y: -5 }, { id: 'ffffffffffff', x: 1, y: 1 }, { id: item!.id, x: Number.NaN, y: 0 }])
    expect(moved.items[0]).toMatchObject({ x: 11, y: -5 })
    await store.remove('sess_a', item!.id)
    await expect(store.readImage('sess_a', item!.id)).rejects.toThrow()
    expect(await store.list()).toEqual([])
  })
})
describe('generation service', () => {
  it('sends canvas items from the same Session only, as data URLs', async () => {
    const { seedream, store, bodies } = service()
    const { items: [source] } = await store.add('sess_a', [image()], meta)
    const result = await seedream.generate('sess_a', { prompt: '改成夜景', images: [`item:${source!.id}`], size: '2K', watermark: false }, new AbortController().signal)
    expect(bodies[0]!.images).toEqual([expect.stringMatching(/^data:image\/png;base64,/)])
    expect(bodies[0]!.watermark).toBe(false)
    expect(result.items[0]).toMatchObject({ refs: [source!.id], y: source!.y, title: '改成夜景' })
    await expect(seedream.generate('sess_b', { prompt: 'x', images: [`item:${source!.id}`], size: '2K', watermark: true }, new AbortController().signal)).rejects.toThrow('没有图片')
  })
  it('allows local files only for agent calls', async () => {
    const { seedream, bodies } = service()
    const path = join(root, 'ref.jpg'); await writeFile(path, 'jpegbytes')
    await expect(seedream.generate('sess_a', { prompt: 'x', images: [path], size: '2K', watermark: true }, new AbortController().signal, false)).rejects.toThrow('无法识别')
    await seedream.generate('sess_a', { prompt: 'x', images: [path], size: '2K', watermark: true }, new AbortController().signal, true)
    expect(bodies[0]!.images).toEqual([`data:image/jpeg;base64,${Buffer.from('jpegbytes').toString('base64')}`])
    await expect(seedream.generate('sess_a', { prompt: 'x', images: ['data:image/PNG;base64,AA'], size: '2K', watermark: true }, new AbortController().signal)).rejects.toThrow('小写')
    await expect(seedream.generate('sess_a', { prompt: 'x', images: ['file:///etc/passwd'], size: '2K', watermark: true }, new AbortController().signal, true)).rejects.toThrow('无法识别')
  })
})
describe('in-flight generations', () => {
  it('reports a running conversation generation on the canvas and the catalogue, then clears it', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const fetch = vi.fn(drawingFetch(() => gate))
    const { seedream } = service(fetch)
    const h = createHandlers(seedream, new Preferences(join(root, 'settings.json'), { size: '2K', watermark: true }), async () => ({ version: '0', configured: true, keyRef: 'AI4SCHOLAR_API_KEY', model: 'm', defaultSize: '2K', watermark: true }))
    const running = seedream.generate('sess_new', { prompt: '雨林动物分布图', images: [], size: '2K', watermark: true }, new AbortController().signal, true)
    await new Promise(r => setTimeout(r, 0))
    const canvas = await (await h.canvas(new Request('http://x/api/seedream/canvas?session=sess_new'))).json() as { value: { items: unknown[]; pending: Array<{ prompt: string }> } }
    expect(canvas.value.items).toHaveLength(0); expect(canvas.value.pending.map(p => p.prompt)).toEqual(['雨林动物分布图'])
    const catalog = await (await h.catalog()).json() as { value: { canvases: Array<{ sessionId: string; count: number }>; active: Record<string, unknown[]> } }
    expect(catalog.value.canvases).toEqual([expect.objectContaining({ sessionId: 'sess_new', count: 0 })]); expect(Object.keys(catalog.value.active)).toEqual(['sess_new'])
    release(); await running
    expect(seedream.pending('sess_new')).toEqual([]); expect(seedream.active()).toEqual({})
    const failing = service(vi.fn(async () => new Response('{"error":{"message":"x"}}', { status: 500 })) as unknown as typeof globalThis.fetch).seedream
    await expect(failing.generate('sess_x', { prompt: 'x', images: [], size: '2K', watermark: true }, new AbortController().signal)).rejects.toThrow()
    expect(failing.active()).toEqual({})
  })
})
describe('routes', () => {
  const status = async () => ({ version: '0', configured: true, keyRef: 'AI4SCHOLAR_API_KEY', model: 'm', defaultSize: '2K', watermark: true })
  it('serves images with safe headers and validates query ids', async () => {
    const { seedream, store } = service()
    const prefs = new Preferences(join(root, 'settings.json'), { size: '2K', watermark: true })
    const h = createHandlers(seedream, prefs, status)
    const { items: [item] } = await store.add('sess_a', [image()], meta)
    const response = await h.image(new Request(`http://x/api/seedream/image?session=sess_a&id=${item!.id}`))
    expect(response.headers.get('content-type')).toBe('image/png'); expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png(1330, 1773))
    expect((await h.image(new Request('http://x/api/seedream/image?session=../x&id=aaaaaaaaaaaa'))).status).toBe(404)
    const catalog = await (await h.catalog()).json() as { value: { canvases: Array<{ sessionId: string; cover: string }> } }
    expect(catalog.value.canvases).toEqual([expect.objectContaining({ sessionId: 'sess_a', cover: item!.id })])
  })
  it('generates from the browser without accepting local paths, and persists settings', async () => {
    const { seedream, bodies } = service()
    const prefs = new Preferences(join(root, 'settings.json'), { size: '2K', watermark: true })
    const h = createHandlers(seedream, prefs, status)
    const post = (path: string, body: unknown) => new Request(`http://x${path}`, { method: 'POST', body: JSON.stringify(body) })
    expect((await h.generate(post('/api/seedream/generate?session=sess_a', { prompt: 'x', images: ['/etc/passwd'] }))).status).toBe(400)
    await h.settings(post('/api/seedream/settings', { size: '1K', watermark: false }))
    expect(JSON.parse(await readFile(join(root, 'settings.json'), 'utf8'))).toEqual({ size: '1K', watermark: false })
    const reply = await (await h.generate(post('/api/seedream/generate?session=sess_a', { prompt: '猫' }))).json() as { ok: boolean; value: { created: string[] } }
    expect(reply.ok).toBe(true); expect(reply.value.created).toHaveLength(1)
    expect(bodies.at(-1)).toMatchObject({ size: '1K', watermark: false })
    expect((await h.settings(post('/api/seedream/settings', { size: '8K' }))).status).toBe(400)
  })
})
