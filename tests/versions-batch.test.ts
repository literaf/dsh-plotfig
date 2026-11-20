import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasStore } from '../src/store.js'
import { ArkClient } from '../src/ark.js'
import { Seedream } from '../src/service.js'
import { applyTools } from '../src/tools.js'
import { parseGenerate, entryOf } from '../src/shared/types.js'
import { png } from './fixtures.js'

type Tool = { name: string; execute(args: unknown, exec: unknown): Promise<unknown> }
let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'seedream-versions-')) })
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }) })
function setup(fail: (body: Record<string, unknown>) => boolean = () => false) {
  const bodies: Array<Record<string, unknown>> = []
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'doubao-seedream-5-5-261028' }] }))
    if (init?.body) {
      const body = JSON.parse(init.body as string) as Record<string, unknown>; bodies.push(body)
      if (fail(body)) return new Response(JSON.stringify({ error: { code: 'InternalError', message: 'boom' } }), { status: 500 })
      return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/r.png' }] }))
    }
    return new Response(png(1024, 1024))
  }) as unknown as typeof globalThis.fetch
  const ark = new ArkClient({ apiKey: async () => 'k', timeoutMs: 5000, userAgent: 't', fetch })
  const store = new CanvasStore(join(root, 'canvases')), service = new Seedream(ark, store)
  const tools = new Map<string, Tool>()
  applyTools({ tools: { register: (t: Tool) => { tools.set(t.name, t) } }, inject: vi.fn() } as never, service, async () => ({ size: '2K', watermark: true }))
  return { bodies, ark, store, service, tools, exec: { agent: { id: 'sess_one' }, signal: new AbortController().signal } }
}
const defaults = { size: '2K', watermark: false }

describe('regenerate and versions', () => {
  it('puts a regenerated result in the old place, hides the old version and switches back without a model call', async () => {
    const { service, store, bodies } = setup()
    const first = (await service.generate('s', parseGenerate({ prompt: '雨林剖面', title: '雨林' }, defaults), new AbortController().signal)).items[0]!
    await store.move('s', [{ id: first.id, x: 500, y: 300 }])
    const second = (await service.generate('s', parseGenerate({ prompt: '雨林剖面', title: '雨林', replaces: first.id }, defaults), new AbortController().signal)).items[0]!
    let canvas = await store.get('s')
    expect(second).toMatchObject({ x: 500, y: 300, versionOf: first.id, sourcePrompt: '雨林剖面' })
    expect(canvas.items.find(i => i.id === first.id)!.superseded).toBe(true)
    expect(entryOf(canvas).count).toBe(1)
    const third = (await service.generate('s', parseGenerate({ prompt: '雨林剖面', replaces: second.id }, defaults), new AbortController().signal)).items[0]!
    expect(third.versionOf).toBe(first.id)
    const calls = bodies.length
    canvas = await store.showVersion('s', first.id)
    expect(canvas.items.filter(i => !i.superseded).map(i => i.id)).toEqual([first.id])
    expect(canvas.items.find(i => i.id === first.id)).toMatchObject({ x: 500, y: 300 })
    expect(bodies).toHaveLength(calls)
    // Deleting the shown version reveals the newest remaining one in its place.
    canvas = await store.remove('s', first.id)
    expect(canvas.items.filter(i => !i.superseded).map(i => i.id)).toEqual([third.id])
  })
  it('falls back to normal placement when the replaced image no longer exists', async () => {
    const { service } = setup()
    const a = (await service.generate('s', parseGenerate({ prompt: 'a' }, defaults), new AbortController().signal)).items[0]!
    const b = (await service.generate('s', parseGenerate({ prompt: 'b', replaces: 'ffffffffffff' }, defaults), new AbortController().signal)).items[0]!
    expect(b.versionOf).toBeUndefined(); expect(b.x).toBeGreaterThan(a.x)
    expect(() => parseGenerate({ prompt: 'x', replaces: '../a' }, defaults)).toThrow('replaces')
  })
  it('hides superseded versions from the conversation tools', async () => {
    const { tools, exec } = setup()
    const first = await tools.get('seedream_generate')!.execute({ prompt: 'a' }, exec) as { created: Array<{ id: string }> }
    await tools.get('seedream_generate')!.execute({ prompt: 'a', replaces: first.created[0]!.id }, exec)
    const listed = await tools.get('seedream_canvas')!.execute({}, exec) as { items: unknown[] }
    expect(listed.items).toHaveLength(1)
  })
})

describe('batch generation tool', () => {
  it('generates each item once in order, sharing size and references, and reports failures without retrying', async () => {
    const { tools, bodies, exec } = setup(body => String(body.prompt).startsWith('第二张'))
    const seed = await tools.get('seedream_generate')!.execute({ prompt: '参考图' }, exec) as { created: Array<{ ref: string }> }
    bodies.length = 0
    const result = await tools.get('seedream_generate_batch')!.execute({ size: '1K', images: [seed.created[0]!.ref], items: [{ prompt: '第一张 细胞', title: '细胞' }, { prompt: '第二张 失败' }, { prompt: '第三张 器件', size: '2K' }] }, exec) as { created: unknown[]; warnings: string[] }
    expect(bodies.map(b => String(b.prompt).slice(0, 3))).toEqual(['第一张', '第二张', '第三张'])
    expect(bodies.map(b => b.size)).toEqual(['1K', '1K', '2K'])
    expect(bodies.every(b => String(b.image).startsWith('data:image/png;base64,'))).toBe(true)
    expect(result.created).toHaveLength(2)
    expect(result.warnings[0]).toBe('批量生成：成功 2 / 共 3。')
    expect(result.warnings.join()).toContain('第 2 项失败，未自动重试')
  })
  it('rejects a bad item before billing anything', async () => {
    const { tools, bodies, exec } = setup()
    await expect(tools.get('seedream_generate_batch')!.execute({ items: [{ prompt: 'a' }, { prompt: '' }] }, exec)).rejects.toThrow('第 2 项')
    await expect(tools.get('seedream_generate_batch')!.execute({ items: [{ prompt: 'a' }] }, exec)).rejects.toThrow('2–10')
    expect(bodies).toHaveLength(0)
  })
})

describe('connection check', () => {
  it('lists models without generating, and explains a missing model or a bad key', async () => {
    const { ark, bodies } = setup()
    expect(await ark.check(new AbortController().signal)).toMatchObject({ ok: true, modelAvailable: true })
    expect(bodies).toHaveLength(0)
    const none = new ArkClient({ apiKey: async () => 'k', timeoutMs: 5000, userAgent: 't', fetch: vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'other' }] }))) as unknown as typeof fetch })
    expect(await none.check(new AbortController().signal)).toMatchObject({ ok: true, modelAvailable: false })
    const bad = new ArkClient({ apiKey: async () => 'k', timeoutMs: 5000, userAgent: 't', fetch: vi.fn(async () => new Response(JSON.stringify({ error: { code: 'AuthenticationError', message: 'invalid' } }), { status: 401 })) as unknown as typeof fetch })
    const result = await bad.check(new AbortController().signal)
    expect(result.ok).toBe(false); expect(result.message).toContain('API Key')
  })
})
