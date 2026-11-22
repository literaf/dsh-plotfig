import { useEffect, useRef, useState } from 'react'
import type { PluginUpdate } from '../shared/types.js'
import type { Controller } from './controller.js'
import { RefreshIcon } from './icons.js'
import { ResearchDialog } from './ResearchDialog.js'

type UpdateState = { phase: 'checking' | 'error' } | { phase: 'done'; result: PluginUpdate }
const resultText = {
  current: '已是最新正式版',
  available: '发现新版本',
  ahead: '当前版本高于最新正式版',
}

export function UpdateCheck({ controller, currentVersion, openPluginManager }: {
  controller: Controller
  currentVersion: string | undefined
  openPluginManager?: (() => void) | undefined
}) {
  const [state, setState] = useState<UpdateState>()
  const request = useRef<AbortController>()
  useEffect(() => () => request.current?.abort(), [])

  function close() {
    request.current?.abort()
    request.current = undefined
    setState(undefined)
  }

  async function check() {
    if (request.current) return
    const pending = new AbortController()
    request.current = pending
    setState({ phase: 'checking' })
    try {
      const result = await controller.checkForUpdate(AbortSignal.any([pending.signal, AbortSignal.timeout(15_000)]))
      if (!pending.signal.aborted) setState({ phase: 'done', result })
    } catch {
      if (!pending.signal.aborted) setState({ phase: 'error' })
    } finally {
      if (request.current === pending) request.current = undefined
    }
  }

  const result = state?.phase === 'done' ? state.result : undefined
  const installed = result?.currentVersion ?? currentVersion
  return <>
    <button type="button" className="sd-button sd-update-trigger" aria-label="检查更新" title="检查更新" aria-haspopup="dialog" aria-expanded={!!state} onClick={() => void check()}>
      <RefreshIcon size={15}/><span>检查更新</span>
    </button>
    {state && <ResearchDialog title="PlotFig 更新" onClose={close}>
      <div className="sd-update-result">
        {state.phase === 'error'
          ? <p role="alert" className="sd-research-error">版本检查失败，请检查网络连接后重试。</p>
          : <p role="status">{result ? resultText[result.status] : '正在检查更新…'}</p>}
        <dl>
          {installed && <div><dt>已安装版本</dt><dd>{installed}</dd></div>}
          {result && <div><dt>最新正式版</dt><dd>{result.latestVersion}</dd></div>}
        </dl>
        {state.phase === 'error' && <button type="button" className="sd-button" onClick={() => void check()}>重试</button>}
        {result?.status === 'available' && (openPluginManager
          ? <button type="button" className="sd-button sd-button-primary" onClick={() => { close(); openPluginManager() }}>管理插件</button>
          : <p>打开「插件 → 已安装插件」，选择 dsh-plotfig 查看更新选项。</p>)}
      </div>
    </ResearchDialog>}
  </>
}
