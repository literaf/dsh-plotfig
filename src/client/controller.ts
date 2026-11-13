import { ROUTE } from '../shared/types.js'
import type { Canvas, CanvasEntry, CanvasItem, Composition, PendingGeneration, Status } from '../shared/types.js'
import type { CredentialsPort } from './credentials-port.js'
import { EditorModel } from './editor-model.js'
export interface Catalog extends Status { canvases: CanvasEntry[]; active?: Record<string, PendingGeneration[]> }
type CanvasReply = Canvas & { pending?: PendingGeneration[] }
export interface State {
  catalog?: Catalog | undefined
  loading: boolean
  keyBusy: boolean
  settingsBusy: boolean
  error?: string | undefined
  message?: string | undefined
}
export interface CanvasState {
  canvas?: Canvas | undefined
  loading: boolean
  /** Prompts currently being generated, newest last: this view's requests plus the host's (e.g. the conversation's tool calls). */
  pending: PendingView[]
  error?: string | undefined
  message?: string | undefined
  /** Item ids created by the most recent generation, for selection and reveal. */
  created: string[]
}
export interface PendingView { key: string; prompt: string; size?: string | undefined; parentId?: string | undefined; startedAt: number }
export const MESSAGE_MS = 4000
export const POLL_MS = 3000
type Reply<T> = { ok: true; value: T } | { ok: false; error: string }
export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'
export type Fetcher = <T>(path: string, signal: AbortSignal, body?: unknown, method?: Method) => Promise<Reply<T>>
export const request: Fetcher = async <T>(path: string, signal: AbortSignal, body?: unknown, method?: Method): Promise<Reply<T>> => {
  const response = await fetch(new URL(path.replace(/^\//, ''), document.baseURI), {
    method: method ?? (body === undefined ? 'GET' : 'POST'), credentials: 'same-origin', cache: 'no-store', signal,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(`Seedream 暂不可用（HTTP ${response.status}）。`)
  return response.json() as Promise<Reply<T>>
}
export const imageUrl = (sessionId: string, id: string, download = false): string => {
  const url = new URL((ROUTE + '/image').slice(1), document.baseURI)
  url.searchParams.set('session', sessionId); url.searchParams.set('id', id)
  if (download) url.searchParams.set('download', '1')
  return url.href
}
const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback
class Emitter<S extends { message?: string | undefined }> {
  protected listeners = new Set<() => void>()
  protected disposed = false
  private notice: ReturnType<typeof setTimeout> | undefined
  constructor(protected state: S) {}
  getSnapshot = (): S => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  /** Status messages are transient; errors stay until the next action. */
  protected set(patch: Partial<S>) {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }
    if ('message' in patch) {
      clearTimeout(this.notice); this.notice = undefined
      const message = patch.message
      if (message) this.notice = setTimeout(() => { if (this.state.message === message) this.set({ message: undefined } as Partial<S>) }, MESSAGE_MS)
    }
    this.listeners.forEach(l => l())
  }
  notify(message: string) { this.set({ message } as Partial<S>) }
  dispose() { this.disposed = true; clearTimeout(this.notice); this.listeners.clear() }
}
/** One Session's canvas: polled while visible, written through the host routes. */
export class CanvasModel extends Emitter<CanvasState> {
  private holders = 0
  private timer: ReturnType<typeof setInterval> | undefined
  private reading: AbortController | undefined
  private generating = new Map<string, AbortController>()
  private writes = 0
  private serial = 0
  private readonly path: string
  private editors = new Map<string, EditorModel>()
  constructor(readonly sessionId: string, private readonly fetcher: Fetcher, private readonly onChange: () => void) {
    super({ loading: true, pending: [], created: [] })
    this.path = `${ROUTE}/canvas?session=${encodeURIComponent(sessionId)}`
  }
  /** Keep polling while at least one view holds the model. */
  hold(): () => void {
    if (this.holders++ === 0) { void this.refresh(); this.timer = setInterval(() => { if (document.visibilityState !== 'hidden') void this.refresh() }, POLL_MS) }
    let released = false
    return () => { if (released) return; released = true; if (--this.holders === 0) { clearInterval(this.timer); this.timer = undefined; this.reading?.abort() } }
  }
  /** Local requests are shown at once; the host's list arrives with each poll and never duplicates them. */
  private local: PendingView[] = []
  private remote: PendingGeneration[] = []
  private syncPending() {
    // While this view waits on its own request, the host reports the same generation; show it once.
    const mine = this.local.map(p => p.prompt), remote = this.remote.filter(p => { const i = mine.indexOf(p.prompt); if (i < 0) return true; mine.splice(i, 1); return false })
    this.set({ pending: [...this.local, ...remote.map(p => ({ key: p.key, prompt: p.prompt, size: p.size, parentId: p.parentId, startedAt: Date.parse(p.startedAt) || Date.now() }))] })
  }
  private accept(reply: CanvasReply) {
    const { pending, ...canvas } = reply
    if (pending) { this.remote = pending; this.syncPending() }
    const current = this.state.canvas
    if (current && canvas.revision <= current.revision) return
    this.set({ canvas, loading: false, error: undefined })
  }
  async refresh(): Promise<void> {
    if (this.reading || this.disposed) return
    const control = new AbortController(); this.reading = control
    try {
      const reply = await this.fetcher<CanvasReply>(this.path, control.signal)
      if (control.signal.aborted || this.disposed) return
      if (!reply.ok) throw new Error(reply.error)
      // Local layout edits in flight win over a poll that read the older file.
      if (this.writes === 0) this.accept(reply.value)
    } catch (error) { if (!control.signal.aborted) this.set({ loading: false, error: errorText(error, '读取画布失败。') }) }
    finally { if (this.reading === control) this.reading = undefined; if (this.state.loading) this.set({ loading: false }) }
  }
  async generate(input: { prompt: string; images?: string[]; size?: string; title?: string }, parentId?: string): Promise<boolean> {
    const prompt = input.prompt.trim()
    if (!prompt) return false
    const key = `local-${++this.serial}`, control = new AbortController()
    this.generating.set(key, control)
    this.local = [...this.local, { key, prompt, size: input.size, parentId, startedAt: Date.now() }]
    this.set({ error: undefined, message: undefined }); this.syncPending()
    try {
      const reply = await this.fetcher<{ canvas: Canvas; created: string[] }>(`${ROUTE}/generate?session=${encodeURIComponent(this.sessionId)}`, control.signal, { ...input, prompt })
      if (control.signal.aborted || this.disposed) return false
      if (!reply.ok) throw new Error(reply.error)
      this.accept(reply.value.canvas); this.set({ created: reply.value.created }); this.onChange()
      return true
    } catch (error) {
      if (!control.signal.aborted) this.set({ error: errorText(error, '生成失败。') })
      return false
    } finally {
      this.generating.delete(key)
      this.local = this.local.filter(p => p.key !== key); this.syncPending()
    }
  }
  dismiss() { this.set({ error: undefined, message: undefined }) }
  /** Stop waiting; the host still saves a billed result, which the next poll shows. */
  cancel() {
    for (const control of this.generating.values()) control.abort()
    this.generating.clear(); this.local = []; this.syncPending()
    this.set({ message: '已停止等待；已发出的请求仍可能计费，完成后会出现在画布上。' })
  }
  async move(positions: Array<{ id: string; x: number; y: number }>): Promise<void> {
    const canvas = this.state.canvas
    if (!canvas || !positions.length) return
    const byId = new Map(positions.map(p => [p.id, p]))
    const moved = <T extends { id: string; x: number; y: number }>(i: T): T => { const p = byId.get(i.id); return p ? { ...i, x: Math.round(p.x), y: Math.round(p.y) } : i }
    this.set({ canvas: { ...canvas, items: canvas.items.map(moved), ...(canvas.compositions ? { compositions: canvas.compositions.map(moved) } : {}) } })
    this.writes++
    try {
      const reply = await this.fetcher<Canvas>(this.path, new AbortController().signal, { positions }, 'PATCH')
      if (!reply.ok) throw new Error(reply.error)
      if (this.writes === 1) this.accept(reply.value)
    } catch (error) { this.set({ error: errorText(error, '保存布局失败。') }) }
    finally { this.writes-- }
  }
  async remove(id: string): Promise<boolean> {
    try {
      const reply = await this.fetcher<{ canvas: Canvas }>(`${ROUTE}/item?session=${encodeURIComponent(this.sessionId)}&id=${encodeURIComponent(id)}`, new AbortController().signal, undefined, 'DELETE')
      if (!reply.ok) throw new Error(reply.error)
      this.accept(reply.value.canvas); this.onChange(); return true
    } catch (error) { this.set({ error: errorText(error, '删除失败。') }); return false }
  }
  async createComposition(sourceId: string, composition?: Composition): Promise<Composition> {
    const reply = await this.fetcher<{ canvas: Canvas; composition: Composition }>(`${ROUTE}/composition?session=${encodeURIComponent(this.sessionId)}`, new AbortController().signal, { sourceId, ...(composition ? { composition } : {}) })
    if (!reply.ok) throw new Error(reply.error)
    this.accept(reply.value.canvas); this.onChange(); return reply.value.composition
  }
  editor(composition: Composition): EditorModel {
    let editor = this.editors.get(composition.id)
    if (!editor) { editor = new EditorModel(composition, (c, v) => this.saveComposition(c, v)); this.editors.set(composition.id, editor) }
    return editor
  }
  async saveComposition(composition: Composition, version: number): Promise<Composition> {
    const reply = await this.fetcher<{ canvas: Canvas; composition: Composition }>(`${ROUTE}/composition?session=${encodeURIComponent(this.sessionId)}`, new AbortController().signal,
      { id: composition.id, version, composition }, 'PATCH')
    if (!reply.ok) throw new Error(reply.error)
    this.accept(reply.value.canvas); return reply.value.composition
  }
  async deleteComposition(id: string): Promise<boolean> {
    try {
      const reply = await this.fetcher<{ canvas: Canvas }>(`${ROUTE}/composition?session=${encodeURIComponent(this.sessionId)}&id=${encodeURIComponent(id)}`, new AbortController().signal, undefined, 'DELETE')
      if (!reply.ok) throw new Error(reply.error)
      this.accept(reply.value.canvas); this.onChange(); return true
    } catch (error) { this.set({ error: errorText(error, '删除画板失败。') }); return false }
  }
  async decompose(input: { image: string; maxImages: number; prompt: string }): Promise<Composition> {
    const key = `split-${++this.serial}`, parentId = input.image.slice(5)
    this.local = [...this.local, { key, prompt: `分图层 · ${this.state.canvas?.items.find(i => i.id === parentId)?.title ?? ''}`, parentId, startedAt: Date.now() }]; this.syncPending()
    try {
      const reply = await this.fetcher<{ canvas: Canvas; composition: Composition }>(`${ROUTE}/decompose?session=${encodeURIComponent(this.sessionId)}`, new AbortController().signal, input)
      if (!reply.ok) throw new Error(reply.error)
      this.accept(reply.value.canvas); this.onChange(); return reply.value.composition
    } finally { this.local = this.local.filter(p => p.key !== key); this.syncPending() }
  }
  async importComposite(png: string, title: string, asLayer = true): Promise<CanvasItem> {
    const reply = await this.fetcher<{ canvas: Canvas; item: CanvasItem }>(`${ROUTE}/composite?session=${encodeURIComponent(this.sessionId)}`, new AbortController().signal, { png, title, asLayer })
    if (!reply.ok) throw new Error(reply.error)
    this.accept(reply.value.canvas); this.onChange(); return reply.value.item
  }
  override dispose() { clearInterval(this.timer); this.reading?.abort(); for (const e of this.editors.values()) e.dispose(); for (const c of this.generating.values()) c.abort(); super.dispose() }
}
export const ACTIVE_MS = 2000
/** Root state: status, settings and the canvas list; per-Session models are cached here. */
export class Controller extends Emitter<State> {
  private refreshRequest: AbortController | undefined
  private models = new Map<string, CanvasModel>()
  private active: Record<string, PendingGeneration[]> = {}
  private activeListeners = new Set<() => void>()
  private watchers = 0
  private watchTimer: ReturnType<typeof setInterval> | undefined
  private watching = false
  /** Generation keys already announced, so a canvas opens once per generation. */
  readonly announced = new Set<string>()
  getActive = (): Record<string, PendingGeneration[]> => this.active
  subscribeActive = (listener: () => void): (() => void) => { this.activeListeners.add(listener); return () => this.activeListeners.delete(listener) }
  /** Watch which Sessions have a generation running on the host, while any conversation view needs it. */
  watchActive(): () => void {
    const poll = async () => {
      if (this.watching || this.disposed || document.visibilityState === 'hidden') return
      this.watching = true
      try {
        const reply = await this.fetcher<{ active: Record<string, PendingGeneration[]> }>(ROUTE + '/active', new AbortController().signal)
        if (reply.ok && !this.disposed && JSON.stringify(reply.value.active) !== JSON.stringify(this.active)) { this.active = reply.value.active; this.activeListeners.forEach(l => l()) }
      } catch { /* the next poll retries */ } finally { this.watching = false }
    }
    if (this.watchers++ === 0) { void poll(); this.watchTimer = setInterval(() => { void poll() }, ACTIVE_MS) }
    let released = false
    return () => { if (released) return; released = true; if (--this.watchers === 0) { clearInterval(this.watchTimer); this.watchTimer = undefined } }
  }
  constructor(private readonly credentials: () => CredentialsPort, private readonly fetcher: Fetcher = request) {
    super({ loading: true, keyBusy: false, settingsBusy: false })
  }
  canvas(sessionId: string): CanvasModel {
    let model = this.models.get(sessionId)
    if (!model) { model = new CanvasModel(sessionId, this.fetcher, () => { void this.attach() }); this.models.set(sessionId, model) }
    return model
  }
  async attach(): Promise<void> {
    this.refreshRequest?.abort()
    const control = new AbortController(); this.refreshRequest = control
    this.set({ loading: true })
    try {
      const reply = await this.fetcher<Catalog>(ROUTE, control.signal)
      if (control.signal.aborted || this.disposed) return
      if (!reply.ok) throw new Error(reply.error)
      this.set({ catalog: reply.value, error: undefined })
    } catch (error) { if (!control.signal.aborted) this.set({ error: errorText(error, '读取配置失败。') }) }
    finally { if (this.refreshRequest === control) { this.refreshRequest = undefined; this.set({ loading: false }) } }
  }
  async saveSettings(patch: { size?: string; watermark?: boolean }): Promise<void> {
    if (this.state.settingsBusy || !this.state.catalog) return
    this.set({ settingsBusy: true, error: undefined })
    try {
      const reply = await this.fetcher<Status>(ROUTE + '/settings', new AbortController().signal, patch)
      if (!reply.ok) throw new Error(reply.error)
      this.set({ catalog: { ...this.state.catalog, ...reply.value }, message: '设置已保存。' })
    } catch (error) { this.set({ error: errorText(error, '保存设置失败。') }) }
    finally { this.set({ settingsBusy: false }) }
  }
  async saveKey(text: string): Promise<boolean> {
    if (!text.trim() || this.state.keyBusy || !this.state.catalog) return false
    this.set({ keyBusy: true, error: undefined, message: undefined })
    try {
      const port = this.credentials(), ref = this.state.catalog.keyRef
      if ((await port.describe(ref))?.writable === false) throw new Error('Key 由环境变量或只读来源管理，请在启动环境中修改。')
      await port.set(ref, text.trim()); await this.attach(); this.set({ message: '方舟 API Key 已保存。' }); return true
    } catch (error) { this.set({ error: errorText(error, '保存失败。') }); return false }
    finally { this.set({ keyBusy: false }) }
  }
  async removeKey(): Promise<void> {
    if (!this.state.catalog || this.state.keyBusy) return
    this.set({ keyBusy: true, error: undefined })
    try {
      const port = this.credentials(), ref = this.state.catalog.keyRef
      if ((await port.describe(ref))?.writable === false) throw new Error('Key 由环境变量或只读来源管理，请在启动环境中移除。')
      await port.unset(ref); await this.attach(); this.set({ message: '已移除方舟 API Key。' })
    } catch (error) { this.set({ error: errorText(error, '移除失败。') }) }
    finally { this.set({ keyBusy: false }) }
  }
  override dispose() { clearInterval(this.watchTimer); this.activeListeners.clear(); this.refreshRequest?.abort(); for (const m of this.models.values()) m.dispose(); this.models.clear(); super.dispose() }
}
