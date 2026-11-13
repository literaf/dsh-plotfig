import { isRecord, MODEL } from './shared/types.js'

export const ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/images/generations'
export const MAX_BYTES = 30 * 1024 * 1024
export interface ArkOptions {
  apiKey(): Promise<string>
  timeoutMs: number
  userAgent: string
  endpoint?: string
  fetch?: typeof fetch
}
export interface ArkRequest {
  prompt: string
  /** Already resolved to https URLs or `data:image/<format>;base64,` strings. */
  images: string[]
  size: string
  watermark: boolean
}
export interface ArkImage { bytes: Uint8Array; width: number; height: number; mime: 'image/png' | 'image/jpeg' }
export interface ArkResult { images: ArkImage[]; generated?: number }
/** Upstream failure with Ark's own code kept for the user; never retried here. */
export class ArkError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = 'ArkError' }
}
/** Width and height from a PNG or baseline/progressive JPEG header. */
export function imageInfo(bytes: Uint8Array): { width: number; height: number; mime: ArkImage['mime'] } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length > 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(12) === 0x49484452)
    return { width: view.getUint32(16), height: view.getUint32(20), mime: 'image/png' }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return undefined
      const marker = bytes[i + 1]!, length = view.getUint16(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { width: view.getUint16(i + 7), height: view.getUint16(i + 5), mime: 'image/jpeg' }
      i += 2 + length
    }
  }
  return undefined
}
const message = (body: unknown, status: number): ArkError => {
  const error = isRecord(body) && isRecord(body.error) ? body.error : undefined
  const code = typeof error?.code === 'string' ? error.code : undefined
  const text = typeof error?.message === 'string' ? error.message : `HTTP ${status}`
  const hint = status === 401 ? '（请检查方舟 API Key）' : status === 429 ? '（已达到每分钟出图上限，请稍后再试）' : ''
  return new ArkError(`Seedream 生成失败${code ? ` [${code}]` : ''}：${text}${hint}`, status, code)
}
async function readLimited(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES) throw new ArkError('生成结果超过 30 MB，已放弃下载。', 502)
  if (!response.body) return new Uint8Array(await response.arrayBuffer())
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    signal.throwIfAborted()
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BYTES) { await reader.cancel(); throw new ArkError('生成结果超过 30 MB，已放弃下载。', 502) }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength }
  return out
}
export class ArkClient {
  constructor(private readonly options: ArkOptions) {}
  private get fetch(): typeof fetch { return this.options.fetch ?? fetch }
  async generate(input: ArkRequest, signal: AbortSignal): Promise<ArkResult> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs), combined = AbortSignal.any([signal, timeout])
    const body = {
      model: MODEL, prompt: input.prompt, size: input.size, watermark: input.watermark,
      response_format: 'url', output_format: 'png',
      ...(input.images.length === 1 ? { image: input.images[0] } : input.images.length ? { image: input.images } : {}),
    }
    const key = await this.options.apiKey()
    combined.throwIfAborted()
    let response: Response
    try {
      response = await this.fetch(this.options.endpoint ?? ENDPOINT, {
        method: 'POST', signal: combined, redirect: 'error',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': this.options.userAgent },
        body: JSON.stringify(body),
      })
    } catch (error) {
      if (timeout.aborted && !signal.aborted) throw new ArkError('Seedream 请求超时；请求可能已在服务端完成并计费。', 504)
      throw error
    }
    const json: unknown = await response.json().catch(() => undefined)
    if (!response.ok || (isRecord(json) && isRecord(json.error))) throw message(json, response.status)
    if (!isRecord(json) || !Array.isArray(json.data)) throw new ArkError('Seedream 返回了无法识别的结果。', 502)
    const images: ArkImage[] = []
    for (const item of json.data) {
      if (isRecord(item) && isRecord(item.error)) throw message(item, 502)
      const url = isRecord(item) && typeof item.url === 'string' ? item.url : undefined
      if (!url || !url.startsWith('https://')) throw new ArkError('Seedream 返回了无效的图片地址。', 502)
      // Result URLs expire after 24 hours, so the bytes are kept immediately.
      const download = await this.fetch(url, { signal: combined })
      if (!download.ok) throw new ArkError(`生成结果下载失败（HTTP ${download.status}）。`, 502)
      const bytes = await readLimited(download, combined), info = imageInfo(bytes)
      if (!info) throw new ArkError('生成结果不是有效的 PNG/JPEG 图片。', 502)
      images.push({ bytes, ...info })
    }
    if (!images.length) throw new ArkError('Seedream 没有返回图片。', 502)
    const usage = isRecord(json.usage) && typeof json.usage.generated_images === 'number' ? json.usage.generated_images : undefined
    return { images, ...(usage === undefined ? {} : { generated: usage }) }
  }
}
