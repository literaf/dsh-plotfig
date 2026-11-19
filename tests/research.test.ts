import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'
import { CanvasStore } from '../src/store.js'
import { Seedream } from '../src/service.js'
import { ArkClient } from '../src/ark.js'
import { Preferences } from '../src/preferences.js'
import { createHandlers } from '../src/routes.js'
import { applyTools } from '../src/tools.js'
import { parseGenerate } from '../src/shared/types.js'
import { RESEARCH_STYLES, parseGenerationStyle, styledPrompt, styleName } from '../src/shared/research.js'
import { decodePixels } from '../src/pixels.js'
import { png } from './fixtures.js'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'seedream-research-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const defaults = { size: '2K', watermark: false }
const status = async () => ({ version: '0.1.0', configured: false, keyRef: 'ARK_API_KEY', model: 'seedream', defaultSize: '2K', watermark: false })
const request = (body: unknown, session = 'first', method = 'POST') => new Request(`http://local/api/seedream/?session=${session}`, { method, body: JSON.stringify(body) })
const realPng = () => {
  const picture = new PNG({ width: 16, height: 8 })
  for (let i = 0; i < picture.data.length; i++) picture.data[i] = (i * 13) % 256
  return PNG.sync.write(picture)
}
function setup() {
  const bodies: Record<string, unknown>[] = []
  const fetch = vi.fn(async (_url, init) => {
    if (init?.body) { bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ data: [{ url: 'https://cdn.test/generated.png' }] })) }
    return new Response(png(1024, 1024))
  }) as typeof globalThis.fetch
  const store = new CanvasStore(join(root, 'canvases')), service = new Seedream(new ArkClient({ apiKey: async () => 'fixture-key', userAgent: 'test', timeoutMs: 5000, fetch }), store)
  const h = createHandlers(service, new Preferences(join(root, 'preferences.json'), defaults), status)
  return { store, service, h, fetch, bodies }
}

describe('canvas style across UI routes and conversation tools', () => {
  it('persists a per-canvas choice without billing and applies it through the native tool', async () => {
    const { store, service, h, bodies, fetch } = setup()
    expect((await h.canvas(request({ generationStyle: 'line-art' }, 'first', 'PATCH'))).status).toBe(200)
    expect(fetch).not.toHaveBeenCalled()
    expect((await new CanvasStore(store.root).get('first')).generationStyle).toBe('line-art')
    expect((await store.get('second')).generationStyle).toBeUndefined()
    const registered = new Map<string, { execute(a: unknown, e: unknown): Promise<unknown> }>()
    applyTools({ tools: { register(t: { name: string; execute(a: unknown, e: unknown): Promise<unknown> }) { registered.set(t.name, t) } }, inject: vi.fn() } as never, service, async () => defaults)
    const tool = registered.get('seedream_generate')!
    await tool.execute({ prompt: '保留 A→B 的顺序，绘制细胞信号示意图' }, { agent: { id: 'first' }, signal: new AbortController().signal })
    expect(bodies).toHaveLength(1)
    expect(bodies[0]!.prompt).toContain('清晰线稿风格')
    expect(bodies[0]!.prompt).toContain('保留 A→B 的顺序')
    const saved = await store.get('first')
    expect(saved.items[0]).toMatchObject({ generationStyle: 'line-art', prompt: bodies[0]!.prompt })
    await tool.execute({ prompt: '只调整标签', style: 'auto' }, { agent: { id: 'first' }, signal: new AbortController().signal })
    expect(bodies[1]!.prompt).toBe('只调整标签')
    expect((await store.get('first')).generationStyle).toBe('line-art')
    await tool.execute({ prompt: 'another canvas' }, { agent: { id: 'second' }, signal: new AbortController().signal })
    expect(bodies[2]!.prompt).toBe('another canvas')
  })
  it.each(RESEARCH_STYLES)('sends $id as visual instructions on a browser generation request', async style => {
    const { h, bodies } = setup()
    expect((await h.generate(request({ prompt: 'Signal → Cell → Response', style: style.id }))).status).toBe(200)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]!.prompt).toContain(style.prompt)
    expect(bodies[0]!.prompt).toContain('Signal → Cell → Response')
  })
  it('preserves the old journal appearance for persisted canvases while offering six current styles', async () => {
    const { store, h, bodies } = setup()
    await store.setGenerationStyle('first', 'journal')
    expect((await new CanvasStore(store.root).get('first')).generationStyle).toBe('journal')
    expect((await h.generate(request({ prompt: '保留原内容' }))).status).toBe(200)
    expect(bodies[0]!.prompt).toContain('简洁的期刊插图视觉语言')
    expect(bodies[0]!.prompt).not.toContain('自然写实')
    expect(styleName('journal')).toContain('旧预设')
    expect(RESEARCH_STYLES.map(s => s.id)).not.toContain('journal')
    expect(parseGenerationStyle('naturalistic')).toBe('naturalistic')
    expect(styledPrompt('保留红色边框和已有箭头', 'naturalistic')).toContain('保留红色边框和已有箭头')
    expect(styledPrompt('unchanged', 'auto')).toBe('unchanged')
  })
  it('rejects unknown styles and an overlong combined prompt before making any billable call', async () => {
    const { h, fetch, service } = setup()
    expect((await h.canvas(request({ generationStyle: 'copied-magic-style' }, 'first', 'PATCH'))).status).toBe(400)
    expect((await h.generate(request({ prompt: 'valid', style: {} }))).status).toBe(400)
    await expect(service.generate('first', parseGenerate({ prompt: 'x'.repeat(3999), style: '3d' }, defaults), new AbortController().signal)).rejects.toThrow('4000')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('serializes style selection with image saves without changing assets or artboard versions', async () => {
    const { store } = setup(), image = { bytes: png(1000, 800), width: 1000, height: 800 }, meta = { title: 'Original', prompt: 'original', refs: [], externalRefs: 0, size: '2K' }
    const { items } = await store.add('first', [image], meta)
    const { composition } = await store.createComposition('first', items[0]!.id)
    await Promise.all([store.setGenerationStyle('first', 'journal'), store.add('first', [image], meta)])
    const next = await store.get('first')
    expect(next.generationStyle).toBe('journal'); expect(next.items).toHaveLength(2)
    expect(next.compositions![0]).toEqual(composition)
    expect(await store.readImage('first', items[0]!.id)).toEqual(Buffer.from(image.bytes))
  })
})

