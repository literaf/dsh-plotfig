import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDiagramTemplate, DIAGRAM_TEMPLATES, DIAGRAM_PALETTES } from '../src/shared/templates.js'
import { arrowPoints, duplicateLayers, isNode, updateConnectors } from '../src/shared/diagram.js'
import { diagramSvg } from '../src/shared/diagram-svg.js'
import { parseCompositionEdit, layerBounds } from '../src/shared/layers.js'
import { CanvasStore } from '../src/store.js'
import { createHandlers } from '../src/routes.js'
import { AI4ScholarClient } from '../src/ai4scholar.js'
import { Seedream } from '../src/service.js'
import { Preferences } from '../src/preferences.js'
import { EditorModel } from '../src/client/editor-model.js'
import type { CanvasLayer, Composition } from '../src/shared/types.js'
let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'seedream-templates-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const ends = (l: CanvasLayer) => { const p = arrowPoints(l); return [l.x + p[0]!, l.y + p[1]!, l.x + p.at(-2)!, l.y + p.at(-1)!] }

describe('local diagram templates', () => {
  it('persists all template/palette combinations as bounded editable layers and rejects unknown choices', () => {
    for (const t of DIAGRAM_TEMPLATES) for (const p of DIAGRAM_PALETTES) {
      const template = createDiagramTemplate(t.id, p.id), parsed = parseCompositionEdit(template, new Set())
      expect(parsed).toEqual(template)
      expect(parsed.layers.filter(isNode).length).toBeGreaterThanOrEqual(4)
      for (const l of parsed.layers) {
        const b = layerBounds(l)
        expect(b.x).toBeGreaterThanOrEqual(0); expect(b.y).toBeGreaterThanOrEqual(0)
        expect(b.x + b.width).toBeLessThanOrEqual(template.width); expect(b.y + b.height).toBeLessThanOrEqual(template.height)
        expect(l.assetId).toBeUndefined()
      }
    }
    expect(() => createDiagramTemplate('../file')).toThrow('模板')
    expect(() => createDiagramTemplate('experiment', 'invalid')).toThrow('配色')
  })
  it('moves connections with rotated nodes, preserves label edits and restores the graph with undo', async () => {
    const store = new CanvasStore(root), { composition } = await store.createTemplate('board-local', 'experiment', 'ocean')
    const editor = new EditorModel(composition, async (c, v) => (await store.editComposition('board-local', c.id, v, c)).composition)
    try {
      const link = composition.layers.find(l => l.startBinding?.layerId === 'n0')!, before = ends(link)
      editor.change(c => ({ ...c, layers: c.layers.map(l => l.id === 'n0' ? { ...l, x: l.x + 30, y: l.y + 20, text: '新的实验步骤', rotation: 90 } : l) }))
      const changed = editor.getSnapshot().composition, current = changed.layers.find(l => l.id === link.id)!
      expect(ends(current)).not.toEqual(before)
      expect(ends(current)[0]).toBeCloseTo(45); expect(ends(current)[1]).toBeCloseTo(540)
      await editor.flush()
      expect((await new CanvasStore(root).get('board-local')).compositions![0]!.layers.find(l => l.id === 'n0')!.text).toBe('新的实验步骤')
      editor.undo(); expect(editor.getSnapshot().composition.layers).toEqual(composition.layers)
      editor.redo(); expect(editor.getSnapshot().composition.layers).toEqual(changed.layers)
      await editor.flush()
      const copied = await store.createComposition('board-local', '', editor.getSnapshot().composition)
      expect(copied.composition.id).not.toBe(composition.id)
      expect(copied.canvas.items).toEqual([])
    } finally { editor.dispose() }
  })
  it('detaches removed endpoints and remaps copied selections without affecting the original graph', () => {
    const layers = createDiagramTemplate('experiment').layers, link = layers.find(l => l.startBinding?.layerId === 'n0')!
    const removed = updateConnectors(layers.filter(l => l.id !== 'n0')).find(l => l.id === link.id)!
    expect(removed.startBinding).toBeUndefined(); expect(removed.endBinding).toBeUndefined(); expect(ends(removed)).toEqual(ends(link))
    let i = 0
    const copy = duplicateLayers(layers, () => `copy-${i++}`), edge = copy.find(l => l.name === `${link.name} 副本`)!
    expect(copy.some(l => l.id === edge.startBinding!.layerId)).toBe(true)
    expect(edge.startBinding!.layerId).not.toBe('n0')
    expect(ends(edge)).toEqual(ends(link).map(n => n + 32))
    expect(duplicateLayers([link], () => 'lonely')[0]!.startBinding).toBeUndefined()
  })
  it('rejects malformed arrow geometry and node styles at the save boundary', () => {
    const c = createDiagramTemplate('experiment'), arrow = c.layers.find(l => l.kind === 'arrow')!, node = c.layers.find(isNode)!
    for (const bad of [[0, 0, 1], [0, NaN, 1, 1], [0, -1, 1, 1], [0, 0, Infinity, 1]]) expect(() => parseCompositionEdit({ ...c, layers: [{ ...arrow, points: bad }] }, new Set())).toThrow('路径')
    expect(() => parseCompositionEdit({ ...c, layers: [{ ...node, textColor: 'url(https://example.test)' }] }, new Set())).toThrow('颜色')
    expect(() => parseCompositionEdit({ ...c, layers: [{ ...arrow, startBinding: { layerId: '../../x', side: 'right' } }] }, new Set())).toThrow('节点')
  })
  it('creates and copies without credentials, rejects foreign images, and never invokes the paid API', async () => {
    const fetch = vi.fn(), key = vi.fn(async () => { throw new Error('must stay local') }), store = new CanvasStore(root)
    const service = new Seedream(new AI4ScholarClient({ apiKey: key, userAgent: 'test', timeoutMs: 1000, fetch }), store)
    const handlers = createHandlers(service, new Preferences(join(root, 'prefs'), { size: '2K', watermark: true }), async () => ({ version: '0', configured: false, keyRef: 'AI4SCHOLAR_API_KEY', model: 'test', defaultSize: '2K', watermark: true }))
    const request = (body: unknown) => new Request('http://local/api/seedream/composition?session=board-test', { method: 'POST', body: JSON.stringify(body) })
    const response = await handlers.composition(request({ templateId: 'screening', palette: 'mono' }))
    expect(response.status).toBe(200)
    const { value } = await response.json() as { value: { composition: Composition } }
    expect((await store.list())[0]).toMatchObject({ title: '筛选与判断', count: 1, diagramCover: value.composition.id })
    const cover = await handlers.image(new Request(`http://local/api/seedream/image?session=board-test&id=${value.composition.id}&diagram=1`))
    expect(cover.status).toBe(200); expect(cover.headers.get('content-type')).toContain('image/svg+xml'); expect(await cover.text()).toContain('<polygon')
    expect((await handlers.image(new Request(`http://local/api/seedream/image?session=other&id=${value.composition.id}&diagram=1`))).status).toBe(404)
    expect((await handlers.composition(request({ templateId: 'unknown' }))).status).toBe(400)
    expect((await handlers.composition(request({ sourceId: '', composition: value.composition }))).status).toBe(200)
    const bad = { ...value.composition.layers[0], kind: 'image', assetId: 'aaaaaaaaaaaa' }
    expect((await handlers.composition(request({ sourceId: '', composition: { ...value.composition, layers: [bad] } }))).status).toBe(400)
    expect(fetch).not.toHaveBeenCalled(); expect(key).not.toHaveBeenCalled()
  })
  it('exports escaped text and vector arrows without embedding external resources', () => {
    const c = createDiagramTemplate('screening')
    const svg = diagramSvg({ ...c, title: '<script>', layers: c.layers.map(l => l.id === 'input' ? { ...l, text: '<img onerror="x"> & 数据' } : l) })
    expect(svg).toContain('&lt;img onerror=&quot;x&quot;&gt; &amp; 数据')
    expect(svg).not.toContain('<script>'); expect(svg).not.toContain('<image')
    expect(svg).toContain('<polygon'); expect(svg).toContain('<polyline'); expect(svg).toContain('<text')
    expect(() => diagramSvg({ ...c, layers: [{ ...c.layers[0]!, kind: 'image' }] })).toThrow('SVG')
  })
})
