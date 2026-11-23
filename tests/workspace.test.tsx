// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Settings, Workspace } from '../src/client/Workspace.js'
import { Controller } from '../src/client/controller.js'
import type { Fetcher } from '../src/client/controller.js'

vi.mock('../src/client/Canvas.js', () => ({ CanvasView: () => <div data-saved-canvas>本地画布编辑器</div> }))
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(() => vi.unstubAllGlobals())
it('saves the key from the form and offers connection testing and removal for the configured key', async () => {
  let configured = false
  const port = {
    describe: async () => ({ configured, writable: true }),
    set: vi.fn(async () => { configured = true }),
    unset: vi.fn(async () => { configured = false }),
  }
  const fetcher = vi.fn(async (path: string) => ({ ok: true, value: path.endsWith('/check')
    ? { ok: true, modelAvailable: true, message: '连接成功' }
    : { version: '0.4.0', configured, defaultSize: '2K', watermark: true, canvases: [] } })) as unknown as Fetcher
  const controller = new Controller(() => port, fetcher)
  const node = document.createElement('div'), root = createRoot(node)
  try {
    await act(async () => root.render(<Settings controller={controller}/>))
    const field = node.querySelector<HTMLInputElement>('input[type="password"]')!
    const form = field.form!
    const save = form.querySelector('button')!
    expect(save.disabled).toBe(true)
    await act(async () => Simulate.change(field, { target: { value: 'sk-user-fixture' } } as never))
    expect(save.disabled).toBe(false)
    await act(async () => Simulate.submit(form))
    expect(port.set).toHaveBeenCalledExactlyOnceWith('AI4SCHOLAR_API_KEY', 'sk-user-fixture')
    expect(field.value).toBe('')
    expect(node.querySelector('.sd-key-status')?.textContent).toBe('已配置')
    const buttons = [...node.querySelectorAll<HTMLButtonElement>('.sd-settings-actions button')]
    await act(async () => buttons.find(b => b.textContent === '测试连接')!.click())
    expect(node.querySelector('[role="status"]')?.textContent).toBe('连接成功')
    await act(async () => buttons.find(b => b.textContent === '移除密钥')!.click())
    expect(port.unset).toHaveBeenCalledExactlyOnceWith('AI4SCHOLAR_API_KEY')
    expect(node.querySelector('.sd-key-status')?.textContent).toBe('未配置')
    expect(node.querySelector('.sd-settings-actions')).toBeNull()
  } finally { await act(async () => root.unmount()); controller.dispose() }
})

