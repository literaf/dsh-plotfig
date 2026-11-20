import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { editableText, originalTextImage, ocrPlainText, parseOCR, readOCR, replaceRunText } from '../src/shared/ocr.js'
import { layerBounds, parseCompositionEdit } from '../src/shared/layers.js'
import { estimateOCRFonts, ocrTextNodes } from '../src/client/ocr-layout.js'
import { CanvasStore } from '../src/store.js'
import { EditorModel } from '../src/client/editor-model.js'
import type { CanvasItem, CanvasLayer, Composition, TextRun } from '../src/shared/types.js'
import { png } from './fixtures.js'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'seedream-ocr-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const style = (patch: Record<string, unknown> = {}) => ({ similar_font_family: 'Arial', foreground_color: '#193366', bold: false, italic: false, underline: false, strikethrough: false, shadow: false, translucent: false, ...patch })
const asset = (): CanvasItem => ({ id: 'aaaaaaaaaaaa', title: '文字图层', prompt: 'test', width: 1600, height: 1200, x: 0, y: 0, refs: [], externalRefs: 0, size: '2K', createdAt: 'now', role: 'layer', layerMetadata: {
  zIndex: 4, bounds: [1000, 500, 1400, 800], textRecognition: { text: 'Research Day\nAi4Scholar', lines: [
    { bounding_box: { absolute: [1040, 550, 1260, 580], normalized: [0, 0, 1, 1] }, runs: [{ text: 'Research ', style: style({ bold: true }) }, { text: 'Day', style: style({ foreground_color: '#E53580', italic: true, underline: true }) }] },
    { bounding_box: { normalized: [520, 600, 650, 630] }, runs: [{ text: 'Ai4Scholar', style: style({ strikethrough: true, shadow: true, translucent: true }) }] },
  ] },
} })
const canvas = { width: 2000, height: 1000 }
const image = (): CanvasLayer => ({ id: 'text-layer', kind: 'image', name: '文字图层', assetId: asset().id, x: 2500, y: 600, width: 800, height: 600, rotation: 30, opacity: 0.8, hidden: false, locked: false })
const scene = (layers: CanvasLayer[]): Composition => ({ id: 'cccccccccccc', sourceId: 'bbbbbbbbbbbb', title: 'OCR', width: 2000, height: 1000, x: 0, y: 0, version: 0, background: 'transparent', layers })
const measure = (r: TextRun, size: number) => Array.from(r.text).length * size * 0.6

describe('Seedream OCR import', () => {
  it('uses base-image coordinates and source bounding-box scale, not the high-resolution layer PNG', () => {
    const source = asset(), before = JSON.stringify(source), ocr = readOCR(source, canvas)!
    expect(ocr).toMatchObject({ sourceAssetId: source.id, width: 400, height: 300 })
    expect(ocr.lines[0]).toMatchObject({ x: 40, y: 50, width: 220, height: 30 })
    expect(ocr.lines[1]).toMatchObject({ x: 40, y: 100, width: 260, height: 30 })
    expect(ocr.lines[0]!.runs[1]).toMatchObject({ text: 'Day', fill: '#E53580', italic: true, underline: true })
    expect(ocr.lines[1]!.runs[0]).toMatchObject({ shadow: true, translucent: true, strikethrough: true })
    expect(ocrPlainText(ocr)).toBe('Research Day\nAi4Scholar'); expect(JSON.stringify(source)).toBe(before)
    const moved = image(), text = editableText(moved, ocr)
    for (const key of ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'id'] as const) expect(text[key]).toBe(moved[key])
    expect(text.kind).toBe('text'); expect(originalTextImage(text)).toEqual(moved)
  })
  it('keeps legacy or malformed raster layers unchanged, rather than hiding text with incomplete OCR', () => {
    const a = asset(), raw = a.layerMetadata!.textRecognition as { lines: unknown[] }
    expect(readOCR({ ...a, layerMetadata: { zIndex: 1 } }, canvas)).toBeUndefined()
    expect(readOCR({ ...a, layerMetadata: { ...a.layerMetadata!, textRecognition: { text: 'no line coordinates' } } }, canvas)).toBeUndefined()
    for (const broken of [null, { runs: [] }, { bounding_box: { absolute: [1, 2, 0, 0] }, runs: [{ text: 'x' }] }, { bounding_box: { absolute: [1, 2, 10, 20] }, runs: [{ text: 'x\ny' }] }]) {
      expect(readOCR({ ...a, layerMetadata: { ...a.layerMetadata!, textRecognition: { lines: [raw.lines[0], broken] } } }, canvas)).toBeUndefined()
    }
    expect(originalTextImage(image())).toEqual(image())
  })
  it('uses safe font/color fallbacks without treating unknown fonts as exact matches', () => {
    const a = asset(), raw = a.layerMetadata!.textRecognition as { lines: Array<{ runs: Array<{ style: Record<string, unknown> }> }> }
    raw.lines[0]!.runs[0]!.style = style({ similar_font_family: 'unknown', foreground_color: 'url(https://bad.test/)' })
    const ocr = readOCR(a, canvas)!
    expect(ocr.lines[0]!.runs[0]).toMatchObject({ fontFamily: 'Arial', fill: '#20242c' })
  })
})

