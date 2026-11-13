import { mkdir, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { entryOf, isRecord, ITEM_ID, SESSION_ID } from './shared/types.js'
import type { Canvas, CanvasEntry, CanvasItem } from './shared/types.js'
export const GAP = 80
async function atomic(path: string, data: string | Uint8Array): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`
  try { await writeFile(temp, data, { mode: 0o600, flag: 'wx' }); await rename(temp, path) }
  finally { await rm(temp, { force: true }) }
}
export const checkSession = (id: string): string => { if (!SESSION_ID.test(id)) throw new Error('无效的对话 ID。'); return id }
export const checkItem = (id: string): string => { if (!ITEM_ID.test(id)) throw new Error('无效的图片 ID。'); return id }
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
  /** Place new images to the right of the parent (or the rightmost item), matching the workspace's left-to-right flow. */
  async add(sessionId: string, images: Array<{ bytes: Uint8Array; width: number; height: number }>, meta: Omit<CanvasItem, 'id' | 'x' | 'y' | 'width' | 'height' | 'createdAt'>, parentId?: string): Promise<{ canvas: Canvas; items: CanvasItem[] }> {
    return this.serial(sessionId, async () => {
      const canvas = await this.get(sessionId)
      await mkdir(join(this.directory(sessionId), 'images'), { recursive: true, mode: 0o700 })
      const parent = parentId ? canvas.items.find(i => i.id === parentId) : undefined
      let x = canvas.items.reduce((m, i) => Math.max(m, i.x + i.width + GAP), 0)
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
        const item = canvas.items.find(i => i.id === p.id)
        if (item && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 1e7 && Math.abs(p.y) < 1e7) { item.x = Math.round(p.x); item.y = Math.round(p.y) }
      }
      return this.commit(canvas)
    })
  }
  async remove(sessionId: string, itemId: string): Promise<Canvas> {
    return this.serial(sessionId, async () => {
      const canvas = await this.get(sessionId)
      if (!canvas.items.some(i => i.id === checkItem(itemId))) throw new Error('图片不存在。')
      canvas.items = canvas.items.filter(i => i.id !== itemId)
      const next = await this.commit(canvas)
      await rm(this.imagePath(sessionId, itemId), { force: true })
      return next
    })
  }
  /** @param include - Sessions listed even while their canvas is still empty (a generation is running). */
  async list(include: string[] = []): Promise<CanvasEntry[]> {
    let names: string[]
    try { names = await readdir(this.root) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; names = [] }
    const wanted = new Set(include), all = [...new Set([...names, ...include])].filter(n => SESSION_ID.test(n))
    const entries = await Promise.all(all.map(async n => { try { const c = await this.get(n); return c.items.length || wanted.has(n) ? entryOf(c) : undefined } catch { return undefined } }))
    return entries.filter((e): e is CanvasEntry => !!e).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 200)
  }
}
