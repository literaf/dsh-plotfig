import type { ComponentType } from 'react'
import { useEffect, useSyncExternalStore } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { Controller } from './controller.js'
import { resolveCredentialsPort } from './credentials-port.js'
import { Workspace, Settings, Icon, keyStatus } from './Workspace.js'
import { CanvasView } from './Canvas.js'
import { installStyles } from './styles.js'
import { referenceItem } from './handoff.js'
import { PANEL, TAB_ID, TAB_KIND } from '../shared/types.js'
export const inject = ['slots']
interface Slots {
  inject(name: string, callback: () => () => void): () => void
  register<P extends object>(options: { name: string; key?: string; id?: string; order?: number; label?(): string }, component: ComponentType<P>): () => void
}
/** The 0.2.2 right Sidebar faces, typed locally so older hosts need nothing from them. */
interface TabRegistry { register(definition: { id: string; kind: string; keepMounted?: boolean; priority?: 'extension'; title(address: string): string; guide?: Array<{ id: string; order: number; title(): string; description?(): string; icon?: ComponentType<object> }> }): () => void }
interface SidebarRight { openTab(kind: string): void; openTabIn?(sessionId: string, kind: string): void; isExpanded(): boolean; toggleExpanded(): void; mounted?: { getSnapshot(): string | undefined } }
interface TabBodyProps { sessionId: string; useTabInfo(): { tab: { visible: boolean } } }
export function apply(ctx: ClientContext): void {
  const controller = new Controller(() => resolveCredentialsPort({ connection: ctx.get('connection'), remoteCredentials: ctx.get('remote.credentials') }))
  ctx.effect(() => installStyles(), 'seedream: styles')
  ctx.effect(() => () => controller.dispose(), 'seedream: state')
  const slots = ctx.slots as unknown as Slots
  const reference = (sessionId: string, item: Parameters<typeof referenceItem>[2]) => referenceItem(ctx, sessionId, item)
  const Root = () => <Workspace controller={controller} reference={reference}/>
  slots.inject('main', () => slots.register({ name: 'main', key: PANEL }, Root))
  slots.inject('sidebar.panellist', () => slots.register({ name: 'sidebar.panellist', id: PANEL, order: 67, label: () => 'Seedream' }, () => <Icon/>))
  const Config = ({ view = 'page' }: { view?: 'summary' | 'page' }) => {
    const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
    return <div className="sd" style={{ height: 'auto', overflow: 'visible' }}>{view === 'summary'
      ? <p style={{ margin: 0, color: 'var(--sd-muted)', fontSize: 12 }}>{keyStatus(state)} · 打开详情配置方舟 Key</p>
      : <Settings controller={controller}/>}</div>
  }
  slots.inject('plugins.bundle.config', () => slots.register({ name: 'plugins.bundle.config', key: 'dsh-seedream' }, Config))
  slots.inject('plugins.row.config', () => slots.register({ name: 'plugins.row.config', key: 'dsh-seedream#seedream' }, Config))
  slots.inject('settings.section', () => slots.register({ name: 'settings.section', id: PANEL, order: 192, label: () => 'Seedream' }, Config))
  // Per-conversation canvas as a right Sidebar tab, where the host provides one (Harness ≥ 0.2.2).
  ctx.inject(['sidebarRightTabs'], child => {
    const tabs = child.get('sidebarRightTabs' as never) as unknown as TabRegistry
    child.effect(() => tabs.register({ id: TAB_ID, kind: TAB_KIND, keepMounted: true, priority: 'extension', title: () => 'Seedream 画布',
      guide: [{ id: 'canvas', order: 60, title: () => 'Seedream 画布', description: () => '在这个对话里生成和编辑图片', icon: () => <Icon size={16}/> }] }), 'seedream: tab type')
    const Body = ({ sessionId, useTabInfo }: TabBodyProps) => {
      const { tab } = useTabInfo()
      const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
      return <div className="sd" style={{ height: '100%' }}><CanvasView model={controller.canvas(sessionId)} active={tab.visible} defaultSize={state.catalog?.defaultSize} onReference={item => reference(sessionId, item)}/></div>
    }
    slots.inject('sidebar.right.pane.tab', () => slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, Body))
    /** Open the canvas tab in this Session and make sure the column is showing it. */
    const show = (sessionId: string) => {
      const right = child.get('sidebarRight' as never) as unknown as SidebarRight | undefined
      if (!right) return
      const onScreen = right.mounted?.getSnapshot()
      if (onScreen !== undefined && onScreen !== sessionId) { right.openTabIn?.(sessionId, TAB_KIND); return }
      right.openTab(TAB_KIND)
      if (!right.isExpanded()) right.toggleExpanded()
    }
    // Mounted in each conversation header: opens the canvas when that conversation starts a generation.
    const Open = ({ sessionId }: { sessionId: string }) => {
      const active = useSyncExternalStore(controller.subscribeActive, controller.getActive)
      const running = active[sessionId] ?? []
      useEffect(() => controller.watchActive(), [])
      useEffect(() => {
        const fresh = running.filter(p => !controller.announced.has(p.key))
        if (!fresh.length) return
        fresh.forEach(p => controller.announced.add(p.key))
        try { show(sessionId) } catch { /* the host may not have adopted this Session yet */ }
        void controller.canvas(sessionId).refresh()
      }, [running, sessionId])
      return <button className="sd-header-button" data-running={running.length > 0 || undefined} title={running.length ? 'Seedream 生成中，打开画布' : '打开 Seedream 画布'} aria-label="打开 Seedream 画布"
        onClick={() => { try { show(sessionId) } catch (error) { controller.notify(error instanceof Error ? error.message : '无法打开画布。') } }}><Icon size={16}/></button>
    }
    slots.inject('conversation.session.header.actions', () => slots.register({ name: 'conversation.session.header.actions', id: PANEL, order: 60 }, Open))
  })
  void controller.attach()
}
