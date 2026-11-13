import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkClient } from '../src/ark.js'
import { CanvasStore } from '../src/store.js'
import { Seedream } from '../src/service.js'
import { Preferences } from '../src/preferences.js'
import { createHandlers } from '../src/routes.js'
import { alignLayers, layerBounds, parseCompositionEdit, parseDecompose } from '../src/shared/layers.js'
import type { CanvasLayer, Composition } from '../src/shared/types.js'
import { EditorModel } from '../src/client/editor-model.js'
import { png } from './fixtures.js'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'seedream-layers-')) })
afterEach(async () => { vi.useRealTimers(); await rm(root, { recursive: true, force: true }) })
const meta = { title: '雨林', prompt: 'rainforest', refs: [], externalRefs: 0, size: '2K' }
const shape = (id: string, x = 0, y = 0): CanvasLayer => ({ id, name: id, kind: 'rect', x, y, width: 100, height: 80, rotation: 0, opacity: 1, hidden: false, locked: false, fill: '#112233', stroke: '#ffffff', strokeWidth: 0 })
const scene = (): Composition => ({ id: 'aaaaaaaaaaaa', title: '画板', sourceId: 'bbbbbbbbbbbb', x: 0, y: 0, width: 1000, height: 800, background: 'transparent', version: 0, layers: [shape('a'), shape('b', 200, 100)] })
const status = async () => ({ version: '0', configured: true, keyRef: 'ARK_API_KEY', model: 'm', defaultSize: '2K', watermark: true })
const request = (name: string, body: unknown, method = 'POST', session = 's') => new Request(`http://local/api/seedream/${name}?session=${session}`, { method, body: JSON.stringify(body) })

