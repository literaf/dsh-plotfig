// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasView } from '../src/client/Canvas.js'
import { Controller } from '../src/client/controller.js'
import type { Fetcher } from '../src/client/controller.js'

vi.mock('react-konva', () => ({ Stage: () => null, Layer: () => null, Group: () => null, Image: () => null, Rect: () => null }))
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => vi.unstubAllGlobals())
describe('canvas input ownership', () => {
  it.each(['session-a', 'board-a'])('uses the correct composer for %s', async sessionId => {
    const fetcher = vi.fn(async () => ({ ok: true, value: { sessionId, revision: 0, items: [], pending: [] } })) as unknown as Fetcher
    const c = new Controller(() => { throw new Error('No credentials needed for this UI check') }, fetcher), model = c.canvas(sessionId)
    await model.refresh()
    const actions = { reference: vi.fn(), edit: vi.fn(), prompt: vi.fn(async () => 'filled' as const), focus: vi.fn() }
    const node = document.createElement('div'), root = createRoot(node)
    try {
      await act(async () => { root.render(<CanvasView model={model} conversation={actions}/>) })
      const native = sessionId.startsWith('session-')
      expect(node.querySelectorAll('.sd-composer textarea')).toHaveLength(native ? 0 : 1)
      const example = node.querySelector<HTMLButtonElement>('.sd-examples button')!
      await act(async () => example.click())
      if (native) expect(actions.prompt).toHaveBeenCalledWith(example.textContent)
      else { expect(actions.prompt).not.toHaveBeenCalled(); expect(node.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(example.textContent) }
      expect((fetcher as unknown as { mock: { calls: string[][] } }).mock.calls.every(call => !call[0]?.includes('/generate'))).toBe(true)
    } finally { await act(async () => root.unmount()); c.dispose() }
  })
})
