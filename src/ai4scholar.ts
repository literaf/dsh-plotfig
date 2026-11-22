import { setTimeout as delay } from 'node:timers/promises'
import { imageSize } from 'image-size'
import { imageInfo, MAX_BYTES } from './image-data.js'
import type { GeneratedImage } from './image-data.js'
import { parseOCR } from './shared/ocr.js'
import { isAI4ScholarKey, isRecord, MODEL } from './shared/types.js'
import type { LayerBilling, LayerMetadata, LayerPricing, LayerQuote } from './shared/types.js'
import { DRAWING_MODELS } from './shared/models.js'
import type { DrawingModel, DrawingRatio } from './shared/models.js'

const origin = 'https://ai4scholar.net'
const layersPath = '/api/proxy/nano/layers'
interface ClientOptions {
  apiKey(): Promise<string | undefined>
  timeoutMs: number
  userAgent: string
  fetch?: typeof fetch
}
export interface ImageRequest {
  prompt: string
  model?: DrawingModel
  aspectRatio?: DrawingRatio
  images: string[]
  size: string
  watermark: boolean
  background?: 'auto' | 'transparent' | 'opaque'
}
export interface ImageResult { images: GeneratedImage[]; warnings?: string[]; creditCost?: number; billing?: LayerBilling }
export class AI4ScholarError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
    this.name = 'AI4ScholarError'
  }
}

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function layerPricing(value: unknown): LayerPricing | undefined {
  if (value == null) return undefined // Fixed-price gateway.
  if (!isRecord(value) || value.mode !== 'per_output_v1' || !nonnegative(value.inputCredits) ||
      !nonnegative(value.standardCredits) || !nonnegative(value.largeCredits) ||
      !nonnegative(value.standardMaxPixels) || value.standardMaxPixels === 0)
    throw new Error('无法读取分层计价规则，请刷新报价。')
  return { mode: value.mode, inputCredits: value.inputCredits, standardCredits: value.standardCredits,
    largeCredits: value.largeCredits, standardMaxPixels: value.standardMaxPixels }
}

function layerBilling(value: unknown): LayerBilling | undefined {
  if (!isRecord(value)) return undefined
  const { reservedCredits, chargedCredits, refundedCredits, standardOutputs, largeOutputs } = value
  if (!nonnegative(reservedCredits) || !nonnegative(chargedCredits) || !nonnegative(refundedCredits) ||
      !nonnegative(standardOutputs) || !Number.isSafeInteger(standardOutputs) ||
      !nonnegative(largeOutputs) || !Number.isSafeInteger(largeOutputs) ||
      Math.abs(reservedCredits - chargedCredits - refundedCredits) > 0.0000001) return undefined
  return { reservedCredits, chargedCredits, refundedCredits, standardOutputs, largeOutputs }
}

const MAX_RESULT_BYTES = 64 * 1024 * 1024 // AI4Scholar’s per-image download limit, including 4K outputs.
async function readLimited(response: Response, signal: AbortSignal, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > maxBytes) throw new AI4ScholarError(`生成结果超过 ${maxBytes / 1024 / 1024} MB，已放弃下载。`, 502)
  if (!response.body) return new Uint8Array(await response.arrayBuffer())
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    signal.throwIfAborted()
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) { await reader.cancel(); throw new AI4ScholarError(`生成结果超过 ${maxBytes / 1024 / 1024} MB，已放弃下载。`, 502) }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength }
  return out
}

/** Every authenticated request stays on the application origin. Asset downloads carry no key. */
export class AI4ScholarClient {
  constructor(private readonly options: ClientOptions) {}
  private get fetch() { return this.options.fetch ?? fetch }

