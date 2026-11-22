import { readFile, stat } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { extname, isAbsolute } from 'node:path'
import { imageInfo, MAX_BYTES } from './image-data.js'
import { AI4ScholarError } from './ai4scholar.js'
import type { AI4ScholarClient, ImageResult } from './ai4scholar.js'
import type { CanvasStore } from './store.js'
import type { Canvas, CanvasItem, GenerateInput, LayerQuote, PendingGeneration, SavedLayerTask } from './shared/types.js'
import { ITEM_ID, MAX_PROMPT, titleFrom } from './shared/types.js'
import { parseGenerationStyle, styledPrompt } from './shared/research.js'
import { MODEL } from './shared/models.js'
import type { DecomposeInput } from './shared/layers.js'
import { editDimensions, EXPAND_SIDES, expansionSteps, IMAGE_EDIT_LABELS } from './shared/image-edit.js'
import type { ExpandMargins, ImageEditInput } from './shared/image-edit.js'
import type { GeneratedImage } from './image-data.js'
import { decodePixels, finishImageEdit, prepareImageEdit } from './image-edit.js'
const LOCAL_TYPES: Record<string, string> = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp', '.bmp': 'bmp', '.gif': 'gif', '.tif': 'tiff', '.tiff': 'tiff', '.heic': 'heic', '.heif': 'heif' }
const DATA_URL = /^data:image\/(png|jpeg|webp|bmp|tiff|gif|heic|heif);base64,[A-Za-z0-9+/=]+$/
/** True when the PNG carries at least one non-opaque pixel; JPEG never does. */
function hasTransparency(image: GeneratedImage): boolean {
  if (image.mime !== 'image/png') return false
  try { return decodePixels(image.bytes).data.some((v, i) => i % 4 === 3 && v < 250) } catch { return false }
}
export interface GenerateResult { canvas: Canvas; items: CanvasItem[] }
export interface ImageEditResult extends GenerateResult { warnings: string[] }
export class Seedream {
  private inflight = new Map<string, PendingGeneration[]>()
  private editRequests = new Map<string, { fingerprint: string; promise: Promise<ImageEditResult>; settled: boolean }>()
  constructor(readonly client: AI4ScholarClient, readonly store: CanvasStore) {}
  async layerQuote(maxImages: number): Promise<LayerQuote> {
    if (!Number.isInteger(maxImages) || maxImages < 2 || maxImages > 100) throw new Error('分层张数须为 2–100。')
    return this.client.quote(maxImages)
  }
  pending(sessionId: string): PendingGeneration[] { return this.inflight.get(sessionId) ?? [] }
  /** Sessions with a generation running now, for the client to open their canvas. */
  active(): Record<string, PendingGeneration[]> { return Object.fromEntries(this.inflight) }
  async generationDefaults(sessionId: string, settings: { size: string; watermark: boolean }) {
    const canvas = await this.store.get(sessionId)
    return { ...settings, model: canvas.generationModel ?? MODEL }
  }
  /**
   * Resolve canvas items and references for the AI4Scholar API. Canvas items are read from this
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
        const data = await this.store.readImage(sessionId, item)
        images.push(`data:${imageInfo(data)?.mime ?? 'image/png'};base64,${data.toString('base64')}`); items.push(item)
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
    const model = input.model ?? MODEL
    const style = parseGenerationStyle(input.style ?? (await this.store.get(sessionId)).generationStyle ?? 'auto')
    const prompt = styledPrompt(input.prompt, style)
    if (prompt.length > MAX_PROMPT) throw new Error('提示词与风格要求合计超过 4000 个字符，请缩短描述或选择“跟随描述”。')
    const refs = await this.resolve(sessionId, input.images, allowLocal)
    signal.throwIfAborted()
    const entry: PendingGeneration = { key: randomUUID(), prompt: input.prompt, size: input.aspectRatio && input.aspectRatio !== 'auto' ? input.aspectRatio : input.size, startedAt: new Date().toISOString(), ...(refs.items[0] ? { parentId: refs.items[0] } : {}), ...(input.replaces ? { replaces: input.replaces } : {}) }
    this.inflight.set(sessionId, [...this.pending(sessionId), entry])
    try {
      const result = await this.client.generate({ model, ...(input.aspectRatio && { aspectRatio: input.aspectRatio }), prompt: input.transparent ? `${prompt}\n\n输出透明背景：只保留主体，主体之外完全透明，不画背景、地面、阴影或边框。` : prompt, images: refs.images, size: input.size, watermark: input.watermark, ...(input.transparent ? { background: 'transparent' as const } : input.opaque ? { background: 'opaque' as const } : {}) }, signal)
      const warnings = input.transparent && result.images.some(i => !hasTransparency(i)) ? ['模型未返回透明区域，已保存结果；请检查背景或改用“移除背景”。'] : []
      // Billed output is saved even if the caller stopped waiting meanwhile.
      return await this.store.add(sessionId, result.images, {
        title: input.title ?? titleFrom(input.prompt), prompt, model, refs: refs.items, externalRefs: refs.external, size: input.size,
        ...(input.aspectRatio && { aspectRatio: input.aspectRatio }), ...(style === 'auto' ? {} : { generationStyle: style }),
        ...(result.creditCost === undefined ? {} : { creditCost: result.creditCost }),
        ...(input.transparent ? { transparent: true } : {}), ...(warnings.length ? { warnings } : {}), sourcePrompt: input.prompt,
      }, refs.items[0], input.replaces)
    } finally {
      const rest = this.pending(sessionId).filter(p => p.key !== entry.key)
      if (rest.length) this.inflight.set(sessionId, rest); else this.inflight.delete(sessionId)
    }
  }
  async decompose(sessionId: string, input: DecomposeInput, signal: AbortSignal) {
    const refs = await this.resolve(sessionId, [input.image], false), sourceId = refs.items[0]!
    const canvas = await this.store.get(sessionId), source = canvas.items.find(i => i.id === sourceId)!
    const id = input.requestId ?? randomUUID()
    const fingerprint = createHash('sha256').update(JSON.stringify([sourceId,input.prompt,input.maxImages,input.size,input.watermark])).digest('hex')
    const previous = canvas.compositions?.find(c => c.layerTask?.id === id)
    if (previous) {
      if (previous.layerTask?.fingerprint !== fingerprint) throw new Error('分层任务编号已用于其他参数。')
      return { canvas, composition: previous, items: canvas.items.filter(item => item.role === 'layer' && previous.layers.some(layer => layer.assetId === item.id)) }
    }
    if (this.pending(sessionId).some(p => p.key === id)) throw new Error('该分层任务正在进行，请在画布查看进度。')
    const saved = canvas.layerTasks?.find(job => job.id === id)
    if (saved && saved.fingerprint !== fingerprint) throw new Error('分层任务编号已用于其他参数。')
    if (source.width * source.height < 262144 || source.width * source.height > 36000000) throw new Error('分层输入图片总像素须在 512×512 到 6000×6000 之间。')
    signal.throwIfAborted()
    const entry: PendingGeneration = { key: id, prompt: `分图层 · ${source.title}`, size: `${source.width}x${source.height}`, parentId: sourceId, startedAt: new Date().toISOString() }
    this.inflight.set(sessionId, [...this.pending(sessionId), entry])
    try {
      // A submitted task may already be billed even if its response was lost.
      if (saved) return await this.importTask(sessionId, saved)
      const quotedCredits = input.quotedCredits
      if (!quotedCredits) throw new Error('请先获取并确认本次拆分的积分报价。')
      const job = { id, sourceId, startedAt: entry.startedAt, fingerprint }
      await this.store.setLayerTask(sessionId, job)
      try {
        await this.client.submitLayers(id, {
          image: refs.images[0]!, prompt: input.prompt, size: input.size,
          watermark: input.watermark, maxImages: input.maxImages, quotedCredits,
        })
      } catch (error) {
        const rejected = error instanceof AI4ScholarError && (error.status < 500 || error.code === 'LAYER_PACKAGE_UNAVAILABLE')
        await this.store.setLayerTask(sessionId, { ...job, error: error instanceof Error ? error.message : '分层提交未确认' }, rejected)
        throw error
      }
      return await this.importTask(sessionId, job)
    } finally {
      const rest = this.pending(sessionId).filter(p => p.key !== entry.key)
      if (rest.length) this.inflight.set(sessionId, rest); else this.inflight.delete(sessionId)
    }
  }
  private async importTask(sessionId: string, job: SavedLayerTask) {
    try {
      const result = await this.client.waitForLayers(job.id)
      return await this.store.addDecomposition(sessionId, job.sourceId, result.images, result.warnings, job.id, result.billing)
    } catch (error) {
      const failed = error instanceof AI4ScholarError && error.code === 'LAYER_TASK_FAILED'
      await this.store.setLayerTask(sessionId, { ...job, error: error instanceof Error ? error.message : '分层结果获取失败' }, failed)
      throw error
    }
  }
  /** Reopen only polls existing paid jobs, including after a host restart. */
  resumeLayerTasks(canvas: Canvas, retryId: string | null = null) {
    const sid = canvas.sessionId
    for (const job of canvas.layerTasks ?? []) {
      if ((job.error && job.id !== retryId) || this.pending(sid).some(p => p.key === job.id)) continue
      this.inflight.set(sid, [...this.pending(sid), { key: job.id, parentId: job.sourceId, prompt: '取回分层结果', size: 'auto', startedAt: job.startedAt }])
      void this.importTask(sid, job).catch(() => {}).finally(() => {
        const rest = this.pending(sid).filter(p => p.key !== job.id)
        if (rest.length) this.inflight.set(sid, rest); else this.inflight.delete(sid)
      })
    }
  }
  /** A duplicate request id reuses its original result; it never starts another billable call. */
  async editImage(sessionId: string, input: ImageEditInput, signal: AbortSignal): Promise<ImageEditResult> {
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex'), key = `${sessionId}:${input.requestId}`
    const known = this.editRequests.get(key)
    if (known) {
      if (known.fingerprint !== fingerprint) throw new Error('同一编辑请求标识不能用于不同参数。')
      return known.promise
    }
    signal.throwIfAborted()
    const request = { fingerprint, promise: this.performEdit(sessionId, input, fingerprint, signal), settled: false }
    this.editRequests.set(key, request)
    void request.promise.finally(() => {
      request.settled = true
      for (const [id, old] of this.editRequests) { if (this.editRequests.size <= 100) break; if (old.settled) this.editRequests.delete(id) }
    }).catch(() => {})
    return request.promise
  }
  private async performEdit(sessionId: string, input: ImageEditInput, fingerprint: string, signal: AbortSignal): Promise<ImageEditResult> {
    const canvas = await this.store.get(sessionId), previous = canvas.items.filter(i => i.edit?.requestId === input.requestId)
    if (previous.length) {
      if (previous.some(i => i.edit?.fingerprint !== fingerprint)) throw new Error('同一编辑请求标识不能用于不同参数。')
      return { canvas, items: previous, warnings: [...new Set(previous.flatMap(i => i.warnings ?? []))] }
    }
    const sourceId = input.image.slice(5), source = canvas.items.find(i => i.id === sourceId)
    if (!source) throw new Error('当前对话的画布中没有这张图片。')
    const bytes = await this.store.readImage(sessionId, sourceId)
    // Multi-sided expansion chains single-sided passes; each pass extends the previous output.
    const steps = input.expand ? expansionSteps(input.expand).map(expand => ({ ...input, expand })) : [input]
    if (steps.length > 1) editDimensions(source.width, source.height, input.expand)
    const first = prepareImageEdit(steps[0]!, bytes), size = steps.length > 1 ? `${source.width + input.expand!.left + input.expand!.right}x${source.height + input.expand!.top + input.expand!.bottom}` : `${first.width}x${first.height}`
    signal.throwIfAborted()
    const title = `${IMAGE_EDIT_LABELS[input.operation]} · ${source.title}`, entry: PendingGeneration = {
      key: input.requestId, prompt: steps.length > 1 ? `${title}（${steps.length} 步）` : title, size, parentId: sourceId, startedAt: new Date().toISOString(),
    }
    this.inflight.set(sessionId, [...this.pending(sessionId), entry])
    try {
      const warnings: string[] = [], done: ExpandMargins = { left: 0, top: 0, right: 0, bottom: 0 }
      let applied = true, prepared = first, images: GeneratedImage[] = []
      for (const [index, step] of steps.entries()) {
        if (index) {
          try { prepared = prepareImageEdit(step, images[0]!.bytes) }
          catch (error) { warnings.push(`扩图在第 ${index + 1}/${steps.length} 步前停止：${error instanceof Error ? error.message : '图片处理失败'}。已保存前 ${index} 步的结果。`); break }
        }
        let result: ImageResult
        // After submission, closing a view or cancelling its wait cannot lose a billed output.
        try { result = await this.client.generate(prepared.request, new AbortController().signal) }
        catch (error) {
          if (!index) throw error
          warnings.push(`扩图第 ${index + 1}/${steps.length} 步失败：${error instanceof Error ? error.message : '生成失败'}。已保存前 ${index} 步的结果，未自动重试。`); break
        }
        warnings.push(...result.warnings ?? [])
        let failed = false
        const processed = result.images.map(image => {
          try { const out = finishImageEdit(prepared, image); warnings.push(...out.warnings.map(w => steps.length > 1 ? `第 ${index + 1} 步：${w}` : w)); return out.image }
          catch (error) {
            failed = true
            warnings.push(`${steps.length > 1 ? `第 ${index + 1} 步` : ''}本地合成失败，已保留模型原始结果，可能包含选区外的改动：${error instanceof Error ? error.message : '图片处理失败'}`)
            return image
          }
        })
        if (failed && index) {
          // Keep the completed passes as the result and the billed raw output beside it.
          warnings.push(`已保存前 ${index} 步的结果；第 ${index + 1} 步的模型原始结果另存为第二张。`)
          images = [...images, ...processed]; break
        }
        images = processed
        if (failed) { applied = false; break }
        if (step.expand) for (const side of EXPAND_SIDES) done[side] += step.expand[side]
      }
      const partial = steps.length > 1 && Object.values(done).reduce((a, b) => a + b, 0) < Object.values(input.expand!).reduce((a, b) => a + b, 0)
      const saved = await this.store.add(sessionId, images, {
        title: !applied ? `${title} · 原始结果` : partial ? `${title} · 部分完成` : title, prompt: prepared.request.prompt, refs: [sourceId], externalRefs: 0, size: prepared.request.size,
        edit: { operation: input.operation, sourceId, requestId: input.requestId, fingerprint, applied: applied && !partial, ...(warnings.length ? { needsReview: true } : {}), ...(input.expand ? { expand: applied ? done : input.expand } : {}) },
        ...(warnings.length ? { warnings } : {}),
      }, sourceId)
      return { ...saved, warnings }
    } finally {
      const rest = this.pending(sessionId).filter(p => p.key !== entry.key)
      if (rest.length) this.inflight.set(sessionId, rest); else this.inflight.delete(sessionId)
    }
  }
}
