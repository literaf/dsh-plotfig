import { readFile, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { extname, isAbsolute } from 'node:path'
import type { ArkClient } from './ark.js'
import { MAX_BYTES } from './ark.js'
import type { CanvasStore } from './store.js'
import type { Canvas, CanvasItem, GenerateInput, PendingGeneration } from './shared/types.js'
import { ITEM_ID, titleFrom } from './shared/types.js'
import type { DecomposeInput } from './shared/layers.js'
const LOCAL_TYPES: Record<string, string> = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp', '.bmp': 'bmp', '.gif': 'gif', '.tif': 'tiff', '.tiff': 'tiff', '.heic': 'heic', '.heif': 'heif' }
const DATA_URL = /^data:image\/(png|jpeg|webp|bmp|tiff|gif|heic|heif);base64,[A-Za-z0-9+/=]+$/
export interface GenerateResult { canvas: Canvas; items: CanvasItem[] }
export class Seedream {
  private inflight = new Map<string, PendingGeneration[]>()
  constructor(readonly ark: ArkClient, readonly store: CanvasStore) {}
  pending(sessionId: string): PendingGeneration[] { return this.inflight.get(sessionId) ?? [] }
  /** Sessions with a generation running now, for the client to open their canvas. */
  active(): Record<string, PendingGeneration[]> { return Object.fromEntries(this.inflight) }
  /**
   * Resolve references into what Ark accepts. Canvas items are read from this
   * Session only; local paths are accepted only for tool calls made by the
   * conversation agent, never for browser requests.
   */
  async resolve(sessionId: string, refs: string[], allowLocal: boolean): Promise<{ images: string[]; items: string[]; external: number }> {
    const images: string[] = [], items: string[] = []
    let external = 0
    for (const ref of refs) {
      const item = /^item:(.+)$/.exec(ref)?.[1]?.trim()
      if (item !== undefined) {
        if (!ITEM_ID.test(item)) throw new Error(`无效的画布图片引用：${ref}`)
        const canvas = await this.store.get(sessionId)
        if (!canvas.items.some(i => i.id === item)) throw new Error(`当前对话的画布中没有图片 ${ref}。`)
        images.push(`data:image/png;base64,${(await this.store.readImage(sessionId, item)).toString('base64')}`); items.push(item)
      } else if (/^https:\/\//i.test(ref)) {
        try { new URL(ref) } catch { throw new Error(`无效的图片地址：${ref}`) }
        images.push(ref); external++
      } else if (ref.startsWith('data:')) {
        if (!DATA_URL.test(ref)) throw new Error('data URL 必须是 data:image/<小写格式>;base64,...')
        if (ref.length * 0.75 > MAX_BYTES) throw new Error('参考图不能超过 30 MB。')
        images.push(ref); external++
      } else if (allowLocal && isAbsolute(ref)) {
        const format = LOCAL_TYPES[extname(ref).toLowerCase()]
        if (!format) throw new Error(`不支持的图片格式：${ref}`)
        const info = await stat(ref)
        if (!info.isFile() || info.size > MAX_BYTES) throw new Error(`参考图必须是不超过 30 MB 的文件：${ref}`)
        images.push(`data:image/${format};base64,${(await readFile(ref)).toString('base64')}`); external++
      } else throw new Error(`无法识别的参考图：${ref}。请使用 item:<id>、https 链接${allowLocal ? '或本机绝对路径' : ''}。`)
    }
    return { images, items, external }
  }
  async generate(sessionId: string, input: GenerateInput, signal: AbortSignal, allowLocal = false): Promise<GenerateResult> {
    const refs = await this.resolve(sessionId, input.images, allowLocal)
    signal.throwIfAborted()
    const entry: PendingGeneration = { key: randomUUID(), prompt: input.prompt, size: input.size, startedAt: new Date().toISOString(), ...(refs.items[0] ? { parentId: refs.items[0] } : {}) }
    this.inflight.set(sessionId, [...this.pending(sessionId), entry])
    try {
      const result = await this.ark.generate({ prompt: input.prompt, images: refs.images, size: input.size, watermark: input.watermark }, signal)
      // Billed output is saved even if the caller stopped waiting meanwhile.
      return await this.store.add(sessionId, result.images, {
        title: input.title ?? titleFrom(input.prompt), prompt: input.prompt, refs: refs.items, externalRefs: refs.external, size: input.size,
      }, refs.items[0])
    } finally {
      const rest = this.pending(sessionId).filter(p => p.key !== entry.key)
      if (rest.length) this.inflight.set(sessionId, rest); else this.inflight.delete(sessionId)
    }
  }
  async decompose(sessionId: string, input: DecomposeInput, signal: AbortSignal) {
    const refs = await this.resolve(sessionId, [input.image], false), sourceId = refs.items[0]!
    const source = (await this.store.get(sessionId)).items.find(i => i.id === sourceId)!
    if (source.width * source.height < 262144 || source.width * source.height > 36000000) throw new Error('分层输入图片总像素须在 512×512 到 6000×6000 之间。')
    signal.throwIfAborted()
    const entry: PendingGeneration = { key: randomUUID(), prompt: `分图层 · ${source.title}`, size: `${source.width}x${source.height}`, parentId: sourceId, startedAt: new Date().toISOString() }
    this.inflight.set(sessionId, [...this.pending(sessionId), entry])
    try {
      // Once submitted, a split can be billed for many files. Closing the view must
      // not cancel their downloads or discard a result; the next poll retrieves it.
      const result = await this.ark.generate({ ...input, images: refs.images, decomposition: { maxImages: input.maxImages } }, new AbortController().signal)
      return await this.store.addDecomposition(sessionId, sourceId, result.images, result.warnings)
    } finally {
      const rest = this.pending(sessionId).filter(p => p.key !== entry.key)
      if (rest.length) this.inflight.set(sessionId, rest); else this.inflight.delete(sessionId)
    }
  }
}