describe('rich text edits and shared rendering', () => {
  it('retains unchanged style runs on both sides of edits, including deletion and Unicode', () => {
    const runs = readOCR(asset(), canvas)!.lines[0]!.runs, before = JSON.stringify(runs)
    const edited = replaceRunText(runs, 'Research Week')
    expect(edited.map(r => r.text).join('')).toBe('Research Week')
    expect(edited[0]).toMatchObject({ text: 'Research ', bold: true }); expect(edited[1]).toMatchObject({ text: 'Week', italic: true, fill: '#E53580' })
    const middle = replaceRunText(runs, 'Research Open Day')
    expect(middle.map(r => r.text).join('')).toBe('Research Open Day'); expect(middle.at(-1)!.italic).toBe(true)
    const cleared = replaceRunText(runs, ''); expect(cleared).toHaveLength(1); expect(cleared[0]!.text).toBe('')
    const unicode = replaceRunText(runs, '科研 🌱 Day'); expect(unicode.map(r => r.text).join('')).toBe('科研 🌱 Day'); expect(unicode.at(-1)!.italic).toBe(true)
    expect(replaceRunText(runs, 'Research\nDay').map(r => r.text).join('')).toBe('Research Day')
    expect(JSON.stringify(runs)).toBe(before)
  })
  it('fits longer edits and renders every run with its own style, using the same attributes for preview and export', () => {
    const ocr = estimateOCRFonts(readOCR(asset(), canvas)!, measure)
    const nodes = ocrTextNodes(ocr, measure)
    expect(nodes).toHaveLength(3)
    expect(nodes[0]).toMatchObject({ x: 40, y: 50, fill: '#193366', fontStyle: 'bold' })
    expect(nodes[1]).toMatchObject({ fill: '#E53580', fontStyle: 'italic', textDecoration: 'underline' })
    expect(nodes[2]).toMatchObject({ opacity: 0.6, shadowEnabled: true, textDecoration: 'line-through' })
    const line = ocr.lines[0]!
    const long = { ...ocr, lines: [{ ...line, runs: replaceRunText(line.runs, 'A much longer edited research presentation heading') }] }
    const resized = ocrTextNodes(long, measure)
    const occupied = resized.reduce((sum, n) => sum + Number(n.width) - 0.01, 0)
    expect(occupied).toBeLessThanOrEqual(line.width + 1e-6)
    expect(resized[0]!.fontSize).toBeLessThan(nodes[0]!.fontSize!)
    const tiny = ocrTextNodes({ ...long, lines: [{ ...long.lines[0]!, width: 1, runs: [{ ...line.runs[0]!, text: 'a'.repeat(10000) }] }] }, measure)
    expect(Number(tiny[0]!.width)).toBeLessThanOrEqual(1.011)
  })
  it('includes moved OCR lines outside their original image in rotated export bounds', () => {
    const ocr = readOCR(asset(), canvas)!, text = editableText({ ...image(), rotation: 0 }, { ...ocr, lines: [{ ...ocr.lines[0]!, x: -80, y: -40, width: 600 }] })
    expect(layerBounds(text)).toMatchObject({ x: 2340, y: 520, width: 1200, height: 680 })
    const rotated = layerBounds({ ...text, rotation: 90 })
    expect(rotated.x).toBeCloseTo(1900); expect(rotated.y).toBeCloseTo(440)
    expect(rotated.width).toBeCloseTo(680); expect(rotated.height).toBeCloseTo(1200)
  })
})

