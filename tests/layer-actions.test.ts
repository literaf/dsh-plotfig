import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasLayer, Composition } from '../src/shared/types.js'
import type { CanvasModel } from '../src/client/controller.js'
import { EditorModel } from '../src/client/editor-model.js'
import { mergeSelectedLayers } from '../src/client/layer-actions.js'
import { renderLayers } from '../src/client/layer-render.js'

vi.mock('../src/client/layer-render.js', () => ({ renderLayers: vi.fn(async () => 'data:image/png;base64,local') }))
const shape = (id: string, x: number): CanvasLayer => ({ id, kind: 'rect', name: id, x, y: 20.5, width: 100, height: 80, rotation: 0, opacity: 1, hidden: false, locked: false, fill: '#333333', stroke: '#ffffff', strokeWidth: 3 })
const scene = (): Composition => ({ id: 'cccccccccccc', sourceId: 'aaaaaaaaaaaa', title: 'Inline merge', x: 800, y: 0, width: 500, height: 400, version: 0, background: 'transparent', layers: [{ ...shape('base', 0), locked: true }, shape('a', -20.5), shape('between', 150), shape('b', 280), shape('top', 400)] })
afterEach(() => vi.clearAllMocks())
describe('shared local layer merge', () => {
  it('keeps unselected stacking and source layers, rounds export bounds, and saves undo/redo', async () => {
    const initial = scene(), save = vi.fn(async (c: Composition, version: number) => ({ ...c, version: version + 1 }))
    const editor = new EditorModel(initial, save), importComposite = vi.fn(async () => ({ id: 'dddddddddddd' }))
    const model = { sessionId: 'board-qa', importComposite } as unknown as CanvasModel
    try {
      const id = await mergeSelectedLayers(model, editor, ['a', 'b'])
      const merged = editor.getSnapshot().composition
      expect(merged.layers.map(l => l.id)).toEqual(['base', 'between', id, 'top'])
      expect(merged.layers[2]).toMatchObject({ assetId: 'dddddddddddd', x: -22, y: 19, width: 404, height: 83, locked: false, opacity: 1 })
      expect(importComposite).toHaveBeenCalledExactlyOnceWith('data:image/png;base64,local', '合并图层')
      expect(renderLayers).toHaveBeenCalledWith('board-qa', [initial.layers[1], initial.layers[3]], { x: -22, y: 19, width: 404, height: 83 })
      expect(initial.layers).toHaveLength(5)
      await editor.flush(); editor.undo(); expect(editor.getSnapshot().composition.layers).toEqual(initial.layers)
      await editor.flush(); editor.redo(); expect(editor.getSnapshot().composition.layers).toEqual(merged.layers)
      await editor.flush(); expect(save.mock.calls.map(([, version]) => version)).toEqual([0, 1, 2])
    } finally { editor.dispose() }
  })
  it('rejects locked selections and failed imports without removing originals', async () => {
    const initial = scene(), editor = new EditorModel(initial, async c => c), importComposite = vi.fn(async () => { throw new Error('disk full') })
    const model = { sessionId: 'board-qa', importComposite } as unknown as CanvasModel
    try {
      await expect(mergeSelectedLayers(model, editor, ['base', 'a'])).rejects.toThrow('未锁定')
      expect(importComposite).not.toHaveBeenCalled()
      await expect(mergeSelectedLayers(model, editor, ['a', 'b'])).rejects.toThrow('disk full')
      expect(editor.getSnapshot()).toMatchObject({ composition: initial, dirty: false, canUndo: false })
    } finally { editor.dispose() }
  })
  it('does not overwrite edits made in another view while a merge is rendering', async () => {
    const initial = scene(), editor = new EditorModel(initial, async (c, version) => ({ ...c, version: version + 1 }))
    const model = { sessionId: 'board-qa', importComposite: async () => {
      editor.change(c => ({ ...c, layers: c.layers.map(l => l.id === 'a' ? { ...l, x: 50 } : l) }))
      return { id: 'dddddddddddd' }
    } } as unknown as CanvasModel
    try {
      await expect(mergeSelectedLayers(model, editor, ['a', 'b'])).rejects.toThrow('发生变化')
      expect(editor.getSnapshot().composition.layers).toHaveLength(5)
      expect(editor.getSnapshot().composition.layers[1]?.x).toBe(50)
      await editor.flush()
    } finally { editor.dispose() }
  })
})
