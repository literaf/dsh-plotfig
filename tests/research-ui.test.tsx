// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasView } from '../src/client/Canvas.js'
import { Controller } from '../src/client/controller.js'
import type { Fetcher } from '../src/client/controller.js'
import type { Canvas, CanvasItem, Composition } from '../src/shared/types.js'
import { readImportFile } from '../src/client/ResearchTools.js'
import { LayerEditor } from '../src/client/LayerEditor.js'
import { composerReferences } from '../src/client/references.js'

vi.mock('react-konva', () => ({ Stage: () => null, Layer: () => null, Group: () => null, Image: () => null, Rect: () => null, Transformer: () => null }))
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => vi.unstubAllGlobals())
const source: CanvasItem = { id: 'aaaaaaaaaaaa', title: '参考图', prompt: '本地导入图片', width: 1024, height: 1024, x: 0, y: 0, refs: [], externalRefs: 0, size: '2K', createdAt: new Date().toISOString(), imported: true }
const events = () => ({ reference: vi.fn(), edit: vi.fn(), prompt: vi.fn(async (_text: string) => 'filled' as const), focus: vi.fn(async () => 'filled' as const) })
function harness(sessionId = 'board-ui', items: CanvasItem[] = [source]) {
  let canvas: Canvas = { sessionId, revision: 0, createdAt: 'now', updatedAt: 'now', items }
  const fetcher = vi.fn(async (path: string, _signal: AbortSignal, data?: unknown) => {
    const body = data as { generationStyle?: Canvas['generationStyle'] } | undefined
    if (path.includes('/layer-quote?')) return { ok: true, value: { enabled: true, maxImages: 30, supportedMaxImages: 100, creditCost: 182, pricing: { mode: 'per_output_v1', inputCredits: 2, standardCredits: 3, largeCredits: 6, standardMaxPixels: 2610000 } } }
    if (body?.generationStyle) canvas = { ...canvas, revision: canvas.revision + 1, generationStyle: body.generationStyle }
    if (path.includes('/import-image')) { canvas = { ...canvas, revision: canvas.revision + 1, items: [source] }; return { ok: true, value: { canvas, item: source } } }
    return { ok: true, value: canvas }
  }) as unknown as Fetcher
  const controller = new Controller(() => { throw new Error('No credentials expected') }, fetcher), model = controller.canvas(sessionId)
  const node = document.createElement('div'); document.body.appendChild(node)
  const root = createRoot(node), actions = events()
  const button = (name: string) => Array.from(node.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.trim() === name || b.getAttribute('aria-label') === name)!
  const cleanup = async () => { await act(async () => root.unmount()); controller.dispose(); node.remove() }
  const billable = () => vi.mocked(fetcher).mock.calls.filter(([path]) => /\/(generate|decompose|edit-image)\?/.test(path))
  return { controller, model, fetcher, node, root, actions, button, cleanup, billable }
}

