import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { TAB_KIND } from '../shared/types.js'

export interface SidebarRight {
  openTab(kind: string): void
  isExpanded(): boolean
  toggleExpanded(): void
  mounted: { getSnapshot(): string | undefined; subscribe(listener: () => void): () => void }
}

/** Only act on the named, visible Session. Background generation must not open another Session's tab. */
export function showCanvas(right: SidebarRight | undefined, sessionId: string): boolean {
  if (right?.mounted.getSnapshot() !== sessionId) return false
  right.openTab(TAB_KIND)
  if (!right.isExpanded()) right.toggleExpanded()
  return true
}

/** Gallery navigation waits for the target Session's native surface to mount. */
export class CanvasNavigation {
  private cancel: (() => void) | undefined
  constructor(private ctx: Pick<ClientContext, 'get'>) {}
  dispose(): void { this.cancel?.(); this.cancel = undefined }
  open(sessionId: string): boolean {
    const workspace = this.ctx.get('uiWorkspace' as never) as unknown as { openSession(id: string): void } | undefined
    const right = this.ctx.get('sidebarRight' as never) as unknown as SidebarRight | undefined
    if (!workspace?.openSession || !right) return false
    this.dispose()
    const previous = right.mounted.getSnapshot()
    let stop = () => {}, timer: ReturnType<typeof setTimeout> | undefined, done = false
    const cleanup = () => { done = true; stop(); clearTimeout(timer) }
    const reveal = () => {
      if (done) return
      const current = right.mounted.getSnapshot()
      if (current === sessionId) { showCanvas(right, sessionId); cleanup() }
      else if (current !== undefined && current !== previous) cleanup()
    }
    stop = right.mounted.subscribe(reveal)
    timer = setTimeout(cleanup, 8000)
    this.cancel = cleanup
    try { workspace.openSession(sessionId); reveal() } catch (error) { cleanup(); throw error }
    return true
  }
}
