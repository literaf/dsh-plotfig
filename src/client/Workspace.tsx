import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { MARK_BODY, MARK_LEAF, MARK_TRANSFORM, MARK_VIEWBOX } from './mark.js'
import { BOARD_PREFIX, isBoard, SIZE_TIERS } from '../shared/types.js'
import { BackIcon, ChevronIcon, GearIcon, ImageIcon, NewIcon } from './icons.js'
import type { Controller, State } from './controller.js'
import { imageUrl } from './controller.js'
import { CanvasView } from './Canvas.js'
import type { ConversationActions } from './handoff.js'
import { ResearchTools } from './ResearchTools.js'
import { ResearchStyleButton, ResearchStylePicker } from './ResearchStyles.js'
import type { GenerationStyle, ResearchToolId } from '../shared/research.js'
import { DiagramTemplates, TemplateButton } from './DiagramTemplates.js'
import { Composer, SizePicker, TransparentToggle } from './Composer.js'
import type { SizeChoice } from './Composer.js'
const RECENT_CANVASES = 8

export function Icon({ size = 20 }: { size?: number }) {
  // The P follows the surrounding text color, so it reads on light and dark sidebars; the leaf is burnt orange on light themes and lime on dark ones.
  return <svg width={size} height={size} viewBox={MARK_VIEWBOX} aria-hidden="true">
    <path d={MARK_BODY} fill="currentColor" transform={MARK_TRANSFORM}/>
    <path className="sd-mark-leaf" d={MARK_LEAF} transform={MARK_TRANSFORM}/>
  </svg>
}
export function keyStatus(state: State): string {
  const c = state.catalog
  if (!c) return state.loading ? '正在读取配置…' : '配置暂不可用'
  return `${c.configured ? '已配置' : '尚未配置'} AI4Scholar API Key`
}
export function Settings({ controller }: { controller: Controller }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), [key, setKey] = useState(''), keyId = useId(), sizeId = useId()
  const c = state.catalog
  useEffect(() => { void controller.attach() }, [controller])
  return <section className="sd-settings">
    <h2>PlotFig 设置</h2><p>通过 AI4Scholar 使用 Seedream 5.5 生成和编辑图片。</p>
    <div className="sd-key-status"><span className="sd-status-dot" data-ready={c?.configured ?? false}/>{keyStatus(state)}</div>
    {state.error ? <div className="sd-alert" role="alert">{state.error}</div> : null}{state.message ? <div className="sd-alert" role="status">{state.message}</div> : null}
    <label htmlFor={keyId}>AI4Scholar API Key</label><div className="sd-key-row"><input id={keyId} type="password" autoComplete="off" spellCheck={false} placeholder="sk-user-…" value={key} onChange={e => setKey(e.target.value)} /><button className="sd-button sd-button-primary" disabled={!key.trim() || state.keyBusy || !c} onClick={() => { void controller.saveKey(key).then(ok => { if (ok) setKey('') }) }}>{state.keyBusy ? '保存中…' : '保存'}</button></div>
    <p>Key 保存在本机凭据服务中。PlotFig 与 dsh-ai4scholar 共用此凭据，保存或移除会同步影响两个插件。<a href="https://ai4scholar.net/docs/integrations/open-api?src=dsh_plotfig#获取-api-key" target="_blank" rel="noopener noreferrer">获取 API Key ↗</a></p>
    <div className="sd-settings-row">
      <label htmlFor={sizeId}>默认尺寸</label>
      <select id={sizeId} disabled={!c || state.settingsBusy} value={c && (SIZE_TIERS as readonly string[]).includes(c.defaultSize) ? c.defaultSize : '2K'} onChange={e => { void controller.saveSettings({ size: e.target.value }) }}>{SIZE_TIERS.map(s => <option key={s} value={s}>{s}</option>)}</select>
    </div>
    <label className="sd-check"><input type="checkbox" disabled={!c || state.settingsBusy} checked={c?.watermark ?? true} onChange={e => { void controller.saveSettings({ watermark: e.target.checked }) }}/>添加「AI 生成」水印</label>
    <div className="sd-settings-actions"><button className="sd-button" disabled={!c?.configured || state.checkBusy} onClick={() => { void controller.checkConnection() }} title="免费检查 AI4Scholar 密钥、余额和绘图接口">{state.checkBusy ? '测试中…' : '测试连接'}</button><button className="sd-button" disabled={!c?.configured || state.keyBusy} onClick={() => { void controller.removeKey() }}>移除 Key</button><button className="sd-button" disabled={state.loading} onClick={() => { void controller.attach() }}>刷新状态</button></div>
    <p>生图和编辑使用 AI4Scholar 积分，分层先预留最高积分，再按实际交付的图片结算。生成结果会立即下载到本机，按对话分别保存在各自的画布中。</p>
    <p>版本 {c?.version ?? '—'}</p>
  </section>
}
/** Main panel: gallery and settings; conversation canvases reopen their native Session. */
export function Workspace({ controller, openConversation, conversation }: { controller: Controller; openConversation(id: string): boolean; conversation(id: string): ConversationActions }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [open, setOpen] = useState<string | undefined>(), [settings, setSettings] = useState(false)
  const [library, setLibrary] = useState(false)
  const [launch, setLaunch] = useState<{ tool: ResearchToolId; style?: GenerationStyle }>()
  const [prompt, setPrompt] = useState(''), [style, setStyle] = useState<GenerationStyle>('auto'), [genSize, setGenSize] = useState<SizeChoice>(''), [transparent, setTransparent] = useState(false)
  const [templatePicker, setTemplatePicker] = useState(false), [templateComposition, setTemplateComposition] = useState<string>()
  const [stylePicker, setStylePicker] = useState(false), [starting, setStarting] = useState(false)
  const homeInput = useRef<HTMLDivElement>(null), submitting = useRef(false)
  const galleryScroll = useRef<HTMLDivElement>(null), scrollPositions = useRef({ recent: 0, all: 0 })
  useLayoutEffect(() => {
    if (galleryScroll.current) galleryScroll.current.scrollTop = scrollPositions.current[library ? 'all' : 'recent']
  }, [library, open, settings])
  useEffect(() => { void controller.attach() }, [controller])
  // The list changes while conversations generate; refresh it while it is on screen.
  useEffect(() => {
    if (open || settings) return
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void controller.attach() }, 3000)
    return () => clearInterval(timer)
  }, [controller, open, settings])
  const c = state.catalog, canvases = c?.canvases ?? []
  const current = canvases.find(x => x.sessionId === open)
  const visibleCanvases = library ? canvases : canvases.slice(0, RECENT_CANVASES)
  // Choosing a style on the home page only updates its draft. A new canvas is
  // created when the user starts a tool or explicitly submits generation.
  const start = (tool: ResearchToolId) => { setTemplateComposition(undefined); setLaunch({ tool, ...(style === 'auto' ? {} : { style }) }); setSettings(false); setOpen(BOARD_PREFIX + crypto.randomUUID()) }
  const create = () => start('generate')
  const generate = async () => {
    const submitted = prompt, text = submitted.trim()
    if (!text || submitting.current) return
    if (!c?.configured) { setSettings(true); return }
    submitting.current = true; setStarting(true)
    try {
      const id = BOARD_PREFIX + crypto.randomUUID(), model = controller.canvas(id)
      if (!await model.setGenerationStyle(style)) { controller.notify(model.getSnapshot().error ?? '保存风格失败，请稍后再试。'); return }
      setTemplateComposition(undefined); setLaunch(undefined); setOpen(id)
      // Dispatch only from this explicit submit, never from a mount effect.
      // Keep the home draft if the request fails so it can be recovered on return.
      void model.generate({ prompt: text, style, ...(genSize ? { size: genSize } : {}), ...(transparent ? { transparent } : {}) }).then(ok => { if (ok) setPrompt(value => value === submitted ? '' : value) })
    } finally { submitting.current = false; setStarting(false) }
  }
  const openCanvas = (id: string) => {
    setTemplateComposition(undefined); setLaunch(undefined)
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
  const heading = settings ? '设置' : open ? current?.title ?? (isBoard(open) ? '新画布' : '画布') : library ? '全部画布' : 'PlotFig'
  const backLabel = (open || settings) && library ? '返回全部画布' : '返回首页'
  const back = () => {
    if (open || settings) { setOpen(undefined); setSettings(false) } else setLibrary(false)
    void controller.attach()
  }
  return <main className="sd sd-workspace">
    <header className="sd-head">
      <div className="sd-title">
        {open || settings || library ? <button className="sd-icon-button" onClick={back} aria-label={backLabel} title={backLabel}><BackIcon/></button> : <Icon size={22}/>}
        <div className="sd-title-text"><strong>{heading}</strong>
          <span className="sd-brand">{open && current ? `${isBoard(open) ? '独立画布' : '对话画布'} · ${current.count} 张` : open ? (isBoard(open) ? '独立画布' : '对话画布') : `Seedream 5.5 · ${canvases.length} 个画布`}</span></div>
      </div>
      <div className="sd-head-actions">
        {!open && !settings && c?.configured ? <button className="sd-button sd-button-primary" onClick={create}><NewIcon size={14}/>新建画布</button> : null}
        {!settings ? <button className="sd-icon-button" onClick={() => setSettings(true)} aria-label="设置" title="设置"><GearIcon/></button> : null}
      </div>
    </header>
    {settings ? <div className="sd-scroll"><Settings controller={controller}/></div>
      : open ? <CanvasView key={open} model={controller.canvas(open)} defaultSize={c?.defaultSize} conversation={isBoard(open) ? undefined : conversation(open)} initialTool={launch?.tool} initialStyle={launch?.style} initialCompositionId={templateComposition}/>
      : <div className="sd-scroll" key={library ? 'all' : 'home'} ref={galleryScroll} onScroll={e => { scrollPositions.current[library ? 'all' : 'recent'] = e.currentTarget.scrollTop }}>
        {c && !c.configured ? <div className="sd-alert" role="status">已保存的画布可继续编辑和导出。生成或分图层前，请在设置中配置 AI4Scholar API Key。</div> : null}
        {state.error ? <div className="sd-alert" role="alert">{state.error}</div> : null}
        {state.message ? <div className="sd-alert" role="status">{state.message}</div> : null}
        {!library ? <section className="sd-research-home">
          <div className="sd-home-input" ref={homeInput}>
            <h1>想画些什么？</h1>
            <Composer value={prompt} onChange={setPrompt} onSubmit={() => { void generate() }} disabled={starting || !c} placeholder="描述你想生成的图片…" hint={starting ? '准备画布…' : '每次生成都会计费'}>
              <ResearchStyleButton value={style} busy={starting} open={stylePicker} onClick={() => setStylePicker(true)}/>
              <TemplateButton open={templatePicker} disabled={starting || !c} onClick={() => setTemplatePicker(true)}/>
              <SizePicker value={genSize} onChange={setGenSize} fallback={c?.defaultSize}/>
              <TransparentToggle value={transparent} onChange={setTransparent}/>
            </Composer>
          </div>
          <nav className="sd-home-shortcuts" aria-label="常用工具"><ResearchTools compact disabled={starting} onSelect={tool => { if (tool === 'generate') homeInput.current?.querySelector('textarea')?.focus(); else start(tool) }}/></nav>
        </section> : null}
        {!library && canvases.length ? <div className="sd-recent-title"><h2>最近画布</h2><button type="button" className="sd-all-canvases" onClick={() => setLibrary(true)} aria-label="全部画布"><span>全部画布</span><span className="sd-canvas-count">{canvases.length}</span><ChevronIcon size={14}/></button></div> : null}
        {canvases.length ? <ul className="sd-gallery" aria-label={library ? '全部画布' : '最近画布'} data-view={library ? 'all' : 'recent'}>
          {visibleCanvases.map(x => { const running = c?.active?.[x.sessionId]?.length ?? 0
            return <li key={x.sessionId}><button className="sd-card" onClick={() => openCanvas(x.sessionId)}>
              <span className="sd-card-cover">{x.cover ? <img src={imageUrl(x.sessionId, x.cover)} alt="" loading="lazy"/> : x.diagramCover ? <img data-diagram src={`${imageUrl(x.sessionId, x.diagramCover)}&diagram=1&v=${x.revision}`} alt="" loading="lazy"/> : <ImageIcon size={22}/>}
                {running ? <span className="sd-card-badge"><span className="sd-spinner sd-spinner-small"/>生成中</span> : x.count > 1 ? <span className="sd-card-badge">{x.count} 张</span> : null}</span>
              <strong>{x.title}</strong>
              <span className="sd-card-meta"><span className="sd-tag" data-kind={isBoard(x.sessionId) ? 'board' : 'chat'}>{isBoard(x.sessionId) ? '独立' : '对话'}</span>{relative(x.updatedAt)}</span>
            </button></li> })}
        </ul>
          : <div className="sd-home-empty">{library ? '还没有画布，点击“新建画布”开始第一张图。' : '还没有画布。在上方输入描述，开始第一张图。'}</div>}
      </div>}
    {templatePicker ? <DiagramTemplates onClose={() => setTemplatePicker(false)} onCreate={async (id, palette) => {
      const session = BOARD_PREFIX + crypto.randomUUID(), composition = await controller.canvas(session).createTemplate(id, palette)
      setLaunch(undefined); setTemplateComposition(composition.id); setOpen(session); setTemplatePicker(false)
    }}/> : null}
    {stylePicker ? <ResearchStylePicker newCanvas value={style} busy={false} onPick={value => { setStyle(value); setStylePicker(false) }} onClose={() => setStylePicker(false)}/> : null}
  </main>
}
