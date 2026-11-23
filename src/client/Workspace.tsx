import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { MARK_BODY, MARK_LEAF, MARK_TRANSFORM, MARK_VIEWBOX } from './mark.js'
import { BOARD_PREFIX, DEFAULT_WATERMARK, isBoard, SIZE_TIERS } from '../shared/types.js'
import { BackIcon, GearIcon, NewIcon, RefreshIcon } from './icons.js'
import type { Controller, State } from './controller.js'
import { CanvasGallery } from './CanvasGallery.js'
import { CanvasView } from './Canvas.js'
import type { ConversationActions } from './handoff.js'
import { ResearchTools } from './ResearchTools.js'
import { ResearchStyleButton, ResearchStylePicker } from './ResearchStyles.js'
import { ILLUSTRATION_PROMPT_HINT } from '../shared/research.js'
import type { GenerationStyle, ResearchToolId } from '../shared/research.js'
import { DiagramTemplates, TemplateButton } from './DiagramTemplates.js'
import { UpdateCheck } from './UpdateCheck.js'
import { Composer, ModelPicker, SizePicker, TransparentToggle, useDrawingOptions } from './Composer.js'
import { MODEL } from '../shared/models.js'
import type { DrawingModel } from '../shared/models.js'

export function Icon({ size = 20 }: { size?: number }) {
  // The P follows the surrounding text color, so it reads on light and dark sidebars; the leaf is burnt orange on light themes and lime on dark ones.
  return <svg width={size} height={size} viewBox={MARK_VIEWBOX} aria-hidden="true">
    <path d={MARK_BODY} fill="currentColor" transform={MARK_TRANSFORM}/>
    <path className="sd-mark-leaf" d={MARK_LEAF} transform={MARK_TRANSFORM}/>
  </svg>
}
export function keyStatus(state: State): string {
  const c = state.catalog
  if (!c) return state.loading ? '读取中…' : '配置暂不可用'
  return c.configured ? '已配置' : '未配置'
}
export function Settings({ controller }: { controller: Controller }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [key, setKey] = useState('')
  const keyId = useId(), sizeId = useId()
  const c = state.catalog
  useEffect(() => { void controller.attach() }, [controller])
  return <section className="sd-settings" aria-label="PlotFig 设置">
    <div className="sd-settings-group">
      <div className="sd-settings-heading">
        <div className="sd-key-heading">
          <h2><label htmlFor={keyId}>AI4Scholar API Key</label></h2>
          <div className="sd-key-status">
            <span aria-live="polite"><span className="sd-status-dot" aria-hidden="true" data-ready={c?.configured}/>{keyStatus(state)}</span>
            <button type="button" className="sd-icon-button" disabled={state.loading} aria-label="刷新状态" title="刷新状态" onClick={() => void controller.attach()}><RefreshIcon size={14}/></button>
          </div>
        </div>
        <a className="sd-button sd-button-primary" href="https://ai4scholar.net/?src=dsh_plotfig" target="_blank" rel="noopener noreferrer"
          title="前往 AI4Scholar 首页，登录后在「开放平台」创建密钥">获取密钥<span aria-hidden="true">↗</span></a>
      </div>
      <form className="sd-key-row" aria-busy={state.keyBusy} onSubmit={async e => {
        e.preventDefault()
        if (await controller.saveKey(key)) setKey('')
      }}>
        <input id={keyId} type="password" autoComplete="off" spellCheck={false} placeholder="sk-user-…" aria-describedby={keyId + '-note'}
          value={key} readOnly={state.keyBusy} onChange={e => setKey(e.target.value)}/>
        <button type="submit" className="sd-button" disabled={!key.trim() || state.keyBusy || !c}>{state.keyBusy && key ? '保存中…' : '保存'}</button>
      </form>
      <p className="sd-settings-note" id={keyId + '-note'}>本机密钥与 dsh-ai4scholar 共享，修改和移除会同步生效。</p>
      {c?.configured && <div className="sd-settings-actions">
        <button type="button" className="sd-button" disabled={state.checkBusy} title="免费检查密钥、余额和绘图接口" onClick={() => void controller.checkConnection()}>{state.checkBusy ? '测试中…' : '测试连接'}</button>
        <button type="button" className="sd-button" disabled={state.keyBusy} onClick={() => void controller.removeKey()}>移除密钥</button>
      </div>}
    </div>
    {state.error && <div className="sd-alert" role="alert">{state.error}</div>}
    {state.message && <div className="sd-alert" role="status">{state.message}</div>}
    <div className="sd-settings-group">
      <h2>绘图偏好</h2>
      <div className="sd-settings-row">
        <label htmlFor={sizeId}>默认尺寸</label>
        <select id={sizeId} disabled={!c || state.settingsBusy} value={c && (SIZE_TIERS as readonly string[]).includes(c.defaultSize) ? c.defaultSize : '2K'}
          onChange={e => void controller.saveSettings({ size: e.target.value })}>{SIZE_TIERS.map(s => <option key={s} value={s}>{s}</option>)}</select>
      </div>
      <label className="sd-settings-row">
        <span>Seedream「AI 生成」水印</span>
        <input className="sd-settings-switch" type="checkbox" role="switch" disabled={!c || state.settingsBusy} checked={c?.watermark ?? DEFAULT_WATERMARK}
          onChange={e => void controller.saveSettings({ watermark: e.target.checked })}/>
      </label>
    </div>
    <footer className="sd-settings-footer">
      <details>
        <summary>积分说明</summary>
        <p>生图和编辑使用 AI4Scholar 积分。分层先预留最高积分，再按实际交付的图片结算。</p>
      </details>
      {c?.version && <span>版本 {c.version}</span>}
    </footer>
  </section>
}
/** Main panel: gallery and settings; conversation canvases reopen their native Session. */
export function Workspace({ controller, openConversation, conversation, openPluginManager }: {
  controller: Controller; openConversation(id: string): boolean; conversation(id: string): ConversationActions
  openPluginManager?: (() => void) | undefined
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [open, setOpen] = useState<string | undefined>(), [settings, setSettings] = useState(false)
  const [library, setLibrary] = useState(false)
  const [launch, setLaunch] = useState<ResearchToolId>()
  const [prompt, setPrompt] = useState(''), [style, setStyle] = useState<GenerationStyle>('auto'), [drawingModel, setDrawingModel] = useState<DrawingModel>(MODEL)
  const drawing = useDrawingOptions(drawingModel, state.catalog?.defaultSize)
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
  const openNew = (id: string, tool?: ResearchToolId, compositionId?: string) => {
    if (drawingModel !== MODEL || style !== 'auto') void controller.canvas(id).setGenerationOptions({ generationModel: drawingModel, generationStyle: style })
    setTemplateComposition(compositionId); setLaunch(tool); setSettings(false); setOpen(id)
  }
  const start = (tool: ResearchToolId) => openNew(BOARD_PREFIX + crypto.randomUUID(), tool)
  const create = () => start('generate')
  const selectHomeTool = (tool: ResearchToolId) => {
    if (tool === 'generate') {
      homeInput.current?.querySelector('textarea')?.focus()
      controller.notify(ILLUSTRATION_PROMPT_HINT)
    } else start(tool)
  }
  const generate = async () => {
    const submitted = prompt, text = submitted.trim()
    if (!text || submitting.current) return
    if (!c?.configured) { setSettings(true); return }
    submitting.current = true; setStarting(true)
    try {
      const id = BOARD_PREFIX + crypto.randomUUID(), model = controller.canvas(id)
      if (!await model.setGenerationOptions({ generationStyle: style, generationModel: drawingModel })) { controller.notify(model.getSnapshot().error ?? '保存绘图设置失败，请稍后再试。'); return }
      setTemplateComposition(undefined); setLaunch(undefined); setOpen(id)
      // Dispatch only from this explicit submit, never from a mount effect.
      // Keep the home draft if the request fails so it can be recovered on return.
      void model.generate({ prompt: text, style, ...drawing.request }).then(ok => { if (ok) setPrompt(value => value === submitted ? '' : value) })
    } finally { submitting.current = false; setStarting(false) }
  }
  const openCanvas = (id: string) => {
    setTemplateComposition(undefined); setLaunch(undefined)
    try { if (isBoard(id) || !openConversation(id)) setOpen(id) }
    catch (error) { controller.notify(error instanceof Error ? error.message : '无法打开原对话') }
  }
  const heading = settings ? 'PlotFig 设置' : open ? current?.title ?? (isBoard(open) ? '新画布' : '画布') : library ? '全部画布' : 'PlotFig'
  const backLabel = (open || settings) && library ? '返回全部画布' : '返回首页'
  const back = () => {
    if (open || settings) { setOpen(undefined); setSettings(false) } else setLibrary(false)
    void controller.attach()
  }
  return <main className="sd sd-workspace">
    <header className="sd-head">
      <div className="sd-title">
        {open || settings || library ? <button className="sd-icon-button" onClick={back} aria-label={backLabel} title={backLabel}><BackIcon/></button> : <Icon size={22}/>}
        <div className="sd-title-text">
          <strong>{heading}</strong>
          {open && !settings && <span className="sd-brand">{isBoard(open) ? '独立画布' : '对话画布'}{current && ` · ${current.count} 张`}</span>}
          {!open && library && !settings && <span className="sd-brand">{canvases.length} 个画布</span>}
        </div>
      </div>
      <div className="sd-head-actions">
        {!open && !settings && c?.configured ? <button className="sd-button sd-button-primary" onClick={create}><NewIcon size={14}/>新建画布</button> : null}
        {!open && !settings && <UpdateCheck controller={controller} currentVersion={c?.version} openPluginManager={openPluginManager}/>}
        {!settings ? <button className="sd-icon-button" onClick={() => setSettings(true)} aria-label="设置" title="设置"><GearIcon/></button> : null}
      </div>
    </header>
    {settings ? <div className="sd-scroll"><Settings controller={controller}/></div>
      : open ? <CanvasView key={open} model={controller.canvas(open)} defaultSize={c?.defaultSize} conversation={isBoard(open) ? undefined : conversation(open)} initialTool={launch} initialCompositionId={templateComposition}/>
      : <div className="sd-scroll" key={library ? 'all' : 'home'} ref={galleryScroll} onScroll={e => { scrollPositions.current[library ? 'all' : 'recent'] = e.currentTarget.scrollTop }}>
        {c && !c.configured ? <div className="sd-alert" role="status">已保存的画布可继续编辑和导出。生成或分图层前，请在设置中配置 AI4Scholar API Key。</div> : null}
        {state.error ? <div className="sd-alert" role="alert">{state.error}</div> : null}
        {state.message ? <div className="sd-alert" role="status">{state.message}</div> : null}
        {!library ? <section className="sd-research-home">
          <div className="sd-home-input" ref={homeInput}>
            <h1>想画些什么？</h1>
            <Composer value={prompt} onChange={setPrompt} onSubmit={() => { void generate() }} disabled={starting || !c} placeholder="描述你想生成的图片…" hint={starting ? '准备画布…' : undefined}
              modelPicker={<ModelPicker value={drawingModel} onChange={setDrawingModel} disabled={starting}/>}>
              <ResearchStyleButton value={style} busy={starting} open={stylePicker} onClick={() => setStylePicker(true)}/>
              <TemplateButton open={templatePicker} disabled={starting || !c} onClick={() => setTemplatePicker(true)}/>
              <SizePicker options={drawing}/>
              {drawing.native && <TransparentToggle value={drawing.transparent} onChange={drawing.setTransparent}/>}
            </Composer>
          </div>
          <nav className="sd-home-shortcuts" aria-label="常用工具"><ResearchTools compact disabled={starting} onSelect={selectHomeTool}/></nav>
        </section> : null}
        <CanvasGallery controller={controller} catalog={c} library={library} showAll={() => setLibrary(true)} openCanvas={openCanvas}/>
      </div>}
    {templatePicker ? <DiagramTemplates onClose={() => setTemplatePicker(false)} onCreate={async (id, palette) => {
      const session = BOARD_PREFIX + crypto.randomUUID(), composition = await controller.canvas(session).createTemplate(id, palette)
      openNew(session, undefined, composition.id); setTemplatePicker(false)
    }}/> : null}
    {stylePicker ? <ResearchStylePicker newCanvas value={style} busy={false} onPick={value => { setStyle(value); setStylePicker(false) }} onClose={() => setStylePicker(false)}/> : null}
  </main>
}
