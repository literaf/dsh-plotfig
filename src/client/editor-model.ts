import type { Composition } from '../shared/types.js'

export interface EditorState {
  composition: Composition
  dirty: boolean
  saving: boolean
  error?: string | undefined
  canUndo: boolean
  canRedo: boolean
}
/** Coalesce autosaves while keeping local edits and undo independent of a network response. */
export class EditorModel {
  private listeners = new Set<() => void>()
  private state: EditorState
  private done: Composition[] = []
  private undone: Composition[] = []
  private revision = 0
  private savedRevision = 0
  private version: number
  private timer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<boolean> | undefined
  private group: { key: string; at: number } | undefined
  constructor(composition: Composition, private readonly save: (composition: Composition, version: number) => Promise<Composition>) {
    this.version = composition.version
    this.state = { composition, dirty: false, saving: false, canUndo: false, canRedo: false }
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit(patch: Partial<EditorState> = {}) {
    this.state = { ...this.state, dirty: this.revision !== this.savedRevision, canUndo: !!this.done.length, canRedo: !!this.undone.length, ...patch }
    this.listeners.forEach(fn => fn())
  }
  change(update: (composition: Composition) => Composition, group?: string): void {
    const next = update(this.state.composition)
    if (JSON.stringify(next) === JSON.stringify(this.state.composition)) return
    if (!group || this.group?.key !== group || Date.now() - this.group.at > 600) this.done = [...this.done.slice(-49), this.state.composition]
    this.group = group ? { key: group, at: Date.now() } : undefined
    this.undone = []; this.revision++; this.emit({ composition: next })
    this.schedule()
  }
  undo(): void {
    const previous = this.done.pop(); if (!previous) return
    this.undone.push(this.state.composition); this.group = undefined; this.revision++; this.emit({ composition: previous }); this.schedule()
  }
  redo(): void {
    const next = this.undone.pop(); if (!next) return
    this.done.push(this.state.composition); this.group = undefined; this.revision++; this.emit({ composition: next }); this.schedule()
  }
  private schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => { this.timer = undefined; if (!this.state.error) void this.flush() }, 220) }
  /** Explicit retry only on save failure; billable requests never pass through this class. */
  flush(): Promise<boolean> {
    clearTimeout(this.timer); this.timer = undefined
    if (this.running) return this.running
    if (this.revision === this.savedRevision) return Promise.resolve(true)
    this.emit({ saving: true, error: undefined })
    this.running = (async () => {
      try {
        while (this.revision !== this.savedRevision) {
          const revision = this.revision, snapshot = this.state.composition
          const saved = await this.save(snapshot, this.version)
          this.version = saved.version; this.savedRevision = revision
          this.emit({ composition: { ...this.state.composition, version: saved.version } })
        }
        return true
      } catch (error) {
        this.emit({ error: error instanceof Error ? error.message : '保存失败，当前编辑仍保留。' }); return false
      } finally { this.running = undefined; this.emit({ saving: false }) }
    })()
    return this.running
  }
  reload(composition: Composition) {
    if (this.running) return
    clearTimeout(this.timer); this.timer = undefined
    this.done = []; this.undone = []; this.group = undefined; this.revision = this.savedRevision = 0; this.version = composition.version
    this.emit({ composition, saving: false, error: undefined })
  }
  dispose() { clearTimeout(this.timer); if (this.state.dirty && !this.state.error) void this.flush(); this.listeners.clear() }
}