describe('saved canvas access without model credentials', () => {
  it('keeps saved canvases accessible after removing the key, including settings roundtrips', async () => {
    const catalog = { version: '0.1.0', configured: false, keyRef: 'AI4SCHOLAR_API_KEY', model: 'seedream', defaultSize: '2K', watermark: false, canvases: [{ sessionId: 'board-local', title: '已有分层画布', count: 2, updatedAt: new Date().toISOString() }] }
    const fetcher = vi.fn(async () => ({ ok: true, value: catalog })) as unknown as Fetcher
    const controller = new Controller(() => { throw new Error('Local editing must not request credentials') }, fetcher)
    const node = document.createElement('div'), root = createRoot(node)
    const openConversation = vi.fn(() => true), conversation = vi.fn()
    const render = () => root.render(<Workspace controller={controller} openConversation={openConversation} conversation={conversation}/>)
    try {
      await act(async () => { await controller.attach(); render() })
      expect(node.querySelector('.sd-settings')).toBeNull()
      expect(node.textContent).toContain('已保存的画布可继续编辑和导出')
      expect(node.querySelector('.sd-title')?.textContent).toBe('PlotFig')
      expect(node.querySelector('.sd-all-canvases .sd-canvas-count')?.textContent).toBe('1')
      await act(async () => { node.querySelector<HTMLButtonElement>('.sd-card')!.click() })
      expect(node.querySelector('[data-saved-canvas]')).not.toBeNull()
      expect(node.querySelector('.sd-brand')?.textContent).toBe('独立画布 · 2 张')
      expect(openConversation).not.toHaveBeenCalled()
      await act(async () => { await controller.attach() })
      expect(node.querySelector('[data-saved-canvas]')).not.toBeNull()
      await act(async () => { node.querySelector<HTMLButtonElement>('[aria-label="设置"]')!.click() })
      expect(node.querySelector('.sd-settings')).not.toBeNull()
      expect(node.querySelector('.sd-title')?.textContent).toBe('PlotFig 设置')
      const homeLink = node.querySelector<HTMLAnchorElement>('.sd-settings-heading a.sd-button-primary')!
      expect(homeLink.textContent).toContain('获取密钥')
      expect(homeLink.href).toBe('https://ai4scholar.net/?src=dsh_plotfig')
      expect(homeLink.target).toBe('_blank')
      expect(homeLink.relList.contains('noopener')).toBe(true)
      expect(homeLink.relList.contains('noreferrer')).toBe(true)
      expect(node.querySelector('.sd-key-status')?.textContent).toBe('未配置')
      expect(node.querySelector('.sd-settings-actions')).toBeNull()
      const billing = node.querySelector('details')!
      expect(billing.open).toBe(false)
      billing.querySelector('summary')!.click()
      expect(billing.open).toBe(true)
      expect(billing.textContent).toContain('按实际交付的图片结算')
      await act(async () => { node.querySelector<HTMLButtonElement>('[aria-label="返回首页"]')!.click() })
      expect(node.querySelector('.sd-card')).not.toBeNull()
      expect(vi.mocked(fetcher).mock.calls.every(([url]) => !String(url).includes('/generate') && !String(url).includes('/decompose'))).toBe(true)
    } finally { await act(async () => root.unmount()); controller.dispose() }
  })
  it('offers the six visible templates without credentials and creates the visible default', async () => {
    const fetcher = vi.fn(async (path: string) => {
      if (path.startsWith('/api/seedream/composition?')) return { ok: true, value: { canvas: { revision: 1, items: [] }, composition: { id: 'local-template' } } }
      return { ok: true, value: { version: '0.1.0', configured: false, canvases: [], defaultSize: '2K', watermark: false } }
    }) as unknown as Fetcher
    const controller = new Controller(() => { throw new Error('No credential read expected') }, fetcher)
    const node = document.createElement('div'), root = createRoot(node)
    try {
      await act(async () => { await controller.attach(); root.render(<Workspace controller={controller} openConversation={() => false} conversation={vi.fn()}/>) })
      expect(node.querySelector('.sd-gallery')).toBeNull()
      await act(async () => node.querySelector<HTMLButtonElement>('[aria-label="选择图形模板"]')!.click())
      const tabs = Array.from(node.querySelectorAll<HTMLButtonElement>('.sd-template-tabs button'))
      const cards = () => Array.from(node.querySelectorAll('.sd-template-card strong'), el => el.textContent)
      const create = node.querySelector<HTMLButtonElement>('.sd-template-footer .sd-button-primary')!
      expect(tabs.map(tab => tab.textContent)).toEqual(['全部', '模型架构', '循环图', '时间线'])
      expect(cards()).toEqual(['编码器与解码器', '多路特征融合', '研究迭代', '反馈闭环', '研究计划', '里程碑'])
      expect(create.textContent).toBe('使用「编码器与解码器」')
      await act(async () => tabs.find(tab => tab.textContent === '循环图')!.click())
      expect(cards()).toEqual(['研究迭代', '反馈闭环'])
      expect(create.textContent).toBe('使用「研究迭代」')
      await act(async () => node.querySelector<HTMLButtonElement>('[aria-label="关闭图形模板"]')!.click())
      await act(async () => node.querySelector<HTMLButtonElement>('[aria-label="选择图形模板"]')!.click())
      await act(async () => node.querySelector<HTMLButtonElement>('.sd-template-footer .sd-button-primary')!.click())
      expect(vi.mocked(fetcher).mock.calls.filter(([url]) => url.includes('/composition?')).map(call => call[2]))
        .toEqual([{ templateId: 'encoder-decoder', palette: 'ocean' }])
      expect(node.querySelector('[data-saved-canvas]')).not.toBeNull()
    } finally { await act(async () => root.unmount()); controller.dispose() }
  })
})