describe('scientific workflow entry points', () => {
  it.each(['board-ui', 'session-ui'])('saves a style choice without generating or adding a second native composer: %s', async sessionId => {
    const h = harness(sessionId, [])
    try {
      await act(async () => { await h.model.refresh(); h.root.render(<CanvasView model={h.model} conversation={h.actions}/>) })
      await act(async () => h.button('选择生图风格').click())
      expect(h.node.querySelectorAll('.sd-style-card')).toHaveLength(6)
      const card = Array.from(h.node.querySelectorAll<HTMLButtonElement>('.sd-style-card')).find(e => e.textContent?.includes('清晰线稿'))!
      await act(async () => card.click())
      expect(h.node.querySelector('[role=dialog]')).toBeNull()
      expect(h.model.getSnapshot().canvas?.generationStyle).toBe('line-art')
      expect(h.button('选择生图风格').textContent).toContain('清晰线稿')
      expect(h.node.querySelectorAll('.sd-composer textarea')).toHaveLength(sessionId.startsWith('session-') ? 0 : 1)
      expect(h.billable()).toHaveLength(0); expect(h.actions.prompt).not.toHaveBeenCalled()
    } finally { await h.cleanup() }
  })
  it('takes an existing image to a split confirmation without spending on a menu click', async () => {
    const h = harness()
    try {
      await act(async () => { await h.model.refresh(); h.root.render(<CanvasView model={h.model} initialTool="decompose"/>) })
      expect(h.node.textContent).toContain('选择当前画布的图片')
      await act(async () => h.node.querySelector<HTMLButtonElement>('.sd-source-list button')!.click())
      expect(h.node.querySelector('[aria-label="拆分图层"]')).not.toBeNull()
      expect(h.node.textContent).toContain('最高预留 182 积分，最多输出 30 张')
      expect(h.button('开始分层').disabled).toBe(false)
      expect(h.billable()).toHaveLength(0)
    } finally { await h.cleanup() }
  })
  it('makes OCR prerequisites explicit instead of promising free text recognition on flat images', async () => {
    const h = harness()
    try {
      await act(async () => { await h.model.refresh(); h.root.render(<CanvasView model={h.model} initialTool="text"/>) })
      expect(h.node.textContent).toContain('普通图片需要先分层识别')
      expect(h.node.textContent).toContain('确认本次分层所需的 AI4Scholar 积分')
      await act(async () => h.node.querySelector<HTMLButtonElement>('.sd-source-list button')!.click())
      expect(h.node.textContent).toContain('先拆分并识别图中文字')
      expect(h.billable()).toHaveLength(0)
    } finally { await h.cleanup() }
  })
  it('opens the existing background-removal settings before any model call', async () => {
    const h = harness()
    try {
      await act(async () => { await h.model.refresh(); h.root.render(<CanvasView model={h.model} initialTool="remove-background"/>) })
      await act(async () => h.node.querySelector<HTMLButtonElement>('.sd-source-list button')!.click())
      expect(h.node.querySelector('.sd-image-edit-dialog')).not.toBeNull()
      expect(h.node.querySelector('textarea')).not.toBeNull()
      expect(h.billable()).toHaveLength(0)
    } finally { await h.cleanup() }
  })
  it('appends a same-session sketch reference to the native draft, without submitting or billing', async () => {
    const h = harness('session-ui')
    try {
      await act(async () => { await h.model.refresh(); h.root.render(<CanvasView model={h.model} conversation={h.actions} initialTool="sketch"/>) })
      await act(async () => h.node.querySelector<HTMLButtonElement>('.sd-source-list button')!.click())
      expect(h.actions.prompt).toHaveBeenCalledOnce()
      expect(h.actions.prompt.mock.calls[0]![0]).toContain(`item:${source.id}`)
      expect(h.actions.prompt.mock.calls[0]![0]).toContain('保留草图中明确的对象关系')
      expect(h.node.querySelector('.sd-composer')).toBeNull(); expect(h.billable()).toHaveLength(0)
    } finally { await h.cleanup() }
  })
  it('orders composer references with the main image first, once each, at most ten', () => {
    const at = (n: number): CanvasItem => ({ ...source, id: `ref${String(n).padStart(9, '0')}`, title: `图片 ${n}` })
    expect(composerReferences(at(1), [at(2), at(1), at(3)]).map(r => r.title)).toEqual(['图片 1', '图片 2', '图片 3'])
    expect(composerReferences(undefined, [at(2)]).map(r => r.title)).toEqual(['图片 2'])
    expect(composerReferences(at(0), Array.from({ length: 12 }, (_, i) => at(i + 1)))).toHaveLength(10)
  })
  it('adds a selected canvas image as a reference and sends it with the prompt', async () => {
    const second: CanvasItem = { ...source, id: 'bbbbbbbbbbbb', title: '第二张', x: 1200 }
    const h = harness('board-ui', [source, second])
    try {
      await act(async () => { await h.model.refresh(); h.root.render(<CanvasView model={h.model} initialCompositionId={second.id}/>) })
      await act(async () => h.button('加入参考').click())
      expect(h.node.querySelector('.sd-context-refs')?.textContent).toContain('参考 · 第二张')
      expect(h.button('加入参考').disabled).toBe(true)
      expect(h.node.querySelector('[aria-label="移除参考图 第二张"]')).toBeTruthy()
      expect(h.billable()).toHaveLength(0)
      const area = h.node.querySelector<HTMLTextAreaElement>('.sd-composer textarea')!
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, '参考这张图画一台新器件'); area.dispatchEvent(new Event('input', { bubbles: true })) })
      await act(async () => h.node.querySelector<HTMLFormElement>('.sd-composer')!.requestSubmit())
      const calls = h.billable(); expect(calls).toHaveLength(1)
      expect((calls[0]![2] as { images: string[] }).images).toEqual([`item:${second.id}`])
    } finally { await h.cleanup() }
  })
  it('regenerates a generated image in place and switches versions without billing', async () => {
    const v1: CanvasItem = { ...source, id: 'cccccccccccc', title: '雨林', prompt: '雨林剖面\n\n视觉风格参考：…', sourcePrompt: '雨林剖面', imported: false, superseded: true }
    const v2: CanvasItem = { ...v1, id: 'dddddddddddd', versionOf: v1.id, superseded: false }
    const h = harness('board-ui', [v1, v2])
    try {
      await act(async () => { await h.model.refresh(); h.root.render(<CanvasView model={h.model} initialCompositionId={v2.id}/>) })
      expect(h.node.querySelector('.sd-versions')?.textContent).toContain('2 / 2')
      await act(async () => h.button('上一个版本').click())
      const patch = vi.mocked(h.fetcher).mock.calls.find(([, , data, method]) => method === 'PATCH' && (data as { showVersion?: string })?.showVersion)
      expect((patch![2] as { showVersion: string }).showVersion).toBe(v1.id)
      expect(h.billable()).toHaveLength(0)
      await act(async () => h.button('重新生成').click())
      const calls = h.billable(); expect(calls).toHaveLength(1)
      expect(calls[0]![2]).toMatchObject({ prompt: '雨林剖面', replaces: v2.id, title: '雨林' })
    } finally { await h.cleanup() }
  })
  it('offers no regenerate button for imported images', async () => {
    const h = harness('board-ui', [source])
    try {
      await act(async () => { await h.model.refresh(); h.root.render(<CanvasView model={h.model} initialCompositionId={source.id}/>) })
      expect(h.button('重新生成')).toBeUndefined()
    } finally { await h.cleanup() }
  })
  it('imports a local file before opening an operation, without a generation request', async () => {
    const h = harness('board-ui', [])
    try {
      await act(async () => { await h.model.refresh(); h.root.render(<CanvasView model={h.model} initialTool="decompose"/>) })
      const input = h.node.querySelector<HTMLInputElement>('input[type=file]')!
      const file = new File([new Uint8Array([137, 80, 78, 71])], 'local.png', { type: 'image/png' })
      Object.defineProperty(input, 'files', { value: [file] })
      await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 20)) })
      expect(vi.mocked(h.fetcher).mock.calls.filter(([url]) => url.includes('/import-image'))).toHaveLength(1)
      expect(h.node.querySelector('[aria-label="拆分图层"]')).not.toBeNull()
      expect(h.billable()).toHaveLength(0)
    } finally { await h.cleanup() }
  })
  it('leaves the selected style intact and keeps the picker open after a failed save', async () => {
    const h = harness()
    try {
      await act(async () => { await h.model.refresh(); h.root.render(<CanvasView model={h.model}/>) })
      await act(async () => h.button('选择生图风格').click())
      vi.mocked(h.fetcher).mockResolvedValueOnce({ ok: false, error: 'offline' })
      await act(async () => h.node.querySelector<HTMLButtonElement>('.sd-style-card')!.click())
      expect(h.model.getSnapshot().canvas?.generationStyle).toBeUndefined()
      expect(h.node.querySelector('[role=dialog]')).not.toBeNull()
      expect(h.model.getSnapshot().error).toBe('offline')
    } finally { await h.cleanup() }
  })
  it('rejects unsupported or oversized files before upload', async () => {
    await expect(readImportFile(new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }))).rejects.toThrow('PNG 或 JPEG')
    const file = new File(['x'], 'x.png', { type: 'image/png' }); Object.defineProperty(file, 'size', { value: 31 * 1024 * 1024 })
    await expect(readImportFile(file)).rejects.toThrow('30 MB')
  })
  it('keeps text properties visible when the text tool opens a narrow conversation editor', async () => {
    const h = harness('session-ui')
    const composition: Composition = { id: 'cccccccccccc', title: '文字画板', sourceId: source.id, width: 1024, height: 1024, x: 0, y: 0, background: '#ffffff', version: 1, layers: [
      { id: 'text-layer', kind: 'text', name: '结果标签', text: 'Signal', x: 10, y: 10, width: 100, height: 40, rotation: 0, opacity: 1, hidden: false, locked: false },
    ] }
    try {
      await act(async () => { await h.model.refresh(); h.root.render(<LayerEditor model={h.model} initial={composition} initialSelectedId="text-layer" onClose={() => {}} onOpenCopy={() => {}}/>) })
      expect(h.node.querySelector('[aria-label="图层与属性面板"]')).not.toBeNull()
      expect(h.node.querySelector<HTMLTextAreaElement>('[aria-label="文字内容"]')?.value).toBe('Signal')
      expect(h.model.editor(composition).getSnapshot().dirty).toBe(false)
      expect(h.billable()).toHaveLength(0)
    } finally { await h.cleanup() }
  })
})
