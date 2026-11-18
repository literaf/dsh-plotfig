// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Workspace } from '../src/client/Workspace.js'
import { Controller } from '../src/client/controller.js'
import type { Fetcher } from '../src/client/controller.js'

vi.mock('../src/client/Canvas.js', () => ({ CanvasView: () => <div data-saved-canvas>本地画布编辑器</div> }))
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(() => vi.unstubAllGlobals())
describe('saved canvas access without model credentials', () => {
  it('keeps saved canvases accessible after removing the key, including settings roundtrips', async () => {
    const catalog = { version: '0.1.0', configured: false, keyRef: 'ARK_API_KEY', model: 'seedream', defaultSize: '2K', watermark: false, canvases: [{ sessionId: 'board-local', title: '已有分层画布', count: 2, updatedAt: new Date().toISOString() }] }
    const fetcher = vi.fn(async () => ({ ok: true, value: catalog })) as unknown as Fetcher
    const controller = new Controller(() => { throw new Error('Local editing must not request credentials') }, fetcher)
    const node = document.createElement('div'), root = createRoot(node)
    const openConversation = vi.fn(() => true), conversation = vi.fn()
    const render = () => root.render(<Workspace controller={controller} openConversation={openConversation} conversation={conversation}/>)
    try {
      await act(async () => { await controller.attach(); render() })
      expect(node.querySelector('.sd-settings')).toBeNull()
      expect(node.textContent).toContain('已保存的画布可继续编辑和导出')
      await act(async () => { node.querySelector<HTMLButtonElement>('.sd-card')!.click() })
      expect(node.querySelector('[data-saved-canvas]')).not.toBeNull()
      expect(openConversation).not.toHaveBeenCalled()
      await act(async () => { await controller.attach() })
      expect(node.querySelector('[data-saved-canvas]')).not.toBeNull()
      await act(async () => { node.querySelector<HTMLButtonElement>('[aria-label="设置"]')!.click() })
      expect(node.querySelector('.sd-settings')).not.toBeNull()
      await act(async () => { node.querySelector<HTMLButtonElement>('[aria-label="返回全部画布"]')!.click() })
      expect(node.querySelector('.sd-card')).not.toBeNull()
      expect(vi.mocked(fetcher).mock.calls.every(([url]) => !String(url).includes('/generate') && !String(url).includes('/decompose'))).toBe(true)
    } finally { await act(async () => root.unmount()); controller.dispose() }
  })
  it('still introduces key setup when there are no saved canvases', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, value: { version: '0.1.0', configured: false, canvases: [], defaultSize: '2K', watermark: false } })) as unknown as Fetcher
    const controller = new Controller(() => { throw new Error('No credential read expected') }, fetcher)
    const node = document.createElement('div'), root = createRoot(node)
    try {
      await act(async () => { await controller.attach(); root.render(<Workspace controller={controller} openConversation={() => false} conversation={vi.fn()}/>) })
      expect(node.querySelector('input[type="password"]')).not.toBeNull()
      expect(node.querySelector('.sd-gallery')).toBeNull()
    } finally { await act(async () => root.unmount()); controller.dispose() }
  })
})
