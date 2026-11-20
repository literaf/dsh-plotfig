import type { Context } from '@deepseek-ai/cordis'
import type { Seedream } from './service.js'
import { checkItem, checkSession, EditConflict } from './store.js'
import { AI4ScholarError } from './ai4scholar.js'
import { imageInfo, MAX_BYTES } from './image-data.js'
import { entryOf, isRecord, parseGenerate, parseSize, ROUTE } from './shared/types.js'
import type { Status } from './shared/types.js'
import type { Preferences } from './preferences.js'
import { parseCompositionEdit, parseDecompose } from './shared/layers.js'
import { diagramSvg } from './shared/diagram-svg.js'
import { MAX_MASK_BYTES, parseImageEdit } from './shared/image-edit.js'
import { decodePixels, encodePixels } from './pixels.js'

interface Route { path: string; methods: readonly string[]; requestBody: 'buffered'; fetch(request: Request): Promise<Response> }
interface Connection { fetch?: { register(route: Route): () => Promise<void> } }
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
export const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...HEADERS } })
const fail = (error: unknown, fallback: string, status = 400) => json({ ok: false, error: error instanceof Error ? error.message : fallback }, error instanceof EditConflict ? 409 : error instanceof AI4ScholarError ? 502 : status)
async function body(request: Request, limit: number): Promise<unknown> {
  const text = await request.text()
  if (text.length > limit) throw new Error('请求内容过长。')
  return JSON.parse(text)
}
const session = (url: URL) => checkSession(url.searchParams.get('session') ?? '')
export function createHandlers(service: Seedream, prefs: Preferences, status: () => Promise<Status>) {
  return {
    async catalog(): Promise<Response> {
      try { const active = service.active(); return json({ ok: true, value: { ...await status(), canvases: await service.store.list(Object.keys(active)), active } }) }
      catch (error) { return fail(error, '读取画布失败。', 500) }
    },
    active(): Response { return json({ ok: true, value: { active: service.active() } }) },
    async canvas(request: Request): Promise<Response> {
      try {
        const url = new URL(request.url), id = session(url)
        if (request.method === 'PATCH') {
          const raw = await body(request, 256 * 1024)
          if (isRecord(raw) && typeof raw.dismissLayerTask === 'string') {
            const task = (await service.store.get(id)).layerTasks?.find(job => job.id === raw.dismissLayerTask)
            if (!task?.error || service.pending(id).some(job => job.key === task.id)) throw new Error('只能移除已停止取回的任务记录。')
            return json({ ok: true, value: await service.store.setLayerTask(id, task, true) })
          }
          if (isRecord(raw) && raw.generationStyle !== undefined && raw.positions === undefined) return json({ ok: true, value: await service.store.setGenerationStyle(id, raw.generationStyle) })
          if (isRecord(raw) && typeof raw.showVersion === 'string' && raw.positions === undefined) return json({ ok: true, value: await service.store.showVersion(id, raw.showVersion) })
          if (!isRecord(raw) || !Array.isArray(raw.positions)) throw new Error('无效的布局数据。')
          const positions = raw.positions.filter(isRecord).map(p => ({ id: String(p.id), x: Number(p.x), y: Number(p.y) }))
          return json({ ok: true, value: await service.store.move(id, positions) })
        }
        const canvas = await service.store.get(id)
        service.resumeLayerTasks(canvas, url.searchParams.get('resumeLayer'))
        return json({ ok: true, value: { ...canvas, pending: service.pending(id) } })
      } catch (error) { return fail(error, '读取画布失败。') }
    },
    async generate(request: Request): Promise<Response> {
      let id: string, input
      try {
        id = session(new URL(request.url))
        input = parseGenerate(await body(request, 64 * 1024), await prefs.get())
      } catch (error) { return fail(error, '无效的生成参数。') }
      try {
        // Browser requests may reference canvas items and https URLs only.
        const result = await service.generate(id, input, request.signal, false)
        return json({ ok: true, value: { canvas: result.canvas, created: result.items.map(i => i.id) } })
      } catch (error) { return fail(error, 'Seedream 生成失败。', 400) }
    },
    async image(request: Request): Promise<Response> {
      try {
        const url = new URL(request.url), id = session(url), item = checkItem(url.searchParams.get('id') ?? '')
        if (url.searchParams.get('diagram') === '1') {
          const canvas = await service.store.get(id), composition = canvas.compositions?.find(c => c.id === item)
          if (!composition) throw new Error('画板不存在。')
          const svg = diagramSvg(parseCompositionEdit(composition, new Set(canvas.items.map(i => i.id))))
          return new Response(svg, { headers: { ...HEADERS, 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'private, no-cache', 'Content-Security-Policy': "default-src 'none'; sandbox" } })
        }
        const data = await service.store.readImage(id, item)
        return new Response(new Uint8Array(data), { headers: { 'Content-Type': 'image/png', ...HEADERS, 'Cache-Control': 'private, max-age=31536000, immutable',
          'Content-Disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename="seedream-${item}.png"`, 'Content-Security-Policy': "default-src 'none'; sandbox" } })
      } catch { return json({ ok: false, error: '图片不存在。' }, 404) }
    },
    async composition(request: Request): Promise<Response> {
      try {
        const url = new URL(request.url), sid = session(url)
        if (request.method === 'DELETE') return json({ ok: true, value: { canvas: await service.store.removeComposition(sid, checkItem(url.searchParams.get('id') ?? '')) } })
        const raw = await body(request, 2 * 1024 * 1024)
        if (!isRecord(raw)) throw new Error('无效的画板数据。')
        if (request.method === 'POST') {
          if (typeof raw.templateId === 'string') return json({ ok: true, value: await service.store.createTemplate(sid, raw.templateId, String(raw.palette ?? 'ocean')) })
          const sourceId = raw.sourceId === '' && raw.composition !== undefined ? '' : checkItem(String(raw.sourceId ?? ''))
          return json({ ok: true, value: await service.store.createComposition(sid, sourceId, raw.composition) })
        }
        return json({ ok: true, value: await service.store.editComposition(sid, checkItem(String(raw.id ?? '')), raw.version, raw.composition) })
      } catch (error) { return fail(error, '保存画板失败。') }
    },
    async decompose(request: Request): Promise<Response> {
      try {
        const sid = session(new URL(request.url)), input = parseDecompose(await body(request, 32 * 1024), (await prefs.get()).watermark)
        const result = await service.decompose(sid, input, request.signal)
        return json({ ok: true, value: { canvas: result.canvas, composition: result.composition } })
      } catch (error) { return fail(error, '分层失败。') }
    },
    async layerQuote(request: Request): Promise<Response> {
      try { return json({ ok: true, value: await service.layerQuote(Number(new URL(request.url).searchParams.get('maxImages'))) }) }
      catch (error) { return fail(error, '分层报价暂不可用。') }
    },
    async editImage(request: Request): Promise<Response> {
      try {
        const sid = session(new URL(request.url)), input = parseImageEdit(await body(request, Math.ceil(MAX_MASK_BYTES * 4 / 3) + 64 * 1024), (await prefs.get()).watermark)
        const result = await service.editImage(sid, input, request.signal)
        return json({ ok: true, value: result })
      } catch (error) { return fail(error, '图片编辑失败。') }
    },
    /** Explicit file uploads, no API charge and no arbitrary local paths or remote reads. */
    async importImage(request: Request): Promise<Response> {
      try {
        const sid = session(new URL(request.url)), raw = await body(request, Math.ceil(MAX_BYTES * 4 / 3) + 4096)
        if (!isRecord(raw) || typeof raw.image !== 'string') throw new Error('请选择 PNG 或 JPEG 图片。')
        const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw.image)
        if (!match) throw new Error('请选择 PNG 或 JPEG 图片。')
        const original = Buffer.from(match[2]!, 'base64')
        if (!original.length || original.length > MAX_BYTES) throw new Error('导入图片不能超过 30 MB。')
        const info = imageInfo(original)
        if (!info || info.mime !== `image/${match[1]}`) throw new Error('图片格式与内容不一致。')
        const pixels = decodePixels(original)
        const bytes = info.mime === 'image/png' ? original : encodePixels(pixels)
        if (bytes.length > MAX_BYTES) throw new Error('转换后的 PNG 超过 30 MB，请缩小图片后导入。')
        const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 80) : '导入图片'
        const result = await service.store.add(sid, [{ bytes, width: pixels.width, height: pixels.height }], { title, prompt: '本地导入图片', refs: [], externalRefs: 0, size: `${pixels.width}x${pixels.height}`, imported: true })
        return json({ ok: true, value: { canvas: result.canvas, item: result.items[0] } })
      } catch (error) { return fail(error, '导入图片失败。') }
    },
    /** Browser-created PNG composites; no filesystem path or remote URL is accepted. */
    async composite(request: Request): Promise<Response> {
      try {
        const sid = session(new URL(request.url)), raw = await body(request, Math.ceil(MAX_BYTES * 4 / 3) + 16384)
        if (!isRecord(raw) || typeof raw.png !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(raw.png)) throw new Error('请提交 PNG 图片。')
        const bytes = Buffer.from(raw.png.slice('data:image/png;base64,'.length), 'base64'), info = imageInfo(bytes)
        if (!info || info.mime !== 'image/png' || bytes.length > MAX_BYTES || info.width * info.height > 32_000_000) throw new Error('合成图片无效或过大（最多 3200 万像素、30 MB）。')
        const title = typeof raw.title === 'string' ? raw.title.slice(0, 80) : '合并图层'
        const result = await service.store.add(sid, [{ bytes, ...info }], { title, prompt: '本地合成图层', refs: [], externalRefs: 0, size: `${info.width}x${info.height}`, ...(raw.asLayer === true ? { role: 'layer' as const } : {}) })
        return json({ ok: true, value: { canvas: result.canvas, item: result.items[0] } })
      } catch (error) { return fail(error, '保存合成图失败。') }
    },
    async removeItem(request: Request): Promise<Response> {
      try {
        const url = new URL(request.url)
        if (service.pending(session(url)).some(p => p.parentId === url.searchParams.get('id'))) throw new Error('这张图正在用于生成或分层，请等待结果保存后再删除。')
        const canvas = await service.store.remove(session(url), checkItem(url.searchParams.get('id') ?? ''))
        return json({ ok: true, value: { canvas, entry: entryOf(canvas) } })
      } catch (error) { return fail(error, '删除失败。', 404) }
    },
    async check(): Promise<Response> {
      try { return json({ ok: true, value: await service.client.check(new AbortController().signal) }) }
      catch (error) { return fail(error, '连接测试失败。') }
    },
    async settings(request: Request): Promise<Response> {
      try {
        const raw = await body(request, 4096)
        if (!isRecord(raw)) throw new Error('无效的设置。')
        const patch: { size?: string; watermark?: boolean } = {}
        if (raw.size !== undefined) patch.size = parseSize(raw.size, '2K')
        if (raw.watermark !== undefined) { if (typeof raw.watermark !== 'boolean') throw new Error('watermark 必须是布尔值。'); patch.watermark = raw.watermark }
        await prefs.set(patch)
        return json({ ok: true, value: await status() })
      } catch (error) { return fail(error, '保存设置失败。') }
    },
  }
}
/** Uses the same authenticated, owner-only fetch registry as native settings. */
export function applyRoutes(ctx: Context, service: Seedream, prefs: Preferences, status: () => Promise<Status>): void {
  const h = createHandlers(service, prefs, status)
  ctx.inject(['connection'], child => {
    const bridge = (child.get('connection') as Connection | undefined)?.fetch
    if (!bridge?.register) return
    bridge.register({ path: ROUTE, methods: ['GET'], requestBody: 'buffered', fetch: () => h.catalog() })
    bridge.register({ path: `${ROUTE}/active`, methods: ['GET'], requestBody: 'buffered', fetch: async () => h.active() })
    bridge.register({ path: `${ROUTE}/canvas`, methods: ['GET', 'PATCH'], requestBody: 'buffered', fetch: r => h.canvas(r) })
    bridge.register({ path: `${ROUTE}/generate`, methods: ['POST'], requestBody: 'buffered', fetch: r => h.generate(r) })
    bridge.register({ path: `${ROUTE}/composition`, methods: ['POST', 'PATCH', 'DELETE'], requestBody: 'buffered', fetch: r => h.composition(r) })
    bridge.register({ path: `${ROUTE}/decompose`, methods: ['POST'], requestBody: 'buffered', fetch: r => h.decompose(r) })
    bridge.register({ path: `${ROUTE}/layer-quote`, methods: ['GET'], requestBody: 'buffered', fetch: r => h.layerQuote(r) })
    bridge.register({ path: `${ROUTE}/edit-image`, methods: ['POST'], requestBody: 'buffered', fetch: r => h.editImage(r) })
    bridge.register({ path: `${ROUTE}/import-image`, methods: ['POST'], requestBody: 'buffered', fetch: r => h.importImage(r) })
    bridge.register({ path: `${ROUTE}/composite`, methods: ['POST'], requestBody: 'buffered', fetch: r => h.composite(r) })
    bridge.register({ path: `${ROUTE}/image`, methods: ['GET'], requestBody: 'buffered', fetch: r => h.image(r) })
    bridge.register({ path: `${ROUTE}/item`, methods: ['DELETE'], requestBody: 'buffered', fetch: r => h.removeItem(r) })
    bridge.register({ path: `${ROUTE}/settings`, methods: ['POST'], requestBody: 'buffered', fetch: r => h.settings(r) })
    bridge.register({ path: `${ROUTE}/check`, methods: ['POST'], requestBody: 'buffered', fetch: () => h.check() })
  })
}