  private async request(path: string, signal: AbortSignal, body?: unknown) {
    const key = await this.options.apiKey()
    if (!key) throw new AI4ScholarError('请在 PlotFig 设置中保存 AI4Scholar API Key。', 401, 'MISSING_API_KEY')
    if (!isAI4ScholarKey(key)) throw new AI4ScholarError('请使用以 sk-user- 开头的 AI4Scholar API Key。', 401, 'INVALID_KEY')
    signal.throwIfAborted()
    const response = await this.fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${key}`, 'User-Agent': this.options.userAgent, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok || !isRecord(data) || data.success === false) {
      const code = isRecord(data) && typeof data.error === 'string' ? data.error : undefined
      const message = isRecord(data) && typeof data.message === 'string' ? data.message : code ?? `HTTP ${response.status}`
      throw new AI4ScholarError(`AI4Scholar：${message}`, response.status, code)
    }
    return data
  }

  async quote(maxImages: number, signal = AbortSignal.timeout(15000)): Promise<LayerQuote & { generationConfigured: boolean }> {
    const data = await this.request(`${layersPath}?maxImages=${maxImages}`, signal)
    if (data.version !== 1 || data.model !== MODEL || data.maxImages !== maxImages ||
       typeof data.enabled !== 'boolean' || typeof data.supportedMaxImages !== 'number' ||
       (data.enabled && (typeof data.creditCost !== 'number' || !Number.isSafeInteger(data.creditCost) || data.creditCost <= 0)))
      throw new Error('AI4Scholar 尚未提供 PlotFig 所需的绘图接口。')
    const pricing = layerPricing(data.pricing)
    return { enabled: data.enabled, maxImages, supportedMaxImages: data.supportedMaxImages,
      ...(pricing && { pricing }), creditCost: typeof data.creditCost === 'number' ? data.creditCost : null, generationConfigured: data.generationConfigured === true }
  }

  async check(signal: AbortSignal) {
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(15000)])
    const balance = await this.request('/api/credits', timeout)
    const capability = await this.quote(2, timeout)
    const available = isRecord(balance.credits) ? balance.credits.total_available : undefined
    return { ok: true, modelAvailable: capability.generationConfigured,
      message: `AI4Scholar Key 有效${typeof available === 'number' ? `，可用余额 ${available} 积分` : ''}。${capability.generationConfigured ? 'Seedream 5.5 已配置。' : 'Seedream 5.5 尚未配置。'}` }
  }

  private async download(value: unknown, maxBytes = MAX_BYTES): Promise<GeneratedImage> {
    if (typeof value !== 'string') throw new Error('缺少图片地址。')
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('图片地址无效。')
    const signal = AbortSignal.timeout(60000)
    const response = await this.fetch(url, { redirect: 'error', signal })
    if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）。`)
    const bytes = await readLimited(response, signal, maxBytes), info = imageInfo(bytes)
    if (info?.mime === 'image/png') return { bytes, ...info }
    const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const webp = source.toString('ascii', 0, 4) === 'RIFF' && source.toString('ascii', 8, 12) === 'WEBP'
    if (info?.mime !== 'image/jpeg' && !webp) throw new Error('返回的图片须为 PNG、JPEG 或 WebP。')
    // Stored assets, references and the layer editor share a PNG representation.
    const { width, height } = info ?? imageSize(source)
    if (width < 1 || height < 1 || width * height > 40_000_000) throw new Error('生成结果尺寸无效或超过 4000 万像素。')
    const { Transformer } = await import('@napi-rs/image')
    const png = await new Transformer(source).png()
    return { bytes: png, width, height, mime: 'image/png' }
  }

  async generate(input: ImageRequest, signal: AbortSignal): Promise<ImageResult> {
    if ('decomposition' in input) throw new Error('分层请通过分层任务提交。')
    const model = input.model ?? MODEL
    if (model === MODEL) {
      // Older gateways ignored Seedream's native options. Check its capability before submission.
      const capability = await this.quote(2, AbortSignal.any([signal, AbortSignal.timeout(15000)]))
      if (!capability.generationConfigured) throw new Error('AI4Scholar 的 Seedream 渠道尚未配置。')
    }
    signal.throwIfAborted()
    // The Gemini edit action reads one reference. Its generate action includes every supplied image.
    const multiReferenceGemini = DRAWING_MODELS[model].family === 'gemini' && input.images.length > 1
    const data = await this.request('/api/proxy/nano/generate', AbortSignal.timeout(this.options.timeoutMs), {
      model, action: input.images.length && !multiReferenceGemini ? 'edit' : 'generate', prompt: input.prompt, images: input.images,
      ...(model === MODEL ? { size: input.size, watermark: input.watermark, background: input.background }
        : { imageSize: input.size, aspectRatio: input.aspectRatio ?? 'auto' }),
    })
    return { images: [await this.download(data.imageUrl, MAX_RESULT_BYTES)], ...(typeof data.creditCost === 'number' ? { creditCost: data.creditCost } : {}) }
  }

  async submitLayers(id: string, input: { image: string; prompt: string; size: string; watermark: boolean; maxImages: number; quotedCredits: number }) {
    const data = await this.request(layersPath, AbortSignal.timeout(75000), { requestId: id, ...input })
    if (data.taskId !== id) throw new Error(`分层提交未获确认，任务编号 ${id}。`)
  }

  async waitForLayers(id: string): Promise<ImageResult> {
    const deadline = Date.now() + 600000
    for (;;) {
      const data = await this.request(`${layersPath}?taskId=${id}`, AbortSignal.timeout(30000))
      if (data.taskId !== id) throw new Error('分层任务编号不匹配。')
      if (data.status === 'failed') throw new AI4ScholarError(typeof data.message === 'string' ? data.message : '分层任务失败。', 422, 'LAYER_TASK_FAILED')
      if (data.status === 'completed') {
        const result = await this.importLayers(data.result)
        const billing = layerBilling(data.billing)
        return { ...result, ...(billing && { billing }) }
      }
      if (data.status !== 'pending' && data.status !== 'processing') throw new Error('无法识别分层任务状态。')
      if (Date.now() >= deadline) throw new Error('分层仍在进行，稍后可从此画布继续获取。')
      await delay(2500)
    }
  }

  private async importLayers(result: unknown): Promise<ImageResult> {
    if (!isRecord(result) || result.version !== 1 || !Array.isArray(result.layers) || !result.layers.length || result.layers.length > 101)
      throw new Error('分层结果格式无效。')
    const images: GeneratedImage[] = [], warnings = Array.isArray(result.warnings) ? result.warnings.filter((v): v is string => typeof v === 'string') : []
    for (const layer of result.layers) {
      if (!isRecord(layer) || layer.id === 'source') continue // CanvasStore already has the original fallback.
      try {
        const { x, y, width, height, zIndex } = layer
        if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number' ||
            ![x,y,width,height].every(Number.isFinite) || width <= 0 || height <= 0 || typeof zIndex !== 'number' || !Number.isInteger(zIndex))
          throw new Error('图层坐标无效。')
        const metadata: LayerMetadata = { zIndex, bounds: [x,y,x+width,y+height], ...(typeof layer.name === 'string' ? { name: layer.name } : {}) }
        if (isRecord(layer.ocr)) {
          // Validate normalized OCR now; the store assigns the final local asset id on import.
          const placeholder = '000000000000'
          try {
            const { sourceAssetId: _id, ...ocr } = parseOCR({ ...layer.ocr, sourceAssetId: placeholder }, new Set([placeholder]))
            metadata.ocr = ocr
          } catch { warnings.push(`${metadata.name ?? '图层'}的文字数据无效，已保留图片。`) }
        }
        images.push({ ...await this.download(layer.url), layer: metadata })
      } catch (error) {
        warnings.push(`${typeof layer.name === 'string' ? layer.name : '图层'}未能导入：${error instanceof Error ? error.message : '下载失败'}`)
      }
    }
    if (!images.length) throw new Error('没有可导入的图层，可重新获取已付费结果。')
    return { images, warnings }
  }
}
