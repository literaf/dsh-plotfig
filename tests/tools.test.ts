import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasStore } from '../src/store.js'
import { AI4ScholarClient } from '../src/ai4scholar.js'
import { Seedream } from '../src/service.js'
import { applyTools } from '../src/tools.js'
import { drawingFetch } from './fixtures.js'

type Tool = { name: string; execute(args: unknown, exec: unknown): Promise<unknown>; isConcurrencySafe?(): boolean; output: { render(a: unknown, v: unknown): Array<{ text: string }> } }
let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'seedream-tools-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
function setup() {
  const tools = new Map<string, Tool>()
  const ctx = { tools: { register: (t: Tool) => { tools.set(t.name, t) } }, inject: vi.fn() }
  const bodies: Array<Record<string, unknown>> = []
  const fetch = vi.fn(drawingFetch(body => { bodies.push(body) }))
  const service = new Seedream(new AI4ScholarClient({ apiKey: async () => 'sk-user-fixture', timeoutMs: 5000, userAgent: 't', fetch }), new CanvasStore(join(root, 'canvases')))
  applyTools(ctx as never, service, async () => ({ size: '2K', watermark: true }))
  const exec = (id: string) => ({ agent: { id }, signal: new AbortController().signal })
  return { tools, bodies, fetch, exec }
}
describe('conversation tools', () => {
  it('generates onto the calling Session canvas and lists it without another request', async () => {
    const { tools, fetch, exec } = setup()
    const generate = tools.get('seedream_generate')!, canvas = tools.get('seedream_canvas')!
    expect(generate.isConcurrencySafe?.()).toBe(false)
    const first = await generate.execute({ prompt: '雨林剖面图', title: '雨林垂直分层剖面图' }, exec('sess_one')) as { created: Array<{ ref: string; path: string }> }
    expect(first.created[0]!.ref).toMatch(/^item:[a-f0-9]{12}$/); expect(first.created[0]!.path).toContain(join('sess_one', 'images'))
    const calls = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    const listed = await canvas.execute({}, exec('sess_one')) as { items: unknown[] }
    expect(listed.items).toHaveLength(1); expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls)
    expect(canvas.output.render({}, listed)[0]!.text).toContain('雨林垂直分层剖面图')
    expect((await canvas.execute({}, exec('sess_two')) as { items: unknown[] }).items).toHaveLength(0)
  })
  it('edits by item reference and refuses calls outside a conversation', async () => {
    const { tools, bodies, exec } = setup()
    const generate = tools.get('seedream_generate')!
    const first = await generate.execute({ prompt: 'a' }, exec('sess_one')) as { created: Array<{ ref: string }> }
    const edit = await generate.execute({ prompt: '只把天空改成黄昏，其余保持不变', images: [first.created[0]!.ref] }, exec('sess_one')) as { created: Array<{ refs: string[] }>; items: unknown[] }
    expect(bodies[1]!.images).toEqual([expect.stringMatching(/^data:image\/png;base64,/)])
    expect(edit.created[0]!.refs).toEqual([first.created[0]!.ref]); expect(edit.items).toHaveLength(2)
    await expect(generate.execute({ prompt: 'a' }, { signal: new AbortController().signal })).rejects.toThrow('对话')
    await expect(generate.execute({ prompt: 'a' }, exec('../escape'))).rejects.toThrow()
  })
})