describe('decomposition contract and persistence', () => {
  it('restores layers by their bounding boxes, keeps immutable originals and survives reload', async () => {
    const bodies: Record<string, unknown>[] = []
    const fetch = vi.fn(async (_url, init) => {
      if (init?.body) { bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ data: [
        { url: 'https://cdn.test/base', z_index: 0 },
        { url: 'https://cdn.test/frog', z_index: 2, name: '树蛙', bounding_box: { absolute: [320, 280, 480, 400] }, text_recognition: { text: 'Tree frog' } },
      ] })) }
      return new Response(String(_url).endsWith('base') ? png(1000, 800) : png(1600, 1200))
    }) as typeof globalThis.fetch
    const store = new CanvasStore(root), api = new ArkClient({ apiKey: async () => 'test', timeoutMs: 5000, userAgent: 'test', fetch }), service = new Seedream(api, store)
    const { items: [source] } = await store.add('s', [{ bytes: png(1000, 800), width: 1000, height: 800 }], meta)
    const result = await service.decompose('s', parseDecompose({ image: `item:${source!.id}`, max_images: 12 }, false), new AbortController().signal)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ layer_decomposition: true, layer_decomposition_options: { max_images: 12, text_recognition: true }, size: 'auto', output_format: 'png', watermark: false })
    expect(bodies[0]).not.toHaveProperty('background')
    expect(result.composition.layers[0]).toMatchObject({ locked: true, width: 1000, height: 800 })
    expect(result.composition.layers[1]).toMatchObject({ name: '树蛙', x: 320, y: 280, width: 160, height: 120 })
    expect(result.items[1]).toMatchObject({ width: 1600, height: 1200, role: 'layer', layerMetadata: { textRecognition: { text: 'Tree frog' } } })
    expect(await store.readImage('s', source!.id)).toEqual(Buffer.from(png(1000, 800)))
    const moved = { ...result.composition, layers: result.composition.layers.map((l, i) => i === 1 ? { ...l, x: 1250, rotation: 25 } : l) }
    const saved = await store.editComposition('s', moved.id, 0, moved)
    expect(saved.composition.version).toBe(1)
    const reloaded = await new CanvasStore(root).get('s')
    expect(reloaded.compositions![0]!.layers[1]).toMatchObject({ x: 1250, rotation: 25, assetId: result.items[1]!.id })
    expect((await store.list())[0]!.count).toBe(2)
    await expect(store.editComposition('s', moved.id, 0, moved)).rejects.toThrow('其他窗口')
    await expect(store.remove('s', source!.id)).rejects.toThrow('仍被')
    await store.removeComposition('s', moved.id)
    expect(await store.readImage('s', result.items[1]!.id)).toEqual(Buffer.from(png(1600, 1200)))
  })
  it('does not discard other billed files or retry generation after a download failure', async () => {
    const fetch = vi.fn(async (url, init) => {
      if (init?.body) return new Response(JSON.stringify({ data: [{ url: 'https://cdn.test/base', z_index: 0 }, { url: 'https://cdn.test/bad', z_index: 1 }, { url: 'https://cdn.test/good', z_index: 2, bounding_box: { absolute: [10, 20, 30, 40] } }] }))
      if (String(url).endsWith('bad')) return new Response('gone', { status: 404 })
      return new Response(png(1000, 800))
    }) as typeof globalThis.fetch
    const result = await new ArkClient({ apiKey: async () => 'test', timeoutMs: 5000, userAgent: 't', fetch }).generate({ prompt: 'split', images: ['https://source.test/a.png'], size: 'auto', watermark: false, decomposition: { maxImages: 3 } }, new AbortController().signal)
    expect(result.images.map(i => i.layer?.zIndex)).toEqual([0, 2]); expect(result.warnings).toHaveLength(1)
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(vi.mocked(fetch).mock.calls).toHaveLength(4)
  })
  it('persists a completed split after the caller stops waiting', async () => {
    let finish!: () => void
    const gate = new Promise<void>(r => { finish = r })
    const fetch = vi.fn(async (_url, init) => {
      if (init?.body) { await gate; return new Response(JSON.stringify({ data: [{ url: 'https://cdn.test/base', z_index: 0 }] })) }
      return new Response(png(1000, 800))
    }) as typeof globalThis.fetch
    const store = new CanvasStore(root), service = new Seedream(new ArkClient({ apiKey: async () => 'k', userAgent: 't', timeoutMs: 5000, fetch }), store)
    const { items: [source] } = await store.add('s', [{ bytes: png(1000, 800), width: 1000, height: 800 }], meta)
    const control = new AbortController(), running = service.decompose('s', parseDecompose({ image: `item:${source!.id}` }, false), control.signal)
    await vi.waitFor(() => expect(service.pending('s')).toHaveLength(1))
    control.abort(); finish(); await running
    expect((await store.get('s')).compositions).toHaveLength(1); expect(service.pending('s')).toEqual([])
  })
})
describe('edit route boundaries', () => {
  it('accepts local artboards without AI and rejects foreign assets, unsafe numbers and stale writes', async () => {
    const fetch = vi.fn(), store = new CanvasStore(root), service = new Seedream(new ArkClient({ apiKey: async () => 'k', timeoutMs: 1000, userAgent: 't', fetch }), store)
    const h = createHandlers(service, new Preferences(join(root, 'prefs.json'), { size: '2K', watermark: true }), status)
    const { items: [source] } = await store.add('s', [{ bytes: png(1000, 800), width: 1000, height: 800 }], meta)
    const created = await (await h.composition(request('composition', { sourceId: source!.id }))).json() as { value: { composition: Composition } }
    const comp = created.value.composition
    expect(fetch).not.toHaveBeenCalled()
    const badLayer = { ...comp.layers[0]!, assetId: 'eeeeeeeeeeee' }
    expect((await h.composition(request('composition', { id: comp.id, version: 0, composition: { ...comp, layers: [badLayer] } }, 'PATCH'))).status).toBe(400)
    expect((await h.composition(request('composition', { id: comp.id, version: 0, composition: { ...comp, layers: [shape('x', Infinity)] } }, 'PATCH'))).status).toBe(400)
    expect((await h.composition(request('composition', { id: comp.id, version: 0, composition: comp }, 'PATCH'))).status).toBe(200)
    expect((await h.composition(request('composition', { id: comp.id, version: 0, composition: comp }, 'PATCH'))).status).toBe(409)
    const artifact = await (await h.composite(request('composite', { png: `data:image/png;base64,${Buffer.from(png(256, 128)).toString('base64')}`, title: '合成', asLayer: true }))).json() as { value: { item: { role: string; width: number } } }
    expect(artifact.value.item).toMatchObject({ role: 'layer', width: 256 })
    expect((await h.composite(request('composite', { png: 'file:///private/a.png' }))).status).toBe(400)
    expect((await h.composition(request('composition', { sourceId: source!.id }, 'POST', 'other'))).status).toBe(400)
    expect(JSON.parse(await readFile(join(root, 's', 'canvas.json'), 'utf8')).compositions).toHaveLength(1)
  })
  it('does not share the canvas revision with an artboard revision', async () => {
    const store = new CanvasStore(root), image = { bytes: png(1000, 800), width: 1000, height: 800 }
    const { items: [source] } = await store.add('s', [image], meta)
    const { composition } = await store.createComposition('s', source!.id)
    await store.add('s', [image], meta)
    const edited = await store.editComposition('s', composition.id, 0, { ...composition, layers: [...composition.layers, shape('new')] })
    expect(edited.canvas.items).toHaveLength(2); expect(edited.composition.layers).toHaveLength(2)
  })
  it('recovers a conflicting edit as a separate artboard without overwriting the saved version', async () => {
    const store = new CanvasStore(root), image = { bytes: png(1000, 800), width: 1000, height: 800 }
    const { items: [source] } = await store.add('s', [image], meta)
    const { composition } = await store.createComposition('s', source!.id)
    await store.editComposition('s', composition.id, 0, { ...composition, title: 'Other window' })
    const local = { ...composition, title: 'My work', layers: [...composition.layers, shape('added', 1200)] }
    await expect(store.editComposition('s', composition.id, 0, local)).rejects.toThrow('其他窗口')
    const { composition: recovered } = await store.createComposition('s', source!.id, local)
    expect(recovered.id).not.toBe(composition.id); expect(recovered.version).toBe(0)
    const saved = await store.get('s')
    expect(saved.compositions!.map(c => c.title)).toEqual(['Other window', 'My work'])
    expect(recovered.layers.at(-1)).toMatchObject({ id: 'added', x: 1200 })
    await expect(store.createComposition('s', source!.id, { ...local, layers: [{ ...local.layers[0], assetId: 'eeeeeeeeeeee' }] })).rejects.toThrow('当前对话')
  })
})
describe('editor saves and history', () => {
  it('serializes saves without overwriting edits made during a pending write', async () => {
    vi.useFakeTimers()
    let release!: (c: Composition) => void
    const save = vi.fn<(c: Composition, version: number) => Promise<Composition>>()
      .mockImplementationOnce(() => new Promise(r => { release = r }))
      .mockImplementation(async (c, v) => ({ ...c, version: v + 1 }))
    const editor = new EditorModel(scene(), save)
    editor.change(c => ({ ...c, title: 'first' })); const waiting = editor.flush()
    editor.change(c => ({ ...c, title: 'second' }))
    release({ ...scene(), title: 'first', version: 1 }); expect(await waiting).toBe(true)
    expect(save.mock.calls.map(([c, v]) => [c.title, v])).toEqual([['first', 0], ['second', 1]])
    expect(editor.getSnapshot()).toMatchObject({ composition: { title: 'second' }, dirty: false, saving: false })
    editor.undo(); expect(editor.getSnapshot().composition.title).toBe('first')
    editor.redo(); expect(editor.getSnapshot().composition.title).toBe('second')
    await editor.flush(); editor.dispose()
  })
  it('keeps failed saves and supports an explicit retry with the same version', async () => {
    vi.useFakeTimers()
    const save = vi.fn<(c: Composition, v: number) => Promise<Composition>>().mockRejectedValueOnce(new Error('offline')).mockImplementation(async (c, v) => ({ ...c, version: v + 1 }))
    const editor = new EditorModel(scene(), save)
    editor.change(c => ({ ...c, layers: c.layers.filter(l => l.id !== 'a') })); expect(await editor.flush()).toBe(false)
    expect(editor.getSnapshot()).toMatchObject({ dirty: true, error: 'offline' }); expect(editor.getSnapshot().composition.layers).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(5000); expect(save).toHaveBeenCalledTimes(1)
    expect(await editor.flush()).toBe(true); expect(save.mock.calls.map(([, v]) => v)).toEqual([0, 0])
    editor.undo(); expect(editor.getSnapshot().composition.layers).toHaveLength(2); await editor.flush(); editor.dispose()
  })
})
describe('layer geometry and validation', () => {
  it('aligns rotated objects using their visible bounds and leaves locked layers alone', () => {
    const a = { ...shape('a', 10, 20), rotation: 90 }, b = shape('b', 250, 200), locked = { ...shape('locked', 500), locked: true }
    expect(layerBounds(a)).toMatchObject({ x: -70, y: 20, width: 80, height: 100 })
    const aligned = alignLayers([a, b, locked], new Set(['a', 'b', 'locked']), 'left')
    expect(layerBounds(aligned[0]!).x).toBeCloseTo(layerBounds(aligned[1]!).x)
    expect(aligned[2]).toEqual(locked)
    const grid = alignLayers([a, b], new Set(['a', 'b']), 'grid')
    expect(layerBounds(grid[1]!).x).toBeGreaterThan(layerBounds(grid[0]!).x + 80)
  })
  it('limits billed output and whitelists scene data', () => {
    for (const maxImages of [0, 1, 101, 3.5, '10']) expect(() => parseDecompose({ image: 'item:aaaaaaaaaaaa', maxImages }, false)).toThrow()
    expect(() => parseDecompose({ image: '/tmp/a.png' }, false)).toThrow()
    const c = scene(); expect(parseCompositionEdit({ ...c, extra: 'drop me', layers: [{ ...shape('a'), url: 'https://foreign.test/secret' }] }, new Set()).layers[0]).not.toHaveProperty('url')
    expect(() => parseCompositionEdit({ ...c, layers: [shape('a'), shape('a')] }, new Set())).toThrow('重复')
    expect(() => parseCompositionEdit({ ...c, layers: [{ ...shape('a'), fill: 'url(javascript:alert(1))' }] }, new Set())).toThrow('颜色')
  })
})
