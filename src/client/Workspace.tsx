import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import { BOARD_PREFIX, isBoard, SIZE_TIERS } from '../shared/types.js'
import { BackIcon, GearIcon, ImageIcon, NewIcon } from './icons.js'
import type { Controller, State } from './controller.js'
import { imageUrl } from './controller.js'
import { CanvasView } from './Canvas.js'
import type { ConversationActions } from './handoff.js'
export function Icon({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    <rect width="100" height="100" rx="22" fill="#0a0a0a"/>
    <path d="M22 72L42 46L56 62L64 52L80 72Z" fill="#f5f5f5"/>
    <circle cx="66" cy="32" r="9" fill="#9be22c"/>
    <path d="M30 26C36 20 44 22 46 28" stroke="#f5f5f5" strokeWidth="5" strokeLinecap="round" fill="none"/>
  </svg>
}
export function keyStatus(state: State): string {
  const c = state.catalog
  if (!c) return state.loading ? '正在读取配置…' : '配置暂不可用'
  return c.configured ? '已配置方舟 API Key' : '尚未配置方舟 API Key'
}
export function Settings({ controller }: { controller: Controller }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), [key, setKey] = useState(''), keyId = useId(), sizeId = useId()
  const c = state.catalog
  useEffect(() => { void controller.attach() }, [controller])
  return <section className="sd-settings">
    <h2>Seedream 设置</h2><p>使用火山方舟的 Seedream 5.5 模型（{c?.model ?? 'doubao-seedream-5-5'}）生成和编辑图片。</p>
    <div className="sd-key-status"><span className="sd-status-dot" data-ready={c?.configured ?? false}/>{keyStatus(state)}</div>
    {state.error ? <div className="sd-alert" role="alert">{state.error}</div> : null}{state.message ? <div className="sd-alert" role="status">{state.message}</div> : null}
    <label htmlFor={keyId}>方舟 API Key</label><div className="sd-key-row"><input id={keyId} type="password" autoComplete="off" spellCheck={false} placeholder="输入新 Key" value={key} onChange={e => setKey(e.target.value)} /><button className="sd-button sd-button-primary" disabled={!key.trim() || state.keyBusy || !c} onClick={() => { void controller.saveKey(key).then(ok => { if (ok) setKey('') }) }}>{state.keyBusy ? '保存中…' : '保存'}</button></div>
    <p>Key 保存在本机的凭据服务中。<a href="https://console.volcengine.com/ark/region:cn-beijing/apiKey" target="_blank" rel="noopener noreferrer">获取 API Key ↗</a></p>
    <div className="sd-settings-row">
      <label htmlFor={sizeId}>默认尺寸</label>
      <select id={sizeId} disabled={!c || state.settingsBusy} value={c && (SIZE_TIERS as readonly string[]).includes(c.defaultSize) ? c.defaultSize : '2K'} onChange={e => { void controller.saveSettings({ size: e.target.value }) }}>{SIZE_TIERS.map(s => <option key={s} value={s}>{s}</option>)}</select>
    </div>
    <label className="sd-check"><input type="checkbox" disabled={!c || state.settingsBusy} checked={c?.watermark ?? true} onChange={e => { void controller.saveSettings({ watermark: e.target.checked }) }}/>添加「AI 生成」水印（方舟默认开启）</label>
    <div className="sd-settings-actions"><button className="sd-button" disabled={!c?.configured || state.keyBusy} onClick={() => { void controller.removeKey() }}>移除 Key</button><button className="sd-button" disabled={state.loading} onClick={() => { void controller.attach() }}>刷新状态</button></div>
    <p>每次生成按输出图片张数计费。生成结果会立即下载到本机，按对话分别保存在各自的画布中。</p>
    <p>版本 {c?.version ?? '—'}</p>
  </section>
}
/** Main panel: gallery and settings; conversation canvases reopen their native Session. */
export function Workspace({ controller, openConversation, conversation }: { controller: Controller; openConversation(id: string): boolean; conversation(id: string): ConversationActions }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [open, setOpen] = useState<string | undefined>(), [settings, setSettings] = useState(false)
  useEffect(() => { void controller.attach() }, [controller])
  // The list changes while conversations generate; refresh it while it is on screen.
  useEffect(() => {
    if (open || settings) return
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void controller.attach() }, 3000)
    return () => clearInterval(timer)
  }, [controller, open, settings])
  const c = state.catalog, canvases = c?.canvases ?? []
  const current = canvases.find(x => x.sessionId === open)
  // An empty canvas is kept only in memory; it is saved with its first image.
  const create = () => { setSettings(false); setOpen(BOARD_PREFIX + crypto.randomUUID()) }
  const openCanvas = (id: string) => {
    try { if (isBoard(id) || !openConversation(id)) setOpen(id) }
    catch (error) { controller.notify(error instanceof Error ? error.message : '无法打开原对话') }
  }
  const relative = (iso: string) => {
    const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000)
    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes} 分钟前`
    if (minutes < 60 * 24) return `${Math.round(minutes / 60)} 小时前`
    return new Date(iso).toLocaleDateString()
  }
  const heading = settings ? '设置' : open ? current?.title ?? (isBoard(open) ? '新画布' : '画布') : '全部画布'
  return <main className="sd sd-workspace">
    <header className="sd-head">
      <div className="sd-title">
        {open || settings ? <button className="sd-icon-button" onClick={() => { setOpen(undefined); setSettings(false); void controller.attach() }} aria-label="返回全部画布" title="全部画布"><BackIcon/></button> : <Icon size={22}/>}
        <div className="sd-title-text"><strong>{heading}</strong>
          <span className="sd-brand">{open && current ? `${isBoard(open) ? '独立画布' : '对话画布'} · ${current.count} 张` : open ? (isBoard(open) ? '独立画布' : '对话画布') : `Seedream 5.5 · ${canvases.length} 个画布`}</span></div>
      </div>
      <div className="sd-head-actions">
        {!open && !settings && c?.configured ? <button className="sd-button sd-button-primary" onClick={create}><NewIcon size={14}/>新建画布</button> : null}
        {!settings ? <button className="sd-icon-button" onClick={() => setSettings(true)} aria-label="设置" title="设置"><GearIcon/></button> : null}
      </div>
    </header>
    {settings || (c && !c.configured) ? <div className="sd-scroll"><Settings controller={controller}/></div>
      : open ? <CanvasView key={open} model={controller.canvas(open)} defaultSize={c?.defaultSize} conversation={isBoard(open) ? undefined : conversation(open)}/>
      : <div className="sd-scroll">
        {state.error ? <div className="sd-alert" role="alert">{state.error}</div> : null}
        {state.message ? <div className="sd-alert" role="status">{state.message}</div> : null}
        {canvases.length ? <ul className="sd-gallery">
          {c?.configured ? <li><button className="sd-card sd-card-new" onClick={create}><span className="sd-card-new-icon"><NewIcon size={22}/></span><strong>新建画布</strong><span>不属于任何对话，直接画图</span></button></li> : null}
          {canvases.map(x => { const running = c?.active?.[x.sessionId]?.length ?? 0
            return <li key={x.sessionId}><button className="sd-card" onClick={() => openCanvas(x.sessionId)}>
              <span className="sd-card-cover">{x.cover ? <img src={imageUrl(x.sessionId, x.cover)} alt="" loading="lazy"/> : <ImageIcon size={22}/>}
                {running ? <span className="sd-card-badge"><span className="sd-spinner sd-spinner-small"/>生成中</span> : x.count > 1 ? <span className="sd-card-badge">{x.count} 张</span> : null}</span>
              <strong>{x.title}</strong>
              <span className="sd-card-meta"><span className="sd-tag" data-kind={isBoard(x.sessionId) ? 'board' : 'chat'}>{isBoard(x.sessionId) ? '独立' : '对话'}</span>{relative(x.updatedAt)}</span>
            </button></li> })}
        </ul>
          : <div className="sd-empty sd-empty-static"><div className="sd-empty-icon"><ImageIcon size={22}/></div><strong>还没有画布</strong><p>新建一块画布直接画图；或者在对话里输入 <code>/seedream 画一张…</code>，图片会放进那个对话自己的画布。</p>{c?.configured ? <button className="sd-button sd-button-primary" onClick={create}><NewIcon size={14}/>新建画布</button> : null}</div>}
      </div>}
  </main>
}
