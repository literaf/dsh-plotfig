// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ImageEditDialog } from '../src/client/ImageEditDialog.js'
import { Controller } from '../src/client/controller.js'
import type { CanvasItem } from '../src/shared/types.js'

vi.mock('react-konva', () => ({ Stage: () => null, Layer: () => null, Image: () => null, Rect: () => null, Circle: () => null, Line: () => null }))
vi.mock('../src/client/images.js', () => ({ loadImage: vi.fn(async () => new Image()) }))
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => vi.unstubAllGlobals())
const source: CanvasItem = { id: 'aaaaaaaaaaaa', title: '原图', prompt: '', width: 1664, height: 2496, x: 0, y: 0, refs: [], externalRefs: 0, size: '1664x2496', createdAt: '2026-11-14T00:00:00Z' }

it('switches among all four single-sided directions and submits exactly one explicit edit', async () => {
  const controller = new Controller(() => { throw new Error('No credentials used by this simulated UI test') }), model = controller.canvas('board-ui-test')
  const edit = vi.spyOn(model, 'editImage').mockResolvedValue([]), close = vi.fn(), node = document.createElement('div'), root = createRoot(node)
  const button = (name: string) => [...node.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === name)!
  const values = () => ['左', '右', '上', '下'].map(side => Number(node.querySelector<HTMLInputElement>(`[aria-label="${side}侧扩展"]`)!.value))
  try {
    await act(async () => root.render(<ImageEditDialog model={model} source={source} initialOperation="expand" onClose={close}/>))
    expect(values()).toEqual([250, 0, 0, 0])
    for (const [name, expected] of [['向右', [0, 250, 0, 0]], ['向上', [0, 0, 374, 0]], ['向下', [0, 0, 0, 374]], ['向左', [250, 0, 0, 0]]] as const) {
      await act(async () => button(name).click())
      expect(values()).toEqual(expected)
      expect(button(name).getAttribute('aria-pressed')).toBe('true')
    }
    expect(edit).not.toHaveBeenCalled()
    await act(async () => { button('开始扩图').click(); button('开始扩图').click() })
    expect(edit).toHaveBeenCalledTimes(1)
    expect(edit.mock.calls[0]![0]).toMatchObject({ operation: 'expand', image: 'item:aaaaaaaaaaaa', expand: { left: 250, right: 0, top: 0, bottom: 0 } })
    expect(close).toHaveBeenCalledTimes(1)
  } finally { await act(async () => root.unmount()); controller.dispose() }
})

it('makes multi-sided presets explicit and clears other sides when a direction is selected', async () => {
  const controller = new Controller(() => { throw new Error('No credentials used by this simulated UI test') }), model = controller.canvas('board-ui-test')
  const edit = vi.spyOn(model, 'editImage'), node = document.createElement('div'), root = createRoot(node)
  const button = (name: string) => [...node.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === name)!
  try {
    await act(async () => root.render(<ImageEditDialog model={model} source={source} initialOperation="expand" onClose={() => {}}/>))
    await act(async () => button('16:9').click())
    expect(node.textContent).toContain('当前同时扩展多侧')
    await act(async () => button('向右').click())
    expect(node.textContent).not.toContain('当前同时扩展多侧')
    expect(node.querySelector<HTMLInputElement>('[aria-label="左侧扩展"]')!.value).toBe('0')
    expect(edit).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()); controller.dispose() }
})