describe('home generation entry', () => {
  function setup(failStyle = false) {
    const saved = new Map<string, object>()
    const catalog = { version: '0.1.0', configured: true, keyRef: 'AI4SCHOLAR_API_KEY', model: 'seedream', defaultSize: '2K', watermark: false, canvases: [] }
    const fetcher = vi.fn(async (path: string, _signal: AbortSignal, data?: unknown, method?: string) => {
      if (path === '/api/seedream') return { ok: true, value: catalog }
      const sessionId = new URL(path, 'http://local').searchParams.get('session')!
      const canvas = { sessionId, revision: 1, items: [], createdAt: 'now', updatedAt: 'now', ...saved.get(sessionId) }
      if (method === 'PATCH') {
        if (failStyle) return { ok: false, error: '风格未保存' }
        const updated = { ...canvas, ...(data as object) }
        saved.set(sessionId, updated)
        return { ok: true, value: updated }
      }
      if (path.includes('/generate?')) return { ok: false, error: '模拟请求失败' }
      return { ok: true, value: canvas }
    }) as unknown as Fetcher
    const controller = new Controller(() => { throw new Error('No key access expected') }, fetcher)
    const node = document.createElement('div'); document.body.appendChild(node)
    const root = createRoot(node)
    const render = async () => act(async () => { await controller.attach(); root.render(<Workspace controller={controller} openConversation={() => false} conversation={vi.fn()}/>) })
    const type = async (text: string) => act(async () => { const input = node.querySelector('textarea')!; Simulate.change(input, { target: { value: text } } as never) })
    const pick = async () => {
      await act(async () => node.querySelector<HTMLButtonElement>('[aria-label="选择生图风格"]')!.click())
      const card = Array.from(node.querySelectorAll<HTMLButtonElement>('.sd-style-card')).find(e => e.textContent?.includes('清晰线稿'))!
      await act(async () => card.click())
    }
    const cleanup = async () => { await act(async () => root.unmount()); controller.dispose(); node.remove() }
    return { fetcher, node, render, type, pick, cleanup }
  }
  it('takes the scientific illustration shortcut to the existing draft and explains how to generate', async () => {
    const h = setup()
    try {
      await h.render()
      await h.type('保留这份实验流程图描述')
      const shortcut = h.node.querySelector<HTMLButtonElement>('[aria-label="科研插图"]')!
      shortcut.focus()
      await act(async () => shortcut.click())
      const input = h.node.querySelector('textarea')!
      expect(document.activeElement).toBe(input)
      expect(input.value).toBe('保留这份实验流程图描述')
      expect(h.node.querySelector('[role=status]')?.textContent).toContain('生成')
      expect(vi.mocked(h.fetcher).mock.calls.every(([url]) => url === '/api/seedream')).toBe(true)
    } finally { await h.cleanup() }
  })
  it('keeps style selection local and submits a new canvas only once with the selected settings', async () => {
    const h = setup()
    try {
      await h.render()
      expect(h.node.querySelector('.sd-home-input .sd-composer')).not.toBeNull()
      expect(h.node.querySelector('.sd-style-grid')).toBeNull()
      expect(h.node.querySelectorAll('.sd-home-shortcuts button')).toHaveLength(6)
      await h.type('绘制 A → B 的信号通路')
      await h.pick()
      expect(h.node.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('绘制 A → B 的信号通路')
      expect(h.node.querySelector('.sd-style-grid')).toBeNull()
      expect(vi.mocked(h.fetcher).mock.calls.every(([url]) => url === '/api/seedream')).toBe(true)
      await act(async () => {
        const form = h.node.querySelector('form')!
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
      const calls = vi.mocked(h.fetcher).mock.calls
      const generated = calls.filter(([url]) => url.includes('/generate?'))
      expect(generated).toHaveLength(1)
      expect(generated[0]![2]).toMatchObject({ prompt: '绘制 A → B 的信号通路', style: 'line-art' })
      const saved = calls.find(([, , , method]) => method === 'PATCH')!
      expect(saved[2]).toEqual({ generationStyle: 'line-art', generationModel: 'seedream55' })
      expect(saved[0].split('?')[1]).toBe(generated[0]![0].split('?')[1])
      expect(h.node.querySelector('[data-saved-canvas]')).not.toBeNull()
      // Failure does not retry, and returning home recovers the original draft.
      await act(async () => h.node.querySelector<HTMLButtonElement>('[aria-label="返回首页"]')!.click())
      expect(h.node.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('绘制 A → B 的信号通路')
      expect(vi.mocked(h.fetcher).mock.calls.filter(([url]) => url.includes('/generate?'))).toHaveLength(1)
    } finally { await h.cleanup() }
  })
  it('keeps model selection in the draft and sends the chosen resolution and ratio once', async () => {
    const h = setup()
    try {
      await h.render()
      const selector = () => h.node.querySelector<HTMLSelectElement>('select[aria-label="绘图模型"]')!
      expect(h.node.querySelector('.sd-title .sd-brand')).toBeNull()
      expect(h.node.querySelector('.sd-composer-footer')?.textContent).toBe('Enter 生成 · Shift + Enter 换行')
      expect(selector().value).toBe('seedream55')
      expect(selector().options).toHaveLength(9)
      await h.type('同一份描述')
      await act(async () => h.node.querySelector<HTMLButtonElement>('.sd-transparent-chip')!.click())
      const select = async (value: string) => act(async () => { selector().value = value; selector().dispatchEvent(new Event('change', { bubbles: true })) })
      const openSize = async () => act(async () => h.node.querySelector<HTMLButtonElement>('[title="尺寸与比例"]')!.click())
      const choice = (name: string) => Array.from(h.node.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')).find(b => b.textContent === name)
      await select('bananalite')
      expect(h.node.querySelector('.sd-transparent-chip')).toBeNull()
      await openSize()
      expect(choice('1K')).toBeDefined(); expect(choice('2K')).toBeUndefined()
      await act(async () => choice('1K')!.click())
      await select('gpt26flare')
      await openSize(); await act(async () => choice('4K')!.click())
      await openSize(); await act(async () => choice('16:9')!.click())
      expect(h.node.querySelector('textarea')!.value).toBe('同一份描述')
      expect(vi.mocked(h.fetcher).mock.calls.every(([url]) => url === '/api/seedream')).toBe(true)
      await act(async () => h.node.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
      const calls = vi.mocked(h.fetcher).mock.calls
      expect(calls.find(([, , , method]) => method === 'PATCH')?.[2]).toEqual({ generationModel: 'gpt26flare', generationStyle: 'auto' })
      expect(calls.filter(([url]) => url.includes('/generate?')).map(call => call[2])).toEqual([{ prompt: '同一份描述', style: 'auto', model: 'gpt26flare', size: '4K', aspectRatio: '16:9' }])
      expect(h.node.querySelector('[data-saved-canvas]')).not.toBeNull()
      await act(async () => h.node.querySelector<HTMLButtonElement>('[aria-label="返回首页"]')!.click())
      expect(selector().value).toBe('gpt26flare')
    } finally { await h.cleanup() }
  })
  it('preserves the home draft and avoids generation if its style cannot be saved', async () => {
    const h = setup(true)
    try {
      await h.render(); await h.type('保留这段描述'); await h.pick()
      await act(async () => h.node.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
      expect(h.node.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('保留这段描述')
      expect(h.node.textContent).toContain('风格未保存')
      expect(h.node.querySelector('[data-saved-canvas]')).toBeNull()
      expect(vi.mocked(h.fetcher).mock.calls.some(([url]) => url.includes('/generate?'))).toBe(false)
    } finally { await h.cleanup() }
  })
})

describe('gallery canvas deletion', () => {
  function setup(rejectOne = false) {
    const entries = ['chat', 'board-a', 'board-b', 'busy', 'layers'].map(sessionId => ({
      sessionId, title: sessionId, revision: 3, updatedAt: new Date().toISOString(), count: 1, hasPendingLayers: sessionId === 'layers',
    }))
    const deleted: string[] = []
    const fetcher = vi.fn(async (path: string, _signal: AbortSignal, _body?: unknown, method?: string) => {
      if (method === 'DELETE') {
        const params = new URL(path, 'http://local').searchParams
        const id = params.get('session')!
        expect(params.get('revision')).toBe('3')
        deleted.push(id)
        if (rejectOne && id === 'board-b') return { ok: false, error: '画布内容已更新' }
        entries.splice(entries.findIndex(entry => entry.sessionId === id), 1)
        return { ok: true, value: { sessionId: id, revision: 4, items: [] } }
      }
      return { ok: true, value: { configured: false, defaultSize: '2K', canvases: [...entries], active: { busy: [{ key: 'running' }] } } }
    }) as unknown as Fetcher
    const controller = new Controller(() => { throw new Error('No credential needed') }, fetcher)
    const node = document.createElement('div'), root = createRoot(node), open = vi.fn(() => true)
    const render = () => act(async () => { root.render(<Workspace controller={controller} openConversation={open} conversation={vi.fn()}/>) })
    const button = (text: string) => [...node.querySelectorAll('button')].find(b => b.textContent === text)!
    const click = (el: HTMLElement) => act(async () => { el.click() })
    const close = async () => { await act(async () => root.unmount()); controller.dispose() }
    return { node, open, render, button, click, close, deleted }
  }
  it('confirms by name in Recent, supports cancellation and removes a chat canvas without opening its conversation', async () => {
    const h = setup()
    const remove = () => h.node.querySelector<HTMLButtonElement>('[aria-label="删除画布「chat」"]')!
    try {
      await h.render()
      await h.click(remove())
      expect(h.node.querySelector('[role="dialog"]')?.textContent).toContain('确定删除「chat」')
      expect(h.node.querySelector('[role="dialog"]')?.textContent).toContain('原对话记录会保留')
      await h.click(h.button('取消'))
      expect(h.deleted).toEqual([])
      await h.click(remove())
      await h.click(h.button('确认删除'))
      expect(h.deleted).toEqual(['chat'])
      expect(remove()).toBeNull()
      expect(h.node.querySelector('.sd-canvas-count')?.textContent).toBe('4')
      expect(h.open).not.toHaveBeenCalled()
    } finally { await h.close() }
  })
  it('selects only eligible canvases, clears selection, and reports partial success with the failed canvas still selected', async () => {
    const h = setup(true)
    try {
      await h.render()
      await h.click(h.node.querySelector<HTMLButtonElement>('.sd-all-canvases')!)
      await h.click(h.button('管理画布'))
      const checks = () => [...h.node.querySelectorAll<HTMLInputElement>('.sd-card-check')]
      const all = h.node.querySelector<HTMLInputElement>('.sd-select-all input')!
      expect(h.button('删除所选').disabled).toBe(true)
      expect(checks().filter(c => c.disabled)).toHaveLength(2)
      await h.click(checks()[0]!)
      expect(all.indeterminate).toBe(true)
      await h.click(all)
      expect(checks().filter(c => c.checked)).toHaveLength(3)
      await h.click(all)
      expect(h.button('删除所选').disabled).toBe(true)
      await h.click(checks()[1]!)
      await h.click(checks()[2]!)
      await h.click(h.button('删除所选'))
      expect(h.node.querySelector('[role="dialog"]')?.textContent).toContain('确定删除选中的 2 个画布')
      await h.click(h.button('取消'))
      expect(h.deleted).toEqual([])
      await h.click(h.button('删除所选'))
      await h.click(h.button('确认删除'))
      expect(h.deleted).toEqual(['board-a', 'board-b'])
      expect(h.node.querySelector('[role="alert"]')?.textContent).toContain('「board-b」画布内容已更新')
      expect(checks().filter(c => c.checked)).toHaveLength(1)
      expect(h.node.querySelector('.sd-brand')?.textContent).toBe('4 个画布')
      expect(h.open).not.toHaveBeenCalled()
    } finally { await h.close() }
  })
})
