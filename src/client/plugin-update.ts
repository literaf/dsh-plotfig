import type { PluginUpdate } from '../shared/types.js'

// This optional client remote was added after the minimum supported Harness SDK.
type Answer<T> = { ok: true; value: T } | { ok: false; error: { message: string } }
type Application = 'applied' | 'restart-required' | 'failed' | 'cancelled' | 'overridden'
interface Change { application: Application; version?: string; error?: { diagnostic?: string } }
interface Bundle { name: string; installed: boolean; version?: string; update?: 'registry' | 'git' }
export interface PluginUpdateManager {
  listBundles(): Promise<Answer<Bundle[]>>
  updateBundle(name: string, version: string, options: Record<string, never>): Promise<Answer<{
    to: string; step: 'check' | 'remove' | 'install'; result: Change; restore?: Change
  }>>
}

export interface CheckedRelease extends PluginUpdate { action?: 'update' | 'restart' }
export type Installation = { release: CheckedRelease } & (
  { phase: 'installing' | 'applied' | 'restart-required' } | { phase: 'error'; message: string }
)
const PACKAGE = 'dsh-plotfig'

export async function checkInstallAction(release: PluginUpdate, manager: PluginUpdateManager | undefined, signal: AbortSignal): Promise<CheckedRelease> {
  if (!manager || release.status !== 'available' || signal.aborted) return release
  // The native inventory takes zero arguments. Stop waiting if the dialog closes or its check times out.
  let stopWaiting!: () => void
  const cancelled = new Promise<undefined>(resolve => { stopWaiting = () => resolve(undefined) })
  signal.addEventListener('abort', stopWaiting, { once: true })
  try {
    const answer = await Promise.race([manager.listBundles(), cancelled])
    if (answer?.ok) {
      const bundle = answer.value.find(item => item.name === PACKAGE && item.installed)
      if (bundle?.version === release.latestVersion) return { ...release, action: 'restart' }
      if (bundle?.version === release.currentVersion && bundle.update === 'registry') return { ...release, action: 'update' }
    }
  } catch { /* Keep the version result if the inventory is temporarily unavailable. */ }
  finally { signal.removeEventListener('abort', stopWaiting) }
  return release
}

export async function installPlotFig(manager: PluginUpdateManager, version: string): Promise<'applied' | 'restart-required'> {
  const answer = await manager.updateBundle(PACKAGE, version, {})
  if (!answer.ok) throw new Error(answer.error.message || 'DSH 未能确认更新结果。')
  const { to, step, result, restore } = answer.value
  if (step === 'install' && to === version && (result.version === undefined || result.version === version)
      && (result.application === 'applied' || result.application === 'restart-required')) return result.application
  let message = result.error?.diagnostic || (result.application === 'cancelled' ? '更新已取消。' : 'DSH 未能完成更新。')
  if (restore) message += restore.application === 'applied' || restore.application === 'restart-required'
    ? ' DSH 已恢复原版本。' : ' 恢复原版本失败，请在「插件」中查看 PlotFig。'
  throw new Error(message)
}