describe('OCR persistence and restoration', () => {
  it('whitelists nested OCR data and rejects foreign backups, invalid geometry and oversized text', () => {
    const ocr = readOCR(asset(), canvas)!, assets = new Set([asset().id]), converted = editableText(image(), ocr)
    const extra = { ...ocr, executable: 'drop', lines: [{ ...ocr.lines[0]!, url: 'drop', runs: [{ ...ocr.lines[0]!.runs[0]!, extra: true }] }] }
    const parsed = parseCompositionEdit(scene([{ ...converted, ocr: extra }]), assets).layers[0]!
    expect(parsed.ocr).not.toHaveProperty('executable'); expect(parsed.ocr!.lines[0]).not.toHaveProperty('url'); expect(parsed.ocr!.lines[0]!.runs[0]).not.toHaveProperty('extra')
    expect(parsed.text).toBe('Research ')
    expect(() => parseOCR({ ...ocr, sourceAssetId: 'ffffffffffff' }, assets)).toThrow('当前对话')
    expect(() => parseOCR({ ...ocr, lines: [{ ...ocr.lines[0], x: Infinity }] }, assets)).toThrow('无效')
    expect(() => parseOCR({ ...ocr, lines: [{ ...ocr.lines[0], runs: [{ ...ocr.lines[0]!.runs[0], text: 'a'.repeat(10001) }] }] }, assets)).toThrow('无效')
    expect(() => parseOCR({ ...ocr, lines: [{ ...ocr.lines[0], runs: [{ ...ocr.lines[0]!.runs[0], fill: 'red' }] }] }, assets)).toThrow('无效')
  })
  it('saves edited content and backup references across reload, and protects the original raster', async () => {
    const store = new CanvasStore(root), meta = { title: 'OCR test', prompt: 'test', refs: [], externalRefs: 0, size: '2K' }
    const { items } = await store.add('s', [{ bytes: png(2000, 1000), width: 2000, height: 1000 }, { bytes: png(1600, 1200), width: 1600, height: 1200 }], meta)
    const { composition } = await store.createComposition('s', items[0]!.id)
    const ocr = { ...readOCR(asset(), canvas)!, sourceAssetId: items[1]!.id }
    const converted = editableText(image(), ocr)
    const editor = new EditorModel({ ...composition, layers: [converted] }, async (c, version) => (await store.editComposition('s', c.id, version, c)).composition)
    editor.change(c => ({ ...c, layers: [{ ...converted, ocr: { ...ocr, lines: [{ ...ocr.lines[0]!, runs: replaceRunText(ocr.lines[0]!.runs, '科研绘图开放日') }] } }] }))
    expect(await editor.flush()).toBe(true)
    const reloaded = await new CanvasStore(root).get('s'), text = reloaded.compositions![0]!.layers[0]!
    expect(text.text).toBe('科研绘图开放日'); expect(text.ocr!.sourceAssetId).toBe(items[1]!.id)
    await expect(store.remove('s', items[1]!.id)).rejects.toThrow('仍被')
    editor.change(c => ({ ...c, layers: c.layers.map(originalTextImage) })); await editor.flush()
    expect((await store.get('s')).compositions![0]!.layers[0]).toMatchObject({ kind: 'image', assetId: items[1]!.id })
    editor.undo(); await editor.flush()
    expect((await store.get('s')).compositions![0]!.layers[0]!.text).toBe('科研绘图开放日')
    editor.dispose()
  })
})
