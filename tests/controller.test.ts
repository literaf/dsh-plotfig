// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Controller, POLL_MS } from '../src/client/controller.js'
import type { Fetcher } from '../src/client/controller.js'
import { referenceItem, referenceText } from '../src/client/handoff.js'
import type { Canvas } from '../src/shared/types.js'

const canvas = (revision: number, ids: string[] = []): Canvas => ({ sessionId: 's', revision, createdAt: '', updatedAt: '', items: ids.map((id, i) => ({ id, title: id, prompt: 'p', width: 10, height: 10, x: i * 90, y: 0, refs: [], externalRefs: 0, size: '2K', createdAt: '' })) })
const port = { describe: vi.fn(), set: vi.fn(async () => {}), unset: vi.fn(async () => {}) }
const catalog = { version: '0', configured: true, keyRef: 'ARK_API_KEY', model: 'm', defaultSize: '2K', watermark: true, canvases: [] }
afterEach(() => { vi.useRealTimers() })
describe('canvas model', () => {
  it('polls only while held and ignores older revisions', async () => {
    vi.useFakeTimers()
    let revision = 2
    const fetcher = vi.fn(async (path: string) => path.includes('/canvas') ? { ok: true, value: canvas(revision, revision > 2 ? ['a', 'b'] : ['a']) } : { ok: true, value: catalog }) as unknown as Fetcher
    const c = new Controller(() => port, fetcher), model = c.canvas('s')
    const release = model.hold(); await vi.advanceTimersByTimeAsync(0)
    expect(model.getSnapshot().canvas?.revision).toBe(2)
    revision = 3; await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(model.getSnapshot().canvas?.items).toHaveLength(2)
    revision = 1; await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(model.getSnapshot().canvas?.revision).toBe(3)
    release(); const count = (fetcher as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect((fetcher as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(count)
    c.dispose()
  })
  it('stops waiting on cancel and drops the late reply', async () => {
    let resolve!: (v: unknown) => void
    const fetcher = vi.fn(async (path: string) => path.includes('/generate') ? new Promise(r => { resolve = r }) : { ok: true, value: canvas(1) }) as unknown as Fetcher
    const model = new Controller(() => port, fetcher).canvas('s')
    await model.refresh()
    const pending = model.generate({ prompt: '猫' })
    expect(model.getSnapshot().pending).toHaveLength(1)
    model.cancel(); resolve({ ok: true, value: { canvas: canvas(5, ['late']), created: ['late'] } }); await pending
    expect(model.getSnapshot().pending).toHaveLength(0); expect(model.getSnapshot().canvas?.revision).toBe(1); expect(model.getSnapshot().message).toContain('计费')
  })
  it('shows generations started by the conversation and does not duplicate its own', async () => {
    let pending = [{ key: 'h1', prompt: '对话里的图', startedAt: '' }]
    let finish!: (v: unknown) => void
    const fetcher = vi.fn(async (path: string) => path.includes('/generate') ? new Promise(r => { finish = r }) : { ok: true, value: { ...canvas(1), pending } }) as unknown as Fetcher
    const model = new Controller(() => port, fetcher).canvas('s')
    await model.refresh()
    expect(model.getSnapshot().pending.map(p => p.prompt)).toEqual(['对话里的图'])
    const mine = model.generate({ prompt: '画布里的图' })
    pending = [...pending, { key: 'h2', prompt: '画布里的图', startedAt: '' }]; await model.refresh()
    expect(model.getSnapshot().pending.map(p => p.prompt)).toEqual(['画布里的图', '对话里的图'])
    pending = []; finish({ ok: true, value: { canvas: canvas(2, ['a']), created: ['a'] } }); await mine; await model.refresh()
    expect(model.getSnapshot().pending).toEqual([]); expect(model.getSnapshot().canvas?.items).toHaveLength(1)
  })
  it('applies layout optimistically and keeps it over a stale poll', async () => {
    let finish!: (v: unknown) => void
    const fetcher = vi.fn(async (_path: string, _signal: AbortSignal, _body?: unknown, method?: string) => method === 'PATCH' ? new Promise(r => { finish = r }) : { ok: true, value: canvas(1, ['a']) }) as unknown as Fetcher
    const model = new Controller(() => port, fetcher).canvas('s')
    await model.refresh()
    const moving = model.move([{ id: 'a', x: 500, y: 40 }])
    expect(model.getSnapshot().canvas?.items[0]).toMatchObject({ x: 500, y: 40 })
    await model.refresh(); expect(model.getSnapshot().canvas?.items[0]).toMatchObject({ x: 500 })
    const saved = canvas(2, ['a']); saved.items[0]!.x = 500; saved.items[0]!.y = 40
    finish({ ok: true, value: saved }); await moving
    expect(model.getSnapshot().canvas?.revision).toBe(2)
  })
  it('writes only the Ark key reference', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, value: catalog })) as unknown as Fetcher
    const c = new Controller(() => port, fetcher); await c.attach(); await c.saveKey(' k '); await c.removeKey()
    expect(port.set).toHaveBeenCalledWith('ARK_API_KEY', 'k'); expect(port.unset).toHaveBeenCalledWith('ARK_API_KEY'); c.dispose()
  })
})
describe('reference handoff', () => {
  const item = { id: 'abcdefabcdef', title: '雨林' }
  function fixture(draft: string, phase = 'plain') {
    const state = { draft, phase }, input = { state: { getSnapshot: () => state }, setDraft: vi.fn((t: string) => { state.draft = t }), focus: vi.fn() }
    const services: Record<string, unknown> = { sessions: { binding: (id: string) => id === 's' ? { ctx: {} } : undefined }, conversation: { input: { for: () => input } } }
    return { ctx: { get: (k: string) => services[k] } as never, state, input }
  }
  it('appends to the Session draft without sending', async () => {
    const f = fixture('把这张')
    expect(await referenceItem(f.ctx, 's', item)).toBe('filled'); expect(f.state.draft).toBe(`把这张 ${referenceText(item)}`)
    expect(await referenceItem(f.ctx, 's', item)).toBe('filled'); expect(f.input.setDraft).toHaveBeenCalledTimes(1)
  })
  it('leaves a submitting draft alone and falls back to the clipboard', async () => {
    const f = fixture('x', 'submitting')
    expect(await referenceItem(f.ctx, 's', item)).toBe('busy'); expect(f.input.setDraft).not.toHaveBeenCalled()
    const writeText = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    expect(await referenceItem(f.ctx, 'other', item)).toBe('copied'); expect(writeText).toHaveBeenCalledWith(referenceText(item))
  })
})
