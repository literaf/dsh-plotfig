import { mkdir, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { entryOf, isRecord, ITEM_ID, SESSION_ID } from './shared/types.js'
import type { Canvas, CanvasEntry, CanvasItem, CanvasLayer, Composition } from './shared/types.js'
import type { ArkImage } from './ark.js'
import { parseCompositionEdit } from './shared/layers.js'
import { parseGenerationStyle } from './shared/research.js'
export const GAP = 80
async function atomic(path: string, data: string | Uint8Array): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`
  try { await writeFile(temp, data, { mode: 0o600, flag: 'wx' }); await rename(temp, path) }
  finally { await rm(temp, { force: true }) }
}
export const checkSession = (id: string): string => { if (!SESSION_ID.test(id)) throw new Error('无效的对话 ID。'); return id }
export const checkItem = (id: string): string => { if (!ITEM_ID.test(id)) throw new Error('无效的图片 ID。'); return id }
export class EditConflict extends Error { constructor() { super('画板已在其他窗口更新，当前编辑仍保留。可另存副本，避免覆盖另一窗口的内容。') } }
const rightEdge = (canvas: Canvas) => [...canvas.items.filter(i => i.role !== 'layer'), ...canvas.compositions ?? []].reduce((m, i) => Math.max(m, i.x + i.width + GAP), 0)
const imageLayer = (asset: CanvasItem, box = { x: 0, y: 0, width: asset.width, height: asset.height }): CanvasLayer => ({
  id: randomUUID(), kind: 'image', name: asset.title, assetId: asset.id, ...box, rotation: 0, opacity: 1, hidden: false, locked: false,
})
/** One canvas per Session: canvas.json is canonical; images/<id>.png are immutable. */
export class CanvasStore {
  /** Serializes read-modify-write per Session so concurrent generations never drop items. */
  private queues = new Map<string, Promise<unknown>>()
  constructor(readonly root: string) {}
  directory(sessionId: string): string { return join(this.root, checkSession(sessionId)) }
  imagePath(sessionId: string, itemId: string): string { return join(this.directory(sessionId), 'images', `${checkItem(itemId)}.png`) }
  private canvasPath(sessionId: string): string { return join(this.directory(sessionId), 'canvas.json') }
  private serial<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(task)
    this.queues.set(sessionId, next)
    void next.finally(() => { if (this.queues.get(sessionId) === next) this.queues.delete(sessionId) }).catch(() => undefined)
    return next
  }
  async get(sessionId: string): Promise<Canvas> {
    const now = new Date().toISOString()
    let raw: unknown
    try { raw = JSON.parse(await readFile(this.canvasPath(sessionId), 'utf8')) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { sessionId, revision: 0, createdAt: now, updatedAt: now, items: [] }
      throw error
    }
    if (!isRecord(raw) || raw.sessionId !== sessionId || !Array.isArray(raw.items) || typeof raw.revision !== 'number') throw new Error('画布数据无效。')
    return raw as unknown as Canvas
  }
  private async commit(canvas: Canvas): Promise<Canvas> {
    canvas.revision++; canvas.updatedAt = new Date().toISOString()
    await mkdir(this.directory(canvas.sessionId), { recursive: true, mode: 0o700 })
    await atomic(this.canvasPath(canvas.sessionId), JSON.stringify(canvas, null, 2) + '\n')
    return canvas
  }
  readImage(sessionId: string, itemId: string): Promise<Buffer> { return readFile(this.imagePath(sessionId, itemId)) }
  async setGenerationStyle(sessionId: string, style: unknown): Promise<Canvas> {
    const generationStyle = parseGenerationStyle(style)
    return this.serial(sessionId, async () => {
      const canvas = await this.get(sessionId)
      canvas.generationStyle = generationStyle
      return this.commit(canvas)
    })
  }
  /** Place new images to the right of the parent (or the rightmost item), matching the workspace's left-to-right flow. */
  async add(sessionId: string, images: Array<{ bytes: Uint8Array; width: number; height: number }>, meta: Omit<CanvasItem, 'id' | 'x' | 'y' | 'width' | 'height' | 'createdAt'>, parentId?: string): Promise<{ canvas: Canvas; items: CanvasItem[] }> {
    return this.serial(sessionId, async () => {
      const canvas = await this.get(sessionId)
      await mkdir(join(this.directory(sessionId), 'images'), { recursive: true, mode: 0o700 })
      const parent = parentId ? canvas.items.find(i => i.id === parentId) : undefined
      let x = rightEdge(canvas)
      const y = parent?.y ?? 0
      const items: CanvasItem[] = []
      for (const [index, image] of images.entries()) {
        const id = randomBytes(6).toString('hex')
        await atomic(this.imagePath(sessionId, id), image.bytes)
        const item: CanvasItem = { ...meta, title: images.length > 1 ? `${meta.title}_${index + 1}` : meta.title, id, x, y, width: image.width, height: image.height, createdAt: new Date().toISOString() }
        items.push(item); canvas.items.push(item); x += image.width + GAP
      }
      if (!canvas.title) canvas.title = meta.title
      return { canvas: await this.commit(canvas), items }
    })
  }
  /** Layout-only update; ignores unknown ids and never changes image metadata. */
  async move(sessionId: string, positions: Array<{ id: string; x: number; y: number }>): Promise<Canvas> {
    return this.serial(sessionId, async () => {
      const canvas = await this.get(sessionId)
      for (const p of positions) {
        const item = canvas.items.find(i => i.id === p.id && i.role !== 'layer') ?? canvas.compositions?.find(i => i.id === p.id)
        if (item && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 1e7 && Math.abs(p.y) < 1e7) { item.x = Math.round(p.x); item.y = Math.round(p.y) }
      }
      return this.commit(canvas)
    })
  }
  async remove(sessionId: string, itemId: string): Promise<Canvas> {
    return this.serial(sessionId, async () => {
      const canvas = await this.get(sessionId)
      if (!canvas.items.some(i => i.id === checkItem(itemId))) throw new Error('图片不存在。')
      if (canvas.compositions?.some(c => c.sourceId === itemId || c.layers.some(l => l.assetId === itemId || l.ocr?.sourceAssetId === itemId))) throw new Error('这张图仍被图层画板使用，请先删除相关画板。')
      canvas.items = canvas.items.filter(i => i.id !== itemId)
      const next = await this.commit(canvas)
      await rm(this.imagePath(sessionId, itemId), { force: true })
      return next
    })
  }
  async createComposition(sessionId: string, sourceId: string, edit?: unknown): Promise<{ canvas: Canvas; composition: Composition }> {
    return this.serial(sessionId, async () => {
      const canvas = await this.get(sessionId), source = canvas.items.find(i => i.id === checkItem(sourceId))
      if (!source) throw new Error('原图不存在。')
      const composition: Composition = { id: randomBytes(6).toString('hex'), sourceId, title: `${source.title} · 图层画板`, x: rightEdge(canvas), y: source.y,
        width: source.width, height: source.height, background: 'transparent', version: 0, layers: [imageLayer(source)] }
      if (edit !== undefined) Object.assign(composition, parseCompositionEdit(edit, new Set(canvas.items.map(i => i.id))))
      ;(canvas.compositions ??= []).push(composition)
      return { canvas: await this.commit(canvas), composition }
    })
  }
  /** Raw assets remain immutable; scene edits are versioned separately from new generations. */
  async editComposition(sessionId: string, id: string, version: unknown, edit: unknown): Promise<{ canvas: Canvas; composition: Composition }> {
    return this.serial(sessionId, async () => {
      const canvas = await this.get(sessionId), composition = canvas.compositions?.find(c => c.id === checkItem(id))
      if (!composition) throw new Error('图层画板不存在。')
      if (version !== composition.version) throw new EditConflict()
      const patch = parseCompositionEdit(edit, new Set(canvas.items.map(i => i.id)))
      Object.assign(composition, patch, { version: composition.version + 1 })
      return { canvas: await this.commit(canvas), composition }
    })
  }
  async removeComposition(sessionId: string, id: string): Promise<Canvas> {
    return this.serial(sessionId, async () => {
      const canvas = await this.get(sessionId)
      if (!canvas.compositions?.some(c => c.id === checkItem(id))) throw new Error('图层画板不存在。')
      // Original and generated layer bytes are preserved, including assets used by another artboard.
      canvas.compositions = canvas.compositions.filter(c => c.id !== id)
      return this.commit(canvas)
    })
  }
  async addDecomposition(sessionId: string, sourceId: string, images: ArkImage[], warnings: string[] = []): Promise<{ canvas: Canvas; items: CanvasItem[]; composition: Composition }> {
    return this.serial(sessionId, async () => {
      const canvas = await this.get(sessionId), source = canvas.items.find(i => i.id === checkItem(sourceId))
      if (!source) throw new Error('原图不存在，无法保存分层结果。')
      const base = images.find(i => i.layer?.zIndex === 0), width = base?.width ?? source.width, height = base?.height ?? source.height
      const messages = [...warnings], items: CanvasItem[] = [], layers: CanvasLayer[] = []
      if (!base) { messages.push('底图未返回或下载失败，暂用原图作为底层。'); layers.push({ ...imageLayer(source, { x: 0, y: 0, width, height }), locked: true }) }
      for (const image of [...images].sort((a, b) => (a.layer?.zIndex ?? 0) - (b.layer?.zIndex ?? 0))) {
        const id = randomBytes(6).toString('hex'), z = image.layer?.zIndex ?? items.length
        const item: CanvasItem = { id, title: image.layer?.name ?? (z === 0 ? '底图' : `图层 ${z}`), prompt: source.prompt, width: image.width, height: image.height, x: 0, y: 0,
          refs: [sourceId], externalRefs: 0, size: `${image.width}x${image.height}`, role: 'layer', createdAt: new Date().toISOString(), ...(image.layer ? { layerMetadata: image.layer } : {}) }
        await atomic(this.imagePath(sessionId, id), image.bytes)
        items.push(item); canvas.items.push(item)
        const b = image.layer?.bounds
        const box = z === 0 ? { x: 0, y: 0, width, height } : b ? { x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1] } : { x: 0, y: 0, width: image.width, height: image.height }
        if (z !== 0 && !b) messages.push(`${item.title}缺少位置数据，已保留图片，请手动定位。`)
        layers.push({ ...imageLayer(item, box), locked: z === 0 })
      }
      const composition: Composition = { id: randomBytes(6).toString('hex'), title: `${source.title} · 分图层`, sourceId, x: rightEdge(canvas), y: source.y,
        width, height, background: 'transparent', version: 0, layers, ...(messages.length ? { warnings: messages } : {}) }
      ;(canvas.compositions ??= []).push(composition)
      return { canvas: await this.commit(canvas), items, composition }
    })
  }
  /** @param include - Sessions listed even while their canvas is still empty (a generation is running). */
  async list(include: string[] = []): Promise<CanvasEntry[]> {
    let names: string[]
    try { names = await readdir(this.root) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; names = [] }
    const wanted = new Set(include), all = [...new Set([...names, ...include])].filter(n => SESSION_ID.test(n))
    const entries = await Promise.all(all.map(async n => { try { const c = await this.get(n); return c.items.length || wanted.has(n) ? entryOf(c) : undefined } catch { return undefined } }))
    return entries.filter((e): e is CanvasEntry => !!e).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
}