describe('local image import', () => {
  it('preserves PNG bytes and transparency without an API key or model call', async () => {
    const { h, store, fetch } = setup(), bytes = realPng()
    const response = await h.importImage(request({ image: `data:image/png;base64,${bytes.toString('base64')}`, title: '本地图' }))
    expect(response.status).toBe(200)
    const { value } = await response.json() as { value: { item: { id: string; imported: boolean; width: number; height: number } } }
    expect(value.item).toMatchObject({ imported: true, width: 16, height: 8 })
    expect(await store.readImage('first', value.item.id)).toEqual(bytes)
    expect((await store.list())[0]!.count).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
    const foreign = await h.image(new Request(`http://local/api/seedream/image?session=second&id=${value.item.id}`))
    expect(foreign.status).toBe(404)
  })
  it('normalizes JPEG to a valid local PNG', async () => {
    const { h, store, fetch } = setup(), source = PNG.sync.read(realPng())
    const encoded = jpeg.encode({ data: source.data, width: source.width, height: source.height }, 90).data
    const response = await h.importImage(request({ image: `data:image/jpeg;base64,${Buffer.from(encoded).toString('base64')}` }))
    expect(response.status).toBe(200)
    const { value } = await response.json() as { value: { item: { id: string } } }
    const bytes = await store.readImage('first', value.item.id)
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const pixels = decodePixels(bytes)
    expect([pixels.width, pixels.height]).toEqual([16, 8])
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['file:///private/image.png', 'https://remote.test/image.png', 'data:image/svg+xml;base64,PHN2Zy8+', `data:image/png;base64,${Buffer.from(png(1000, 800)).toString('base64')}`, `data:image/png;base64,${Buffer.from(png(16001, 16001)).toString('base64')}`])('refuses paths, remote requests, unsupported or malformed images: %s', async image => {
    const { h, fetch, store } = setup()
    expect((await h.importImage(request({ image }))).status).toBe(400)
    expect(fetch).not.toHaveBeenCalled(); expect((await store.get('first')).items).toHaveLength(0)
  })
})
